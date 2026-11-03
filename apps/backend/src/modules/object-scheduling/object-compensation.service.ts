import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ObjectCompensationAdjustment } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';
import { canEditObjectDailyRate, canViewObjectByScope, LEADERSHIP_OBJECT_ROLE_CODES } from '../objects/utils/object-access.util';
import { annualSeason, validAnnualDate } from '../objects/utils/object-season.util';
import { normalizeRatePolicy, parseRatePolicySnapshot, pinRatePolicyProductionCalendar } from '../timesheets/utils/timesheet-rate-policy.util';
import { getScheduleConfigurationError } from '../timesheets/utils/russian-production-calendar.util';
import type { TimesheetRatePolicySnapshot } from '../timesheets/types/timesheet-rate-policy.type';
import { CancelCompensationVersionDto, CompensationTermsDto, CorrectExtraWorkDto, CreateCompensationAdjustmentDto, CreateCompensationVersionDto, CreateTeamFundDto } from './compensation.dto';
import { COMPENSATION_CALCULATION_VERSION, isPublicHoliday, positionNormDays, roundedSalaryFractions, salaryHalf, salaryNormDays } from './compensation-calculation';
import { calendarPreview, dateOnly, legacyFactDay, todayMoscow } from './scheduling-calendar';
import type { ScheduleRevisionView, SchedulingUser } from './scheduling.types';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const roles = (user: SchedulingUser) => user.roleCodes?.length ? user.roleCodes : [user.roleCode];
export const COMPENSATION_APPROVAL_TYPE = 'object_compensation_confirmation';
function conflict(code: string, message: string): never { throw new ConflictException({code, message}); }

@Injectable()
export class ObjectCompensationService {
  constructor(private readonly prisma: PrismaService) {}

  async access(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, write = false) {
    const object = await tx.object.findFirst({where: {id: objectId, deletedAt: null}, include: {assignments: {where: {isActive: true}}, planningSettings: true}});
    if (!object) throw new NotFoundException('Объект не найден');
    if (!user.isActive || !canViewObjectByScope({currentUserId: user.id, roleCodes: roles(user), ownScopeOnly: true, object})) throw new ForbiddenException('Нет доступа к оплате объекта');
    if (write && ['frozen', 'closed', 'archived'].includes(object.status)) conflict('OBJECT_READ_ONLY', 'Объект недоступен для изменения');
    return object;
  }
  rateAccess(user: SchedulingUser) {
    if (!canEditObjectDailyRate(roles(user))) throw new ForbiddenException('Требуется право управления условиями оплаты');
  }
  private canManageTeamFund(user: SchedulingUser) {
    return roles(user).some(role => ['founder', 'director'].includes(role)) || !!user.permissionCodes?.includes('object.budget_edit');
  }
  private async lock(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string) {
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
    return this.access(tx, user, objectId, true);
  }
  private async audit(tx: Prisma.TransactionClient, userId: string, objectId: string, action: string, payload: unknown) {
    await tx.objectAuditLog.create({data: {objectId, actorUserId: userId, actionCode: action, payload: json(payload)}});
    await tx.auditEvent.create({data: {entityType: 'object', entityId: objectId, actorUserId: userId, action, newValues: json(payload)}});
  }
  private future(date: string) {
    dateOnly(date);
    if (date < todayMoscow()) conflict('HISTORY_PROTECTED', 'Условия можно вводить только с текущей или будущей даты; прошлые начисления исправляются через согласование');
  }
  async list(user: SchedulingUser, objectId: string) {
    const object = await this.access(this.prisma, user, objectId);
    const writable = !['frozen', 'closed', 'archived'].includes(object.status);
    const manageRates = writable && canEditObjectDailyRate(roles(user));
    const requestExtraWork = writable && (manageRates || object.assignments.some(a => a.userId === user.id && a.assignmentRoleCode === 'manager'));
    const [versions, teamFunds, adjustments] = await Promise.all([
      this.prisma.objectCompensationVersion.findMany({where: {objectId}, orderBy: [{effectiveFrom: 'asc'}, {version: 'asc'}]}),
      this.prisma.objectTeamFundVersion.findMany({where: {objectId}, orderBy: {effectiveFrom: 'asc'}}),
      this.prisma.objectCompensationAdjustment.findMany({where: {objectId}, orderBy: {createdAt: 'desc'}, take: 200}),
    ]);
    const authors = await this.prisma.user.findMany({where: {id: {in: [...new Set([...versions, ...teamFunds, ...adjustments].flatMap(v => [v.createdByUserId, ...('appliedByUserId' in v && v.appliedByUserId ? [v.appliedByUserId] : [])]))]}}, select: {id: true, fullName: true}});
    const author = (id: string | null) => authors.find(a => a.id === id) ?? null;
    const extraCredits = await this.prisma.objectPayrollCredit.findMany({where: {objectId, sourceKey: {startsWith: 'extra:'}}});
    return {versions: versions.map(v => ({...v, effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10), createdBy: author(v.createdByUserId)})), teamFunds: teamFunds.map(v => ({...v, effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10), createdBy: author(v.createdByUserId)})), adjustments: adjustments.map(v => {
      const before = v.beforeSnapshot as Prisma.JsonObject; const payload = v.payload as Prisma.JsonObject;
      const beforeAmount = v.kind === 'extra_work' ? 0 : typeof before.amount === 'number' ? before.amount : typeof before.dailyRateSnapshot === 'number' ? before.dailyRateSnapshot : null;
      const afterAmount = v.kind === 'replacement' ? beforeAmount : v.kind === 'holiday_exception' ? payload.paid ? beforeAmount : 0 : v.amount;
      const credit = extraCredits.find(c => c.sourceKey === `extra:${v.id}`);
      return {...v, operationDate: v.operationDate.toISOString().slice(0, 10), createdBy: author(v.createdByUserId), appliedBy: author(v.appliedByUserId), beforeAmount, afterAmount, difference: beforeAmount !== null && afterAmount !== null ? afterAmount - beforeAmount : null, currentAmount: credit?.amount ?? null, creditUpdatedAt: credit?.updatedAt.toISOString() ?? null};
    }), capabilities: {manageRates, manageTeamFund: writable && this.canManageTeamFund(user), requestExtraWork, requestAdjustment: manageRates, approveRetroactive: roles(user).some(role => (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role))}};
  }
  async version(user: SchedulingUser, objectId: string, input: CreateCompensationVersionDto) {
    this.rateAccess(user); dateOnly(input.effectiveFrom);
    return this.prisma.$transaction(async tx => {
      const object = await this.lock(tx, user, objectId);
      const scopeId = input.scope === 'defaults' ? objectId : input.scopeId;
      if (!scopeId || !input.terms) throw new BadRequestException('Укажите линию условий и параметры оплаты');
      const error = getScheduleConfigurationError({scheduleCode: input.terms.scheduleCode, scheduleWeekdays: input.terms.scheduleWeekdays, scheduleCycleStartDate: input.terms.scheduleCycleStartDate});
      if (error) throw new BadRequestException(error);
      if (input.terms.scheduleCycleStartDate) dateOnly(input.terms.scheduleCycleStartDate);
      if (input.scope === 'contour' && !await tx.objectPayContour.findFirst({where: {id: scopeId, objectId}})) throw new NotFoundException('Контур объекта не найден');
      if (input.scope === 'rate' && !await tx.objectCompensationRate.findFirst({where: {id: scopeId, objectId}})) throw new NotFoundException('Условие объекта не найдено');
      const replay = await tx.objectCompensationVersion.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}});
      if (replay) {
        const stored = replay.terms as Prisma.JsonObject;
        const requested = {...input.terms, paidHolidays: input.terms.paidHolidays !== false};
        if (replay.scope !== input.scope || replay.scopeId !== scopeId || replay.effectiveFrom.getTime() !== dateOnly(input.effectiveFrom).getTime() || Object.entries(requested).filter(([, value]) => value !== undefined).some(([key, value]) => !isDeepStrictEqual(json(value), stored[key]))) conflict('REQUEST_KEY_REUSED', 'Ключ запроса уже использован с другими условиями');
        return {status: 'applied' as const, version: {...replay, effectiveFrom: replay.effectiveFrom.toISOString().slice(0, 10)}};
      }
      this.future(input.effectiveFrom);
      const automaticSeasons = input.terms.automaticSeasons ?? object.planningSettings?.automaticSeasons ?? false;
      const summerStartsOn = input.terms.summerStartsOn ?? object.planningSettings?.summerStartsOn ?? null;
      const winterStartsOn = input.terms.winterStartsOn ?? object.planningSettings?.winterStartsOn ?? null;
      if (automaticSeasons && (!summerStartsOn || !winterStartsOn || !validAnnualDate(summerStartsOn) || !validAnnualDate(winterStartsOn) || summerStartsOn === winterStartsOn)) throw new BadRequestException('Укажите разные ежегодные даты начала сезонов');
      const terms = json({...input.terms, seasonMode: input.terms.seasonMode ?? object.seasonMode ?? 'default', automaticSeasons, summerStartsOn, winterStartsOn, paidHolidays: input.terms.paidHolidays !== false, calculationVersion: COMPENSATION_CALCULATION_VERSION});
      const previous = await tx.objectCompensationVersion.findFirst({where: {objectId, scope: input.scope, scopeId}, orderBy: {version: 'desc'}});
      if ((previous?.version ?? 0) !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Условия уже изменены. Обновите данные');
      if (await tx.objectCompensationVersion.findFirst({where: {objectId, scope: input.scope, scopeId, effectiveFrom: dateOnly(input.effectiveFrom), cancelledAt: null}})) conflict('EFFECTIVE_DATE_CONFLICT', 'На эту дату уже сохранена версия; отмените будущую версию перед заменой');
      const version = await tx.objectCompensationVersion.create({data: {objectId, scope: input.scope, scopeId, version: input.expectedVersion + 1, requestKey: input.requestKey, effectiveFrom: dateOnly(input.effectiveFrom), terms, createdByUserId: user.id}});
      await this.audit(tx, user.id, objectId, 'compensation.version.created', version);
      return {status: 'applied' as const, version: {...version, effectiveFrom: version.effectiveFrom.toISOString().slice(0, 10)}};
    });
  }
  async cancelVersion(user: SchedulingUser, objectId: string, id: string, input: CancelCompensationVersionDto) {
    this.rateAccess(user);
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId);
      const item = await tx.objectCompensationVersion.findFirst({where: {id, objectId}});
      if (!item) throw new NotFoundException('Версия условий не найдена');
      if (item.version !== input.expectedVersion || item.effectiveFrom.toISOString().slice(0, 10) <= todayMoscow() || item.cancelledAt) conflict('HISTORY_PROTECTED', 'Можно отменить только действующую будущую версию');
      if (!input.reason.trim()) throw new BadRequestException('Укажите причину');
      const version = await tx.objectCompensationVersion.update({where: {id}, data: {cancelledAt: new Date(), cancelledByUserId: user.id, cancelReason: input.reason.trim()}});
      await this.audit(tx, user.id, objectId, 'compensation.version.cancelled', version);
      return {status: 'applied' as const, version: {...version, effectiveFrom: version.effectiveFrom.toISOString().slice(0, 10)}};
    });
  }
  async teamFund(user: SchedulingUser, objectId: string, input: CreateTeamFundDto) {
    if (!this.canManageTeamFund(user)) throw new ForbiddenException('Изменение фонда требует права редактирования бюджета');
    dateOnly(input.effectiveFrom);
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId);
      const allocations = json(input.allocations);
      if (!input.reason.trim()) throw new BadRequestException('Укажите основание распределения фонда');
      if (new Set(input.allocations.map(a => `${a.positionId}:${a.contourId}`)).size !== input.allocations.length) throw new BadRequestException('Распределение позиции/контура не должно повторяться');
      if (input.allocations.reduce((sum, a) => sum + a.monthlyAmount, 0) > input.monthlyAmount) throw new BadRequestException('Распределения превышают месячный фонд');
      const replay = await tx.objectTeamFundVersion.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}});
      if (replay) {
        if (replay.monthlyAmount !== input.monthlyAmount || replay.effectiveFrom.getTime() !== dateOnly(input.effectiveFrom).getTime() || !isDeepStrictEqual(replay.allocations, allocations) || replay.reason !== input.reason.trim()) conflict('REQUEST_KEY_REUSED', 'Ключ запроса уже использован');
        return {status: 'applied' as const, teamFund: {...replay, effectiveFrom: replay.effectiveFrom.toISOString().slice(0, 10)}};
      }
      this.future(input.effectiveFrom);
      const last = await tx.objectTeamFundVersion.findFirst({where: {objectId}, orderBy: {version: 'desc'}});
      if ((last?.version ?? 0) !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Распределение фонда уже изменено');
      if (await tx.objectTeamFundVersion.findFirst({where: {objectId, effectiveFrom: dateOnly(input.effectiveFrom)}})) conflict('EFFECTIVE_DATE_CONFLICT', 'На эту дату уже задан фонд');
      for (const allocation of input.allocations) {
        const position = await tx.objectStaffPosition.findFirst({where: {id: allocation.positionId, objectId}, include: {revisions: {where: {effectiveFrom: {lte: dateOnly(input.effectiveFrom)}}, orderBy: [{effectiveFrom: 'desc'}, {version: 'desc'}], take: 1}}});
        if (!position?.revisions[0] || position.revisions[0].archived || !await tx.objectPayContour.findFirst({where: {id: allocation.contourId, objectId, isActive: true}})) throw new BadRequestException('Выберите действующую позицию и контур этого объекта');
        const groups = position.revisions[0].groups as unknown as ScheduleRevisionView['groups'];
        if (!groups.some(g => g.timeRanges.some(r => r.contourId === allocation.contourId))) throw new BadRequestException('Контур не связан с указанной позицией');
        const terms = await this.effectiveVersion(tx, objectId, 'contour', allocation.contourId, input.effectiveFrom);
        if ((terms?.terms as unknown as CompensationTermsDto | undefined)?.ratePolicyType !== 'monthly_fixed') throw new BadRequestException('Распределение месячного фонда требует датированных месячных условий контура');
      }
      const teamFund = await tx.objectTeamFundVersion.create({data: {objectId, version: input.expectedVersion + 1, requestKey: input.requestKey, effectiveFrom: dateOnly(input.effectiveFrom), monthlyAmount: input.monthlyAmount, allocations, reason: input.reason.trim(), createdByUserId: user.id}});
      await this.audit(tx, user.id, objectId, 'compensation.team_fund.created', teamFund);
      return {status: 'applied' as const, teamFund: {...teamFund, effectiveFrom: teamFund.effectiveFrom.toISOString().slice(0, 10)}};
    });
  }
  async effectiveVersion(tx: Prisma.TransactionClient, objectId: string, scope: string, scopeId: string, date: string) {
    return tx.objectCompensationVersion.findFirst({where: {objectId, scope, scopeId, cancelledAt: null, effectiveFrom: {lte: dateOnly(date)}}, orderBy: [{effectiveFrom: 'desc'}, {version: 'desc'}]});
  }
  async resolvePolicy(tx: Prisma.TransactionClient, objectId: string, date: string, employeeId: string, contourId: string | null, revision?: ScheduleRevisionView, positionId?: string): Promise<TimesheetRatePolicySnapshot | null> {
    const assignment = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId}}});
    const scope = contourId ? 'contour' : assignment?.rateOptionId ? 'rate' : 'defaults';
    const scopeId = contourId ?? assignment?.rateOptionId ?? objectId;
    const version = await this.effectiveVersion(tx, objectId, scope, scopeId, date);
    if (!version) return null;
    const terms = version.terms as unknown as CompensationTermsDto;
    const settings = await tx.objectPlanningSettings.findUnique({where: {objectId}});
    const object = await tx.object.findUniqueOrThrow({where: {id: objectId}});
    const automatic = terms.automaticSeasons ?? settings?.automaticSeasons;
    const summer = terms.summerStartsOn ?? settings?.summerStartsOn;
    const winter = terms.winterStartsOn ?? settings?.winterStartsOn;
    const season = automatic && summer && winter ? annualSeason(summer, winter, new Date(`${date}T12:00:00+03:00`)) : terms.seasonMode ?? object.seasonMode;
    let amount = (season === 'summer' ? terms.summerAmount : season === 'winter' ? terms.winterAmount : null) ?? terms.baseAmount;
    const [year, month] = date.split('-').map(Number);
    let poolKey: string | undefined;
    let norm: ReturnType<typeof salaryNormDays> | undefined;
    if (terms.ratePolicyType === 'monthly_fixed' && contourId) {
      if (!revision || !positionId) conflict('SALARY_UNAVAILABLE', 'Месячный фонд требует явной позиции и её графика');
      const fund = await tx.objectTeamFundVersion.findFirst({where: {objectId, effectiveFrom: {lte: dateOnly(date)}}, orderBy: [{effectiveFrom: 'desc'}, {version: 'desc'}]});
      const allocation = (fund?.allocations as unknown as CreateTeamFundDto['allocations'] | undefined)?.find(a => a.positionId === positionId && a.contourId === contourId);
      if (!allocation) conflict('SALARY_UNAVAILABLE', 'Для позиции и контура не распределён месячный фонд команды');
      amount = allocation.monthlyAmount;
      norm = positionNormDays(revision, contourId, year, month);
      poolKey = `${positionId}:${contourId}`;
    }
    const policy: TimesheetRatePolicySnapshot = {...normalizeRatePolicy({ratePolicyType: terms.ratePolicyType, ratePolicyBaseAmount: amount, ratePolicyScheduleCode: terms.scheduleCode, ratePolicyWeekdays: terms.scheduleWeekdays, ratePolicyScheduleCycleStartDate: terms.scheduleCycleStartDate, ratePolicyNotes: terms.notes}, amount), calculationVersion: COMPENSATION_CALCULATION_VERSION, compensationVersionId: version.id, paidHolidays: terms.paidHolidays !== false, poolKey, positionId, contourId: contourId ?? undefined, salaryOwnerEmployeeId: employeeId};
    let pinned = policy;
    try { pinned = pinRatePolicyProductionCalendar(policy, year); } catch (error) { conflict('SALARY_UNAVAILABLE', error instanceof Error ? error.message : 'Календарь недоступен'); }
    if (terms.ratePolicyType === 'monthly_fixed') {
      norm ??= salaryNormDays(pinned, year, month);
      if (norm.reason) conflict('SALARY_UNAVAILABLE', norm.reason);
      pinned.normDaysFirstHalf = norm.days.filter(d => d <= 15).length;
      pinned.normDaysSecondHalf = norm.days.filter(d => d > 15).length;
      pinned.dailySlotCapacity = norm.days.filter(d => d === Number(date.slice(8))).length;
      const half = Number(date.slice(8)) <= 15 ? 1 : 2;
      const check = salaryHalf(amount, half, half === 1 ? pinned.normDaysFirstHalf : pinned.normDaysSecondHalf, 1);
      if (check.unavailableReason) conflict('SALARY_UNAVAILABLE', check.unavailableReason);
    }
    return pinned;
  }

  /** Only mutations call this. Read endpoints never invent holiday attendance. */
  async postCredit(tx: Prisma.TransactionClient, userId: string, objectId: string, employeeId: string, date: string, sourceKey: string, amount: number, policy: unknown, explanation: string) {
    const previous = await tx.objectPayrollCredit.findUnique({where: {objectId_sourceKey: {objectId, sourceKey}}});
    if (previous && previous.employeeId !== employeeId) conflict('CREDIT_OWNER_CONFLICT', 'Начисление уже принадлежит другому сотруднику');
    const delta = amount - (previous?.amount ?? 0);
    if (delta === 0 && previous && isDeepStrictEqual(previous.policySnapshot, json(policy)) && previous.explanation === explanation) return;
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    const container = await tx.timesheetMonth.upsert({where: {objectId_year_month: {objectId, year, month}}, create: {objectId, year, month, createdByUserId: userId}, update: {}});
    if (container.status !== 'open') conflict('MONTH_CLOSED', 'Месяц табеля закрыт');
    const employee = await tx.employee.findUniqueOrThrow({where: {id: employeeId}});
    const row = await tx.timesheetEmployeeRow.upsert({where: {timesheetMonthId_employeeId: {timesheetMonthId: container.id, employeeId}}, create: {timesheetMonthId: container.id, employeeId, employeeNameSnapshot: employee.fullName}, update: {}});
    const entry = await tx.timesheetDayEntry.findUnique({where: {rowId_dayOfMonth: {rowId: row.id, dayOfMonth}}});
    const autoValue = (entry?.autoValue ?? 0) + delta;
    const finalValue = entry?.isChangedManually ? entry.manualValue ?? entry.dayValue : (entry?.dayValue ?? 0) + delta;
    if (autoValue < 0 || finalValue < 0 || autoValue > 2147483647 || finalValue > 2147483647) conflict('AMOUNT_CONFLICT', 'Начисление выходит за допустимые пределы');
    await tx.objectPayrollCredit.upsert({where: {objectId_sourceKey: {objectId, sourceKey}}, create: {objectId, employeeId, operationDate: dateOnly(date), sourceKey, amount, policySnapshot: json(policy), explanation, createdByUserId: userId}, update: {amount, policySnapshot: json(policy), explanation}});
    const data = {autoValue, dayValue: finalValue, difference: finalValue - autoValue, calculationExplanation: explanation, ...(entry?.ratePolicySnapshot ? {} : {ratePolicySnapshot: json(policy)}), updatedByUserId: userId};
    await tx.timesheetDayEntry.upsert({where: {rowId_dayOfMonth: {rowId: row.id, dayOfMonth}}, create: {rowId: row.id, dayOfMonth, ...data, createdByUserId: userId}, update: data});
  }

  async pricePolicyDay(tx: Prisma.TransactionClient, objectId: string, employeeId: string, date: string, policy: TimesheetRatePolicySnapshot, sourceKey: string, replacedEmployeeId?: string): Promise<number> {
    if (policy.ratePolicyType !== 'monthly_fixed') return policy.baseAmount;
    const [year, month, day] = date.split('-').map(Number); const half = day <= 15 ? 1 : 2;
    const from = `${year}-${String(month).padStart(2, '0')}-${half === 1 ? '01' : '16'}`;
    const to = `${year}-${String(month).padStart(2, '0')}-${half === 1 ? '15' : new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    const credits = await tx.objectPayrollCredit.findMany({where: {objectId, operationDate: {gte: dateOnly(from), lte: dateOnly(to)}, sourceKey: {not: sourceKey}}});
    const same = credits.filter(c => {const p = parseRatePolicySnapshot(c.policySnapshot); return p !== null && p.calculationVersion === COMPENSATION_CALCULATION_VERSION && p.ratePolicyType === 'monthly_fixed' && (policy.poolKey ? p.poolKey === policy.poolKey : !p.poolKey && (p.salaryOwnerEmployeeId ?? c.employeeId) === (policy.salaryOwnerEmployeeId ?? employeeId)) && !c.sourceKey.startsWith('extra:') && (c.policySnapshot as Prisma.JsonObject).payable !== false && !([employeeId, replacedEmployeeId].includes(c.employeeId) && c.operationDate.getTime() === dateOnly(date).getTime());});
    const norm = half === 1 ? policy.normDaysFirstHalf ?? null : policy.normDaysSecondHalf ?? null;
    const target = salaryHalf(policy.baseAmount, half, norm, 1);
    if (target.amount === null) conflict('SALARY_UNAVAILABLE', target.unavailableReason!);
    const fractions = same.map(c => {const p = parseRatePolicySnapshot(c.policySnapshot)!; const first = Math.round(p.baseAmount / 2); return {baseHalf: half === 1 ? first : p.baseAmount - first, norm: (half === 1 ? p.normDaysFirstHalf : p.normDaysSecondHalf)!};});
    const total = roundedSalaryFractions([...fractions, {baseHalf: target.baseHalf, norm: norm!}]);
    return total - same.reduce((sum, c) => sum + (typeof (c.policySnapshot as Prisma.JsonObject).baseAccruedAmount === 'number' ? Number((c.policySnapshot as Prisma.JsonObject).baseAccruedAmount) : c.amount), 0);
  }

  /** A reviewed removal/reconfirmation can change only the final rounding
   * residual. Keep original rate/fact snapshots; record that monetary delta. */
  async reconcileSalaryRounding(tx: Prisma.TransactionClient, actorUserId: string, objectId: string, employeeId: string, date: string, policy: TimesheetRatePolicySnapshot) {
    if (policy.ratePolicyType !== 'monthly_fixed' || policy.calculationVersion !== COMPENSATION_CALCULATION_VERSION) return;
    const [year, month, day] = date.split('-').map(Number); const half = day <= 15 ? 1 : 2;
    const from = new Date(Date.UTC(year, month - 1, half === 1 ? 1 : 16)); const to = new Date(Date.UTC(year, month - 1, half === 1 ? 16 : new Date(Date.UTC(year, month, 0)).getUTCDate() + 1));
    const credits = await tx.objectPayrollCredit.findMany({where: {objectId, operationDate: {gte: from, lt: to}}, orderBy: [{operationDate: 'desc'}, {sourceKey: 'desc'}]});
    const cohort = credits.filter(c => {const p = parseRatePolicySnapshot(c.policySnapshot); return p?.calculationVersion === COMPENSATION_CALCULATION_VERSION && p.ratePolicyType === 'monthly_fixed' && (policy.poolKey ? p.poolKey === policy.poolKey : !p.poolKey && (p.salaryOwnerEmployeeId ?? c.employeeId) === (policy.salaryOwnerEmployeeId ?? employeeId)) && (c.policySnapshot as Prisma.JsonObject).payable !== false && !c.sourceKey.startsWith('extra:');});
    if (!cohort.length) return;
    const target = roundedSalaryFractions(cohort.map(c => {const p = parseRatePolicySnapshot(c.policySnapshot)!; const first = Math.round(p.baseAmount / 2); return {baseHalf: half === 1 ? first : p.baseAmount - first, norm: (half === 1 ? p.normDaysFirstHalf : p.normDaysSecondHalf)!};}));
    const baseline = (c: typeof cohort[number]) => typeof (c.policySnapshot as Prisma.JsonObject).baseAccruedAmount === 'number' ? Number((c.policySnapshot as Prisma.JsonObject).baseAccruedAmount) : c.amount;
    const delta = target - cohort.reduce((sum, c) => sum + baseline(c), 0);
    if (!delta) return;
    const credit = cohort.find(c => typeof (c.policySnapshot as Prisma.JsonObject).shiftOverrideAmount !== 'number' && c.amount + delta >= 0) ?? cohort[0];
    const override = typeof (credit.policySnapshot as Prisma.JsonObject).shiftOverrideAmount === 'number';
    await this.postCredit(tx, actorUserId, objectId, credit.employeeId, credit.operationDate.toISOString().slice(0, 10), credit.sourceKey, override ? credit.amount : credit.amount + delta, {...credit.policySnapshot as Prisma.JsonObject, baseAccruedAmount: baseline(credit) + delta}, `Округление половины месяца после связанного исправления: ${delta > 0 ? '+' : ''}${delta} ₽`);
    await this.audit(tx, actorUserId, objectId, 'compensation.rounding.corrected', {sourceKey: credit.sourceKey, beforeAmount: credit.amount, afterAmount: override ? credit.amount : credit.amount + delta, baseRoundingDifference: delta});
  }

  async accrueTodayHolidays(objectId: string, actorUserId?: string) {
    return this.accrueHolidays(objectId, todayMoscow(), actorUserId);
  }

  /** Catch up since the explicit policy cutover. Past money is proposed for
   * independent approval, never silently backfilled after an outage. */
  async accrueHolidays(objectId: string, throughDate = todayMoscow(), actorUserId?: string) {
    dateOnly(throughDate);
    if (throughDate > todayMoscow()) throw new BadRequestException('Нельзя начислять будущие праздники');
    const first = await this.prisma.objectCompensationVersion.findFirst({where: {objectId, cancelledAt: null, effectiveFrom: {lte: dateOnly(throughDate)}}, orderBy: {effectiveFrom: 'asc'}});
    if (!first) return;
    const marker = await this.prisma.objectAuditLog.findFirst({where: {objectId, actionCode: 'compensation.holidays.scanned'}, orderBy: {createdAt: 'desc'}});
    const lastDate = (marker?.payload as Prisma.JsonObject | undefined)?.throughDate;
    const earliest = first.effectiveFrom.toISOString().slice(0, 10);
    const afterMarker = typeof lastDate === 'string' ? new Date(dateOnly(lastDate).getTime() + 86400000).toISOString().slice(0, 10) : earliest;
    const from = afterMarker > earliest ? afterMarker : earliest;
    for (let stamp = dateOnly(from).getTime(); stamp <= dateOnly(throughDate).getTime(); stamp += 86400000) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      if (isPublicHoliday(date)) await this.accrueHolidayDate(objectId, date, actorUserId);
    }
    const completed = new Date(dateOnly(throughDate).getTime() - 86400000).toISOString().slice(0, 10);
    if (completed >= earliest && (typeof lastDate !== 'string' || completed > lastDate)) await this.prisma.objectAuditLog.create({data: {objectId, actorUserId: actorUserId ?? first.createdByUserId, actionCode: 'compensation.holidays.scanned', payload: {throughDate: completed}}});
  }

  /** Holiday credits never manufacture a presence fact. */
  private async hasPaidHolidayExit(tx: Prisma.TransactionClient, objectId: string, employeeId: string, date: string, contourId?: string | null) {
    const fact = await tx.objectAttendanceFact.findFirst({where: {objectId, employeeId, operationDate: legacyFactDay(date)}});
    if (!fact) return false;
    if (fact.source !== 'shifts' || contourId === undefined) return true;
    return !!await tx.objectShiftAttendance.findFirst({where: {objectId, employeeId, operationDate: dateOnly(date), contourId, status: 'confirmed'}});
  }

  private async accrueHolidayDate(objectId: string, date: string, actorUserId?: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const object = await tx.object.findFirst({where: {id: objectId, deletedAt: null, status: {notIn: ['closed', 'archived', 'frozen']}}});
      if (!object) return;
      const positions = await tx.objectStaffPosition.findMany({where: {objectId}, include: {revisions: {orderBy: [{effectiveFrom: 'asc'}, {version: 'asc'}]}}});
      for (const position of positions) {
        const revisions = position.revisions.map(r => ({...r, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(), template: r.template as unknown as ScheduleRevisionView['template'], groups: r.groups as unknown as ScheduleRevisionView['groups']}));
        const revision = [...revisions].reverse().find(r => r.effectiveFrom <= date);
        if (!revision || revision.archived) continue;
        const preview = calendarPreview([{...position, revisions}], date, date);
        for (const shift of preview.shifts) {
          const assignment = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId: shift.employeeId}}});
          const instant = new Date(`${date}T12:00:00+03:00`);
          if (!assignment || (!assignment.isActive && !assignment.endDate) || (assignment.startDate && assignment.startDate > instant) || (assignment.endDate && assignment.endDate < instant)) continue;
          const unavailable = await tx.employeeAvailabilityWindow.findFirst({where: {employeeId: shift.employeeId, availabilityStatus: 'unavailable', startDate: {lt: new Date(shift.endsAt)}, OR: [{endDate: null}, {endDate: {gte: new Date(shift.startsAt)}}]}});
          const replaced = await tx.employeeSubstitution.findFirst({where: {employeeId: shift.employeeId, OR: [{objectId}, {objectId: null}], status: {in: ['active', 'planned']}, startDate: {lt: new Date(shift.endsAt)}, AND: [{OR: [{endDate: null}, {endDate: {gte: new Date(shift.startsAt)}}]}]}});
          if (unavailable || replaced || await this.hasPaidHolidayExit(tx, objectId, shift.employeeId, date, shift.contourId)) continue;
          const key = `holiday:${shift.employeeId}:${date}:${shift.contourId ?? 'default'}`;
          if (await tx.objectPayrollCredit.findUnique({where: {objectId_sourceKey: {objectId, sourceKey: key}}})) continue;
          // Missing terms/norm leave calculation explicitly unavailable; never save a false zero.
          let policy: TimesheetRatePolicySnapshot | null;
          try { policy = await this.resolvePolicy(tx, objectId, date, shift.employeeId, shift.contourId, revision, position.id); } catch (error) { if (error instanceof ConflictException) continue; throw error; }
          if (!policy || policy.ratePolicyType !== 'monthly_fixed' || policy.paidHolidays === false || policy.dailySlotCapacity === 0) continue;
          const occupied = policy.poolKey ? await tx.objectPayrollCredit.count({where: {objectId, operationDate: dateOnly(date), policySnapshot: {path: ['poolKey'], equals: policy.poolKey}, amount: {gt: 0}}}) : 0;
          if (occupied >= (policy.dailySlotCapacity ?? 1)) continue;
          const amount = await this.pricePolicyDay(tx, objectId, shift.employeeId, date, policy, key);
          if (date < todayMoscow()) {
            const input: CreateCompensationAdjustmentDto = {requestKey: `holiday-catchup:${key}`, kind: 'holiday_exception', operationDate: date, employeeId: shift.employeeId, contourId: shift.contourId, paid: true, reason: 'Оплата пропущенного праздника по сохранённому назначению и условиям'};
            const before = await this.unsavedHolidaySource(tx, objectId, shift.employeeId, date, shift.contourId);
            await this.request(tx, {id: actorUserId ?? revision.createdByUserId}, objectId, input, input, before);
          } else await this.postCredit(tx, actorUserId ?? revision.createdByUserId, objectId, shift.employeeId, date, key, amount, policy, `Оплачиваемый праздник, без факта присутствия. ${amount} ₽`);
        }
      }
    });
  }

  async request(tx: Prisma.TransactionClient, user: Pick<SchedulingUser, 'id'>, objectId: string, input: {requestKey: string; kind: string; operationDate: string; reason: string; employeeId?: string; attendanceId?: string; amount?: number}, payload: unknown, before: unknown) {
    const existing = await tx.objectCompensationAdjustment.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}});
    if (existing) {
      if (existing.kind !== input.kind || !isDeepStrictEqual(existing.payload, json(payload))) conflict('REQUEST_KEY_REUSED', 'Ключ финансового запроса уже использован');
      const approval = await tx.approvalRequest.findFirst({where: {approvalType: COMPENSATION_APPROVAL_TYPE, sourceEntityId: existing.id}});
      return {status: existing.status, adjustmentId: existing.id, approvalRequestId: approval?.id ?? null};
    }
    const adjustment = await tx.objectCompensationAdjustment.create({data: {objectId, requestKey: input.requestKey, kind: input.kind, operationDate: dateOnly(input.operationDate), employeeId: input.employeeId, attendanceId: input.attendanceId, amount: input.amount, reason: input.reason.trim(), payload: json(payload), beforeSnapshot: json(before), createdByUserId: user.id}});
    const retroactive = input.operationDate < todayMoscow();
    if (retroactive) {
      const object = await tx.object.findUniqueOrThrow({where: {id: objectId}, select: {name: true}});
      const employee = input.employeeId ? await tx.employee.findUnique({where: {id: input.employeeId}, select: {fullName: true}}) : null;
      const source = json(before) as Prisma.JsonObject;
      const beforeAmount = input.kind === 'extra_work' ? 0 : typeof source.amount === 'number' ? source.amount : typeof source.dailyRateSnapshot === 'number' ? source.dailyRateSnapshot : null;
      const requested = json(payload) as Prisma.JsonObject;
      const replacement = typeof requested.replacementEmployeeId === 'string' ? await tx.employee.findUnique({where: {id: requested.replacementEmployeeId}, select: {fullName: true}}) : null;
      const afterAmount = input.kind === 'replacement' ? beforeAmount : input.kind === 'holiday_exception' ? requested.paid ? beforeAmount : 0 : input.amount ?? null;
      const approval = await tx.approvalRequest.create({data: {approvalType: COMPENSATION_APPROVAL_TYPE, sourceEntityType: 'object_compensation_adjustment', sourceEntityId: adjustment.id, createdByUserId: user.id, payloadSnapshot: {summaryTitle: 'Исправление начисления объекта', summarySubtitle: input.reason, objectId, objectName: object.name, employeeName: employee?.fullName ?? null, replacementEmployeeName: replacement?.fullName ?? null, beforeAmount, afterAmount, difference: beforeAmount !== null && afterAmount !== null ? afterAmount - beforeAmount : null, operationDate: input.operationDate, kind: input.kind, before: json(before), requested, reason: input.reason, independentLeadershipRequired: true}}});
      await this.audit(tx, user.id, objectId, 'compensation.adjustment.requested', {adjustmentId: adjustment.id, approvalRequestId: approval.id, ...input});
      return {status: 'pending', adjustmentId: adjustment.id, approvalRequestId: approval.id};
    }
    return {status: 'ready', adjustmentId: adjustment.id, approvalRequestId: null};
  }

  async adjustment(user: SchedulingUser, objectId: string, input: CreateCompensationAdjustmentDto, afterApply: (tx: Prisma.TransactionClient, id: string) => Promise<void>) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId); dateOnly(input.operationDate);
      if (input.operationDate > todayMoscow()) conflict('FUTURE_FINANCIAL_FACT', 'Будущее начисление нельзя подтверждать заранее');
      if (!input.reason.trim()) throw new BadRequestException('Укажите основание');
      if (input.kind !== 'extra_work') this.rateAccess(user);
      else if (!canEditObjectDailyRate(roles(user)) && !await tx.objectAssignment.findFirst({where: {objectId, userId: user.id, isActive: true, assignmentRoleCode: 'manager'}})) throw new ForbiddenException('Допработу вводит назначенный менеджер или руководитель с правом ставок');
      const replay = await tx.objectCompensationAdjustment.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}});
      if (replay) return this.request(tx, user, objectId, input, input, replay.beforeSnapshot);
      const before = await this.validateAdjustment(tx, objectId, input);
      const request = await this.request(tx, user, objectId, input, input, before);
      if (request.status === 'ready') {
        await this.applyAdjustment(tx, await tx.objectCompensationAdjustment.findUniqueOrThrow({where: {id: request.adjustmentId}}), user.id);
        await afterApply(tx, request.adjustmentId);
      }
      return {...request, status: request.status === 'ready' ? 'applied' : request.status};
    });
  }
  private async validateAdjustment(tx: Prisma.TransactionClient, objectId: string, input: CreateCompensationAdjustmentDto) {
    if (input.kind === 'extra_work') {
      if (!input.employeeId || input.amount === undefined) throw new BadRequestException('Для допработы укажите сотрудника и сумму');
      const employee = await tx.employee.findFirst({where: {id: input.employeeId, deletedAt: null, employmentStatus: 'active'}});
      const assignment = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId: input.employeeId}}});
      const start = new Date(`${input.operationDate}T00:00:00+03:00`); const end = new Date(start.getTime() + 86400000);
      const scoped = assignment && (!assignment.startDate || assignment.startDate < end) && (!assignment.endDate || assignment.endDate >= start);
      const substitution = await tx.employeeSubstitution.findFirst({where: {objectId, substituteEmployeeId: input.employeeId, status: {in: ['planned', 'active']}, startDate: {lt: end}, OR: [{endDate: null}, {endDate: {gte: start}}]}});
      if (!employee || (!scoped && !substitution)) throw new ForbiddenException('Сотрудник не относится к объекту на дату допработы');
      return {employeeId: input.employeeId, amount: 0};
    }
    if (input.kind === 'holiday_exception') {
      if (!input.employeeId || input.paid === undefined || !isPublicHoliday(input.operationDate)) throw new BadRequestException('Укажите сотрудника, праздник и признак оплаты');
      const sourceKey = input.contourId !== undefined ? `holiday:${input.employeeId}:${input.operationDate}:${input.contourId ?? 'default'}` : {startsWith: 'holiday:'};
      const credits = await tx.objectPayrollCredit.findMany({where: {objectId, employeeId: input.employeeId, operationDate: dateOnly(input.operationDate), sourceKey}});
      if (input.paid && await this.hasPaidHolidayExit(tx, objectId, input.employeeId, input.operationDate, input.contourId)) conflict('HOLIDAY_ALREADY_PAID', 'Праздничный день уже учитывается фактическим выходом этого контура');
      if (credits.length > 1) conflict('HOLIDAY_CREDIT_UNAVAILABLE', 'Для праздника есть несколько контуров; требуется однозначное начисление');
      if (credits.length === 1) return credits[0];
      return this.unsavedHolidaySource(tx, objectId, input.employeeId, input.operationDate, input.contourId);
    }
    if (!input.attendanceId || !input.expectedVersion) throw new BadRequestException('Укажите выход и его ожидаемую версию');
    const shift = await tx.objectShiftAttendance.findFirst({where: {id: input.attendanceId, objectId}});
    if (!shift || shift.status !== 'confirmed' || shift.operationDate.getTime() !== dateOnly(input.operationDate).getTime() || shift.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Исходный выход изменён или не найден');
    if (input.kind === 'shift_override' && input.amount === undefined) throw new BadRequestException('Укажите новую цену выхода');
    if (input.kind === 'replacement') {
      if (!input.replacementEmployeeId || !input.substitutionId || input.replacementEmployeeId === shift.employeeId) throw new BadRequestException('Выберите другого сменщика и кадровую подмену');
      const substitution = await tx.employeeSubstitution.findFirst({where: {id: input.substitutionId, objectId, employeeId: shift.employeeId, substituteEmployeeId: input.replacementEmployeeId, status: {in: ['planned', 'active']}, startDate: {lte: shift.startsAt}, OR: [{endDate: null}, {endDate: {gte: shift.endsAt}}]}});
      if (!substitution) throw new BadRequestException('Кадровая подмена не покрывает исходную смену');
      const [year, month, dayOfMonth] = input.operationDate.split('-').map(Number);
      if (await tx.timesheetDayEntry.findFirst({where: {dayOfMonth, isChangedManually: true, row: {employeeId: shift.employeeId, timesheetMonth: {objectId, year, month}}}})) conflict('MANUAL_DAY_REQUIRES_RECONCILIATION', 'В дне основного сотрудника есть отдельная ручная сумма. Сначала согласуйте её восстановление, чтобы не оплатить подмену дважды');
      const unavailable = await tx.employeeAvailabilityWindow.findFirst({where: {employeeId: input.replacementEmployeeId, availabilityStatus: 'unavailable', startDate: {lt: shift.endsAt}, OR: [{endDate: null}, {endDate: {gt: shift.startsAt}}]}});
      const busy = await tx.objectShiftAttendance.findFirst({where: {employeeId: input.replacementEmployeeId, status: 'confirmed', startsAt: {lt: shift.endsAt}, endsAt: {gt: shift.startsAt}}});
      if (unavailable || busy) conflict('SUBSTITUTE_UNAVAILABLE', 'Сменщик недоступен или уже подтвердил пересекающуюся смену');
    }
    return shift;
  }

  private async unsavedHolidaySource(tx: Prisma.TransactionClient, objectId: string, employeeId: string, date: string, contourId?: string | null) {
    const positions = await tx.objectStaffPosition.findMany({where: {objectId}, include: {revisions: {orderBy: [{effectiveFrom: 'asc'}, {version: 'asc'}]}}});
    const sources: Array<{amount: number; employeeId: string; sourceKey: string; policySnapshot: Prisma.InputJsonValue}> = [];
    for (const position of positions) {
      const revisions = position.revisions.map(r => ({...r, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(), template: r.template as unknown as ScheduleRevisionView['template'], groups: r.groups as unknown as ScheduleRevisionView['groups']}));
      const revision = [...revisions].reverse().find(r => r.effectiveFrom <= date);
      if (!revision || revision.archived) continue;
      const shifts = calendarPreview([{...position, revisions}], date, date).shifts.filter(s => s.employeeId === employeeId && (contourId === undefined || s.contourId === contourId));
      for (const shift of shifts) {
        const start = new Date(shift.startsAt); const end = new Date(shift.endsAt);
        if (await tx.employeeAvailabilityWindow.findFirst({where: {employeeId, availabilityStatus: 'unavailable', startDate: {lt: end}, OR: [{endDate: null}, {endDate: {gte: start}}]}})) continue;
        if (await tx.employeeSubstitution.findFirst({where: {employeeId, OR: [{objectId}, {objectId: null}], status: {in: ['planned', 'active']}, startDate: {lt: end}, AND: [{OR: [{endDate: null}, {endDate: {gte: start}}]}]}})) continue;
        const policy = await this.resolvePolicy(tx, objectId, date, employeeId, shift.contourId, revision, position.id);
        if (!policy || policy.ratePolicyType !== 'monthly_fixed') continue;
        const sourceKey = `holiday:${employeeId}:${date}:${shift.contourId ?? 'default'}`;
        if (!sources.some(s => s.sourceKey === sourceKey)) sources.push({amount: 0, employeeId, sourceKey, policySnapshot: json(policy)});
      }
    }
    if (sources.length !== 1) conflict('HOLIDAY_CREDIT_UNAVAILABLE', 'Нет однозначного действующего назначения и месячных условий на праздник');
    return sources[0];
  }

  async applyAdjustment(tx: Prisma.TransactionClient, item: ObjectCompensationAdjustment, actorUserId: string) {
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${item.objectId} FOR UPDATE`;
    if (item.kind === 'extra_work_correction') {
      const payload = item.payload as unknown as CorrectExtraWorkDto & {sourceAdjustmentId: string};
      const credit = await this.extraWorkSource(tx, item.objectId, payload.sourceAdjustmentId, payload.expectedCreditUpdatedAt);
      if (!isDeepStrictEqual(json(credit), item.beforeSnapshot)) conflict('VERSION_CONFLICT', 'Допработа изменена после подачи заявки');
      await this.postCredit(tx, actorUserId, item.objectId, credit.employeeId, item.operationDate.toISOString().slice(0, 10), credit.sourceKey, payload.amount, {...credit.policySnapshot as Prisma.JsonObject, correctionId: item.id}, `Допработа: ${payload.amount} ₽. Исправление: ${payload.reason}`);
      await tx.objectCompensationAdjustment.update({where: {id: item.id}, data: {status: 'applied', appliedAt: new Date(), appliedByUserId: actorUserId, afterSnapshot: json(payload)}});
      await this.audit(tx, actorUserId, item.objectId, 'compensation.extra_work.corrected', {adjustmentId: item.id, sourceAdjustmentId: payload.sourceAdjustmentId, beforeAmount: credit.amount, afterAmount: payload.amount, difference: payload.amount - credit.amount, reason: payload.reason});
      return;
    }
    const input = item.payload as unknown as CreateCompensationAdjustmentDto;
    const before = await this.validateAdjustment(tx, item.objectId, input);
    if (!isDeepStrictEqual(json(before), item.beforeSnapshot)) conflict('VERSION_CONFLICT', 'Начисление изменено после подачи заявки');
    if (input.kind === 'extra_work') {
      await this.postCredit(tx, actorUserId, item.objectId, input.employeeId!, input.operationDate, `extra:${item.id}`, input.amount!, {kind: 'extra_work', adjustmentId: item.id}, `Допработа +${input.amount} ₽. Основание: ${input.reason}`);
    } else if (input.kind === 'holiday_exception') {
      const credit = before as {employeeId: string; sourceKey: string; amount: number; policySnapshot: Prisma.JsonValue};
      const policy = parseRatePolicySnapshot(credit.policySnapshot);
      const amount = input.paid ? policy ? await this.pricePolicyDay(tx, item.objectId, input.employeeId!, input.operationDate, policy, credit.sourceKey) : credit.amount : 0;
      await this.postCredit(tx, actorUserId, item.objectId, input.employeeId!, input.operationDate, credit.sourceKey, amount, {...credit.policySnapshot as Prisma.JsonObject, payable: input.paid}, `Исключение оплаты праздника: ${input.reason}`);
      if (policy) await this.reconcileSalaryRounding(tx, actorUserId, item.objectId, input.employeeId!, input.operationDate, policy);
    } else {
      const shift = before as Awaited<ReturnType<typeof tx.objectShiftAttendance.findUniqueOrThrow>>;
      if (input.kind === 'shift_override') {
        const peers = await tx.objectShiftAttendance.findMany({where: {objectId: item.objectId, employeeId: shift.employeeId, contourId: shift.contourId, operationDate: shift.operationDate, status: 'confirmed'}});
        for (const peer of peers) await tx.objectShiftAttendance.update({where: {id: peer.id}, data: {dailyRateSnapshot: input.amount!, ratePolicySnapshot: json({...peer.ratePolicySnapshot as Prisma.JsonObject, baseAccruedAmount: (peer.ratePolicySnapshot as Prisma.JsonObject).baseAccruedAmount ?? peer.dailyRateSnapshot, shiftOverrideAmount: input.amount!, overrideReason: input.reason, adjustmentId: item.id}), version: {increment: 1}}});
      } else {
        const peers = await tx.objectShiftAttendance.findMany({where: {objectId: item.objectId, employeeId: shift.employeeId, contourId: shift.contourId, operationDate: shift.operationDate, status: 'confirmed'}});
        const key = `holiday:${shift.employeeId}:${input.operationDate}:${shift.contourId ?? 'default'}`;
        const holiday = await tx.objectPayrollCredit.findUnique({where: {objectId_sourceKey: {objectId: item.objectId, sourceKey: key}}});
        if (holiday) await this.postCredit(tx, actorUserId, item.objectId, shift.employeeId, input.operationDate, key, 0, {...holiday.policySnapshot as Prisma.JsonObject, payable: false}, 'Праздничная оплата передана сменщику');
        for (const peer of peers) await tx.objectShiftAttendance.update({where: {id: peer.id}, data: {employeeId: input.replacementEmployeeId!, version: {increment: 1}}});
      }
    }
    // The scheduling owner updates aggregates in the same transaction after this.
    await tx.objectCompensationAdjustment.update({where: {id: item.id}, data: {status: 'applied', appliedAt: new Date(), appliedByUserId: actorUserId, afterSnapshot: json(input)}});
    await this.audit(tx, actorUserId, item.objectId, 'compensation.adjustment.applied', {adjustmentId: item.id, before, after: input, reason: item.reason, requestedByUserId: item.createdByUserId});
  }

  private async extraWorkSource(tx: Prisma.TransactionClient, objectId: string, id: string, expectedCreditUpdatedAt: string) {
    const source = await tx.objectCompensationAdjustment.findFirst({where: {id, objectId, kind: 'extra_work', status: 'applied'}});
    if (!source) throw new NotFoundException('Начисленная допработа не найдена');
    const credit = await tx.objectPayrollCredit.findUnique({where: {objectId_sourceKey: {objectId, sourceKey: `extra:${id}`}}});
    if (!credit || credit.updatedAt.toISOString() !== expectedCreditUpdatedAt) conflict('VERSION_CONFLICT', 'Сумма допработы уже изменилась. Обновите данные');
    return credit;
  }

  /** amount=0 cancels only this extra earning; the primary exit is untouched. */
  async correctExtraWork(user: SchedulingUser, objectId: string, id: string, input: CorrectExtraWorkDto) {
    return this.prisma.$transaction(async tx => {
      const object = await this.lock(tx, user, objectId);
      if (!canEditObjectDailyRate(roles(user)) && !object.assignments.some(a => a.userId === user.id && a.assignmentRoleCode === 'manager')) throw new ForbiddenException('Нет права исправлять допработу этого объекта');
      if (!input.reason.trim()) throw new BadRequestException('Укажите основание исправления');
      const payload = {sourceAdjustmentId: id, ...input};
      const replay = await tx.objectCompensationAdjustment.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}});
      if (replay) return this.request(tx, user, objectId, {requestKey: input.requestKey, kind: 'extra_work_correction', operationDate: replay.operationDate.toISOString().slice(0, 10), reason: input.reason}, payload, replay.beforeSnapshot);
      const credit = await this.extraWorkSource(tx, objectId, id, input.expectedCreditUpdatedAt);
      const request = await this.request(tx, user, objectId, {requestKey: input.requestKey, kind: 'extra_work_correction', operationDate: credit.operationDate.toISOString().slice(0, 10), employeeId: credit.employeeId, amount: input.amount, reason: input.reason}, payload, credit);
      if (request.status === 'ready') await this.applyAdjustment(tx, await tx.objectCompensationAdjustment.findUniqueOrThrow({where: {id: request.adjustmentId}}), user.id);
      return {...request, status: request.status === 'ready' ? 'applied' : request.status};
    });
  }

  async explanation(user: SchedulingUser, objectId: string, year: number, month: number) {
    await this.access(this.prisma, user, objectId);
    const from = `${year}-${String(month).padStart(2, '0')}-01`; const to = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    const credits = await this.prisma.objectPayrollCredit.findMany({where: {objectId, operationDate: {gte: dateOnly(from), lte: dateOnly(to)}}, orderBy: [{operationDate: 'asc'}, {sourceKey: 'asc'}]});
    const employees = await this.prisma.employee.findMany({where: {id: {in: [...new Set(credits.map(c => c.employeeId))]}}, select: {id: true, fullName: true}});
    const rows = employees.map(employee => {
      const entries = credits.filter(c => c.employeeId === employee.id);
      const policies = new Map<string, TimesheetRatePolicySnapshot>();
      for (const entry of entries) {const p = parseRatePolicySnapshot(entry.policySnapshot); if (p) policies.set(`${p.compensationVersionId}:${p.poolKey ?? ''}`, p);}
      const explanations = [...policies].flatMap(([key, p]) => ([1, 2] as const).map(half => {
        const days = entries.filter(c => {const policy = parseRatePolicySnapshot(c.policySnapshot); return `${policy?.compensationVersionId}:${policy?.poolKey ?? ''}` === key && (c.operationDate.getUTCDate() <= 15 ? 1 : 2) === half && c.amount > 0;});
        return p.ratePolicyType === 'monthly_fixed' ? {...salaryHalf(p.baseAmount, half, half === 1 ? p.normDaysFirstHalf ?? null : p.normDaysSecondHalf ?? null, days.length, days.filter(c => c.sourceKey.startsWith('holiday:')).length), compensationVersionId: p.compensationVersionId, poolKey: p.poolKey ?? null, savedAmount: days.reduce((sum, c) => sum + c.amount, 0)} : null;
      }).filter(Boolean));
      return {employeeId: employee.id, employeeName: employee.fullName, explanations, entries: entries.map(c => ({...c, operationDate: c.operationDate.toISOString().slice(0, 10)})), advanceTotal: entries.filter(c => c.operationDate.getUTCDate() <= 15).reduce((sum, c) => sum + c.amount, 0), salaryTotal: entries.filter(c => c.operationDate.getUTCDate() > 15).reduce((sum, c) => sum + c.amount, 0)};
    });
    return {objectId, year, month, calculationVersion: COMPENSATION_CALCULATION_VERSION, rows, unavailableReason: rows.length ? null : 'В этом месяце нет сохранённых начислений новой версии. История не пересчитывается при просмотре.'};
  }
}
