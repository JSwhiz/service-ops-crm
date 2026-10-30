import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import type { ObjectShiftAttendance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimesheetsService } from '../timesheets/timesheets.service';
import { canCreateObject, canEditObjectDailyRate, canViewObjectByScope } from '../objects/utils/object-access.util';
import { annualSeason, seasonalCompensation } from '../objects/utils/object-season.util';
import { canManageEmployeeAssignments } from '../employees/utils/employee-hr-access.util';
import { canManuallyCorrectTimesheet } from '../timesheets/utils/timesheet-access.util';
import { buildObjectDefaultRatePolicy, calculateMonthlySalaryDailyRate, normalizeRatePolicy, parseRatePolicySnapshot, pinRatePolicyProductionCalendar } from '../timesheets/utils/timesheet-rate-policy.util';
import { usedObjectDelegations } from '../user-substitutions/object-delegation.context';
import { ArchivePositionDto, CancelShiftDto, ConfirmShiftDto, CreateContourDto, CreatePositionDto, DateRangeDto, EmployeeOptionsDto, PositionFieldsDto, PreviewDto, SavePositionDto, UpdateContourDto } from './scheduling.dto';
import type { PositionView, SchedulingUser } from './scheduling.types';
import { boundedDates, calendarPreview, dateOnly, legacyFactDay, legacyFactRange, todayMoscow, validatePlan } from './scheduling-calendar';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const roles = (user: SchedulingUser) => user.roleCodes?.length ? user.roleCodes : [user.roleCode];
function conflict(code: string, message: string): never { throw new ConflictException({code, message}); }
const dayStart = (date: string) => new Date(`${date}T00:00:00+03:00`);
const dayEnd = (date: string) => new Date(dayStart(date).getTime() + 86400000);
const positionInclude = {revisions: {orderBy: [{effectiveFrom: 'asc' as const}, {version: 'asc' as const}]}};
type PositionRecord = Prisma.ObjectStaffPositionGetPayload<{include: typeof positionInclude}>;

@Injectable()
export class ObjectSchedulingService {
  constructor(private readonly prisma: PrismaService, private readonly timesheets: TimesheetsService) {}

  private async access(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, write = false) {
    const object = await tx.object.findFirst({where: {id: objectId, deletedAt: null}, include: {assignments: {where: {isActive: true}}, planningSettings: true}});
    if (!object) throw new NotFoundException('Объект не найден');
    if (!user.isActive || !canViewObjectByScope({currentUserId: user.id, roleCodes: roles(user), ownScopeOnly: true, object})) throw new ForbiddenException('Нет доступа к графикам объекта');
    if (write && ['frozen', 'archived', 'closed'].includes(object.status)) conflict('OBJECT_READ_ONLY', 'Объект заморожен, закрыт или архивирован');
    return object;
  }
  private async lock(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string) {
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
    return this.access(tx, user, objectId, true);
  }
  private rateAccess(user: SchedulingUser) {
    if (!canEditObjectDailyRate(roles(user))) throw new ForbiddenException('Для изменения контуров оплаты нужны права управления ставками');
  }
  private async selectPayConditions(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string) {
    return canEditObjectDailyRate(roles(user)) || !!await tx.objectAssignment.findFirst({where: {objectId, userId: user.id, isActive: true, assignmentRoleCode: 'manager'}, select: {id: true}});
  }
  private view(item: PositionRecord): PositionView {
    return {...item, revisions: item.revisions.map(r => ({...r, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(), template: r.template as unknown as PositionView['revisions'][number]['template'], groups: r.groups as unknown as PositionView['revisions'][number]['groups']}))};
  }
  private async position(tx: Prisma.TransactionClient, objectId: string, id: string) {
    const item = await tx.objectStaffPosition.findFirst({where: {objectId, id}, include: positionInclude});
    if (!item) throw new NotFoundException('Позиция не найдена');
    return item;
  }
  async list(user: SchedulingUser, objectId: string) {
    const object = await this.access(this.prisma, user, objectId);
    const writable = !['frozen', 'archived', 'closed'].includes(object.status);
    return {positions: (await this.prisma.objectStaffPosition.findMany({where: {objectId}, include: positionInclude, orderBy: {id: 'asc'}})).map(x => this.view(x)), capabilities: {managePositions: writable, manageAssignments: writable && canManageEmployeeAssignments(user.permissionCodes ?? []), manageRates: writable && canEditObjectDailyRate(roles(user)), selectPayConditions: writable && await this.selectPayConditions(this.prisma, user, objectId), confirmAttendance: writable}};
  }
  async get(user: SchedulingUser, objectId: string, id: string) {
    await this.access(this.prisma, user, objectId); return this.view(await this.position(this.prisma, objectId, id));
  }
  private fields(input: PositionFieldsDto) {
    return {name: input.name.trim(), headcount: input.headcount ?? null, requiredPerShift: input.requiredPerShift ?? 1, effectiveFrom: dateOnly(input.effectiveFrom), template: json(input.template), groups: json(input.groups)};
  }
  private async validateReferences(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, input: PositionFieldsDto, previous?: PositionView['revisions'][number], persistAssignments = true) {
    validatePlan(input);
    const prior = new Map(previous?.groups.flatMap(g => g.timeRanges.map(r => [`${g.key}:${r.key}`, r.contourId ?? null] as const)) ?? []);
    const contourIds = new Set<string>();
    let payBindingChanged = false;
    for (const group of input.groups) for (const range of group.timeRanges) {
      const contour = range.contourId ?? null;
      if (contour !== (prior.get(`${group.key}:${range.key}`) ?? null)) payBindingChanged = true;
      if (contour) contourIds.add(contour);
    }
    if (payBindingChanged && !await this.selectPayConditions(tx, user, objectId)) throw new ForbiddenException('Выбор готовых условий оплаты доступен назначенному менеджеру объекта или пользователю с правом управления ставками');
    if (await tx.objectPayContour.count({where: {id: {in: [...contourIds]}, objectId, isActive: true}}) !== contourIds.size) throw new BadRequestException('Указан неизвестный или неактивный контур оплаты объекта');
    const employeeIds = [...new Set(input.groups.flatMap(g => g.assignments.map(a => a.employeeId)))];
    const employees = await tx.employee.findMany({where: {id: {in: employeeIds}, deletedAt: null, employmentStatus: 'active'}, select: {id: true}});
    if (employees.length !== employeeIds.length) throw new BadRequestException('Назначить можно только существующего активного сотрудника');
    const canAssign = canManageEmployeeAssignments(user.permissionCodes ?? []);
    for (const employeeId of employeeIds) {
      const assignments = input.groups.flatMap(g => g.assignments.filter(a => a.employeeId === employeeId));
      const start = assignments.map(a => a.from).sort()[0];
      const end = assignments.some(a => !a.to) ? null : assignments.map(a => a.to!).sort().at(-1)!;
      if (await this.employeeScoped(tx, objectId, employeeId, start, end)) continue;
      if (!canAssign) throw new ForbiddenException('Сначала назначьте сотрудника на объект; требуется employees.assignments.manage');
      if (!persistAssignments) continue;
      const existing = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId}}});
      if (existing?.isActive) throw new BadRequestException('Даты назначения в группу выходят за период назначения на объект');
      await tx.objectEmployeeAssignment.upsert({where: {objectId_employeeId: {objectId, employeeId}}, create: {objectId, employeeId, startDate: dayStart(start), endDate: end ? dayEnd(end) : null}, update: {isActive: true, startDate: dayStart(start), endDate: end ? dayEnd(end) : null}});
      await tx.employeeObjectAssignmentHistory.create({data: {objectId, employeeId, startedAt: dayStart(start), createdByUserId: user.id}});
      await this.audit(tx, user, objectId, 'scheduling_employee_assigned', {employeeId, start, end});
    }
  }
  private async employeeScoped(tx: Prisma.TransactionClient, objectId: string, employeeId: string, from: string, to: string | null = from) {
    const assignment = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId}}});
    if (assignment?.isActive && (!assignment.startDate || assignment.startDate <= dayStart(from)) && (!assignment.endDate || (to !== null && assignment.endDate >= dayStart(to)))) return true;
    return !!await tx.employeeSubstitution.findFirst({where: {objectId, substituteEmployeeId: employeeId, status: {in: ['planned', 'active']}, startDate: {lte: dayStart(from)}, ...(to === null ? {endDate: null} : {OR: [{endDate: null}, {endDate: {gte: dayStart(to)}}]})}});
  }
  private async audit(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, action: string, data: unknown) {
    await tx.objectAuditLog.create({data: {objectId, actorUserId: user.id, actionCode: action, payload: json({data, delegations: usedObjectDelegations()})}});
  }
  /** Called by object creation inside its existing transaction; no nested transaction. */
  async createPositionsInTransaction(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, positions: CreatePositionDto[]) {
    if (positions.length > 100) throw new BadRequestException('Не более 100 позиций');
    await this.lock(tx, user, objectId);
    const result: PositionView[] = [];
    for (const input of positions) {
      const existing = await tx.objectStaffPosition.findUnique({where: {objectId_clientKey: {objectId, clientKey: input.clientKey}}, include: positionInclude});
      if (existing) {
        const first = existing.revisions[0]; const fields = this.fields(input);
        if (first.name !== fields.name || first.headcount !== fields.headcount || first.requiredPerShift !== fields.requiredPerShift || first.effectiveFrom.getTime() !== fields.effectiveFrom.getTime() || !isDeepStrictEqual(first.template, json(input.template)) || !isDeepStrictEqual(first.groups, json(input.groups))) conflict('REQUEST_KEY_REUSED', 'Ключ позиции уже использован с другими данными');
        result.push(this.view(existing)); continue;
      }
      if (input.effectiveFrom < todayMoscow()) conflict('HISTORY_PROTECTED', 'Новая версия графика не может начинаться в прошлом');
      await this.validateReferences(tx, user, objectId, input);
      const item = await tx.objectStaffPosition.create({data: {objectId, clientKey: input.clientKey, revisions: {create: {...this.fields(input), version: 1, createdByUserId: user.id}}}, include: positionInclude});
      await this.audit(tx, user, objectId, 'scheduling_position_created', {positionId: item.id, version: 1});
      result.push(this.view(item));
    }
    return result;
  }
  async create(user: SchedulingUser, objectId: string, input: CreatePositionDto) {
    return this.prisma.$transaction(async tx => (await this.createPositionsInTransaction(tx, user, objectId, [input]))[0]);
  }
  async save(user: SchedulingUser, objectId: string, id: string, input: SavePositionDto | ArchivePositionDto) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId);
      const existing = await this.position(tx, objectId, id);
      const prior = [...this.view(existing).revisions].reverse().find(revision => revision.effectiveFrom <= input.effectiveFrom);
      if (existing.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'График изменён другим пользователем; перечитайте позицию');
      if (input.effectiveFrom < todayMoscow()) conflict('HISTORY_PROTECTED', 'Новая версия должна начинаться не раньше сегодня');
      const archived = 'reason' in input;
      if (archived && !prior) conflict('POSITION_NOT_EFFECTIVE', 'На указанную дату нет действующей версии позиции');
      const plan: PositionFieldsDto = archived ? {...prior!, effectiveFrom: input.effectiveFrom} : input;
      await this.validateReferences(tx, user, objectId, plan, prior);
      const version = existing.version + 1;
      await tx.objectScheduleVersion.create({data: {positionId: id, ...this.fields(plan), version, archived, createdByUserId: user.id}});
      await tx.objectStaffPosition.update({where: {id}, data: {version}});
      await this.audit(tx, user, objectId, archived ? 'scheduling_position_archived' : 'scheduling_position_versioned', {positionId: id, version, effectiveFrom: input.effectiveFrom, reason: archived ? input.reason.trim() : undefined});
      return this.view(await this.position(tx, objectId, id));
    });
  }
  async contours(user: SchedulingUser, objectId: string) {
    await this.access(this.prisma, user, objectId);
    return {contours: await this.prisma.objectPayContour.findMany({where: {objectId}, orderBy: {code: 'asc'}})};
  }
  async createContour(user: SchedulingUser, objectId: string, input: CreateContourDto) {
    return this.prisma.$transaction(async tx => (await this.createContoursInTransaction(tx, user, objectId, [input]))[0]);
  }
  async createContoursInTransaction(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, contours: CreateContourDto[]) {
    if (contours.length > 100) throw new BadRequestException('Не более 100 контуров оплаты');
    if (!contours.length) return [];
    this.rateAccess(user);
    await this.lock(tx, user, objectId);
    const result = [];
    for (const input of contours) {
      if (await tx.objectPayContour.findUnique({where: {objectId_code: {objectId, code: input.code}}})) conflict('CONTOUR_EXISTS', 'Код контура уже существует');
      const contour = await tx.objectPayContour.create({data: {...input, objectId, effectiveFrom: dateOnly(todayMoscow())}});
      await this.audit(tx, user, objectId, 'scheduling_contour_created', {contourId: contour.id}); result.push(contour);
    }
    return result;
  }
  async updateContour(user: SchedulingUser, objectId: string, id: string, input: UpdateContourDto) {
    this.rateAccess(user);
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId);
      const prior = await tx.objectPayContour.findFirst({where: {id, objectId}});
      if (!prior) throw new NotFoundException('Контур не найден');
      if (prior.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Контур изменён другим пользователем');
      const {expectedVersion, ...changes} = input;
      const contour = await tx.objectPayContour.update({where: {id}, data: {...changes, version: expectedVersion + 1, effectiveFrom: dateOnly(todayMoscow())}});
      await this.audit(tx, user, objectId, 'scheduling_contour_updated', {contourId: id, version: contour.version}); return contour;
    });
  }
  async employees(user: SchedulingUser, objectId: string, query: EmployeeOptionsDto) {
    await this.access(this.prisma, user, objectId); dateOnly(query.date);
    const directory = canManageEmployeeAssignments(user.permissionCodes ?? []) && (user.permissionCodes ?? []).includes('employees.view');
    const employees = await this.prisma.employee.findMany({where: {deletedAt: null, employmentStatus: 'active', ...(query.q ? {fullName: {contains: query.q, mode: 'insensitive'}} : {}), ...(!directory ? {OR: [{objectAssignments: {some: {objectId, isActive: true}}}, {substitutionsAsReplacement: {some: {objectId, status: {in: ['active', 'planned']}, startDate: {lt: dayEnd(query.date)}, OR: [{endDate: null}, {endDate: {gte: dayStart(query.date)}}]}}}]} : {})}, select: {id: true, fullName: true}, orderBy: {fullName: 'asc'}, take: 200});
    return {employees: await Promise.all(employees.map(async employee => { const warnings = await this.employeeWarnings(this.prisma, objectId, employee.id, query.date, dayStart(query.date), dayEnd(query.date)); return {...employee, available: !warnings.includes('UNAVAILABLE'), warnings}; }))};
  }
  private async employeeWarnings(tx: Prisma.TransactionClient, objectId: string, employeeId: string, date: string, startsAt: Date, endsAt: Date): Promise<string[]> {
    const warnings: string[] = [];
    if (!await this.employeeScoped(tx, objectId, employeeId, date)) warnings.push('OUT_OF_SCOPE');
    const windows = await tx.employeeAvailabilityWindow.findMany({where: {employeeId, availabilityStatus: 'unavailable', startDate: {lt: endsAt}, OR: [{endDate: null}, {endDate: {gte: startsAt}}]}});
    if (windows.length) warnings.push('UNAVAILABLE');
    const substitution = await tx.employeeSubstitution.findFirst({where: {employeeId, OR: [{objectId}, {objectId: null}], status: {in: ['planned', 'active']}, startDate: {lt: endsAt}, AND: [{OR: [{endDate: null}, {endDate: {gte: startsAt}}]}]}});
    if (substitution) warnings.push('SUBSTITUTED');
    return warnings;
  }
  async preview(user: SchedulingUser, objectId: string, input: PreviewDto) {
    await this.access(this.prisma, user, objectId); boundedDates(input.from, input.to);
    const all = (await this.prisma.objectStaffPosition.findMany({where: {objectId}, include: positionInclude})).map(x => this.view(x));
    if (input.positionIds?.some(id => !all.some(x => x.id === id))) throw new BadRequestException('Неизвестная позиция объекта');
    const positions = input.positionIds ? all.filter(x => input.positionIds!.includes(x.id)) : all;
    if (input.draft) {
      await this.validateReferences(this.prisma, user, objectId, input.draft, undefined, false);
      positions.push({id: 'draft', objectId, clientKey: input.draft.clientKey, version: 0, revisions: [{...input.draft, id: 'draft', version: 0, headcount: input.draft.headcount ?? null, requiredPerShift: input.draft.requiredPerShift ?? 1, archived: false, createdByUserId: user.id, createdAt: new Date().toISOString()}]});
    }
    const result = calendarPreview(positions, input.from, input.to);
    // One bounded query for all employees and availability, rather than one query per shift.
    const ids = [...new Set(result.shifts.map(s => s.employeeId))];
    const employees = await this.prisma.employee.findMany({where: {id: {in: ids}}, include: {availabilityWindows: {where: {availabilityStatus: 'unavailable', startDate: {lt: dayEnd(input.to)}, OR: [{endDate: null}, {endDate: {gte: dayStart(input.from)}}]}}, objectAssignments: {where: {objectId, isActive: true}}, substitutionsAsReplacement: {where: {objectId, status: {in: ['planned', 'active']}}}, substitutionsAsPrimary: {where: {OR: [{objectId}, {objectId: null}], status: {in: ['planned', 'active']}}}}});
    const map = new Map(employees.map(e => [e.id, e]));
    for (const shift of result.shifts) {
      const employee = map.get(shift.employeeId); const start = new Date(shift.startsAt); const end = new Date(shift.endsAt);
      const overlap = (a: Date, b: Date | null) => a < end && (!b || b >= start);
      const scoped = employee?.objectAssignments.some(a => (!a.startDate || a.startDate <= dayStart(shift.operationDate)) && (!a.endDate || a.endDate >= dayStart(shift.operationDate))) || employee?.substitutionsAsReplacement.some(s => overlap(s.startDate, s.endDate));
      for (const code of [!scoped || !employee || employee.deletedAt || employee.employmentStatus !== 'active' ? 'OUT_OF_SCOPE' : null, employee?.availabilityWindows.some(w => overlap(w.startDate, w.endDate)) ? 'UNAVAILABLE' : null, employee?.substitutionsAsPrimary.some(s => overlap(s.startDate, s.endDate)) ? 'SUBSTITUTED' : null]) if (code && !result.warnings.some(w => w.code === code && w.employeeId === shift.employeeId && w.date === shift.operationDate)) result.warnings.push({code, message: {OUT_OF_SCOPE: 'Сотрудник недоступен в составе объекта', UNAVAILABLE: 'Сотрудник недоступен в это время', SUBSTITUTED: 'Для сотрудника действует подмена'}[code]!, employeeId: shift.employeeId, date: shift.operationDate, positionId: shift.positionId});
    }
    return result;
  }
  async previewBeforeCreate(user: SchedulingUser, input: PreviewDto) {
    if (!user.isActive || !canCreateObject(roles(user))) throw new ForbiddenException('Предпросмотр создания доступен создателям объектов');
    if (!input.draft || input.positionIds?.length) throw new BadRequestException('Для предпросмотра создания требуется один draft');
    validatePlan(input.draft); boundedDates(input.from, input.to);
    const ids = [...new Set(input.draft.groups.flatMap(g => g.assignments.map(a => a.employeeId)))];
    if (ids.length && !user.permissionCodes?.includes('employees.view')) throw new ForbiddenException('Нет права просмотра реестра сотрудников');
    const employees = await this.prisma.employee.findMany({where: {id: {in: ids}, deletedAt: null, employmentStatus: 'active'}, select: {id: true, availabilityWindows: {where: {availabilityStatus: 'unavailable'}}}});
    if (employees.length !== ids.length) throw new BadRequestException('Выберите существующих активных сотрудников');
    for (const group of input.draft.groups) for (const range of group.timeRanges) if (range.contourId && !/^draft:[a-zA-Z0-9_-]{1,80}$/.test(range.contourId)) throw new BadRequestException('До создания используйте только draft:<code> контуры');
    const result = calendarPreview([{id: 'draft', objectId: '', clientKey: input.draft.clientKey, version: 0, revisions: [{...input.draft, id: 'draft', version: 0, headcount: input.draft.headcount ?? null, requiredPerShift: input.draft.requiredPerShift ?? 1, archived: false, createdByUserId: user.id, createdAt: new Date().toISOString()}]}], input.from, input.to);
    const employeeMap = new Map(employees.map(e => [e.id, e]));
    for (const shift of result.shifts) if (employeeMap.get(shift.employeeId)?.availabilityWindows.some(w => w.startDate < new Date(shift.endsAt) && (!w.endDate || w.endDate >= new Date(shift.startsAt)))) result.warnings.push({code: 'UNAVAILABLE', message: 'Сотрудник недоступен в это время', employeeId: shift.employeeId, date: shift.operationDate, positionId: 'draft'});
    return result;
  }
  private async writableDay(tx: Prisma.TransactionClient, objectId: string, date: string) {
    dateOnly(date);
    if (date > todayMoscow()) conflict('FUTURE_ATTENDANCE', 'Будущий выход подтвердить нельзя');
    const [year, month] = date.split('-').map(Number);
    const container = await tx.timesheetMonth.findUnique({where: {objectId_year_month: {objectId, year, month}}});
    if (container) {
      await tx.$queryRaw`SELECT "id" FROM "timesheet_months" WHERE "id" = ${container.id} FOR UPDATE`;
      const locked = await tx.timesheetMonth.findUniqueOrThrow({where: {id: container.id}});
      if (locked.status !== 'open') conflict('MONTH_CLOSED', 'Месяц табеля закрыт');
    }
  }
  private attendanceView(item: ObjectShiftAttendance, positionId: string) {
    return {...item, positionId, operationDate: item.operationDate.toISOString().slice(0, 10)};
  }
  async attendance(user: SchedulingUser, objectId: string, input: DateRangeDto) {
    await this.access(this.prisma, user, objectId); boundedDates(input.from, input.to);
    const items = await this.prisma.objectShiftAttendance.findMany({where: {objectId, operationDate: {gte: dateOnly(input.from), lte: dateOnly(input.to)}}, include: {revision: {select: {positionId: true}}}, orderBy: [{operationDate: 'asc'}, {createdAt: 'asc'}]});
    return {attendance: items.map(({revision, ...item}) => this.attendanceView(item, revision.positionId))};
  }
  async confirm(user: SchedulingUser, objectId: string, input: ConfirmShiftDto) {
    return this.prisma.$transaction(async tx => {
      const object = await this.lock(tx, user, objectId); await this.writableDay(tx, objectId, input.operationDate);
      const existingRequest = await tx.objectShiftAttendance.findUnique({where: {objectId_requestKey: {objectId, requestKey: input.requestKey}}, include: {revision: {select: {positionId: true}}}});
      if (existingRequest) {
        if (existingRequest.revisionId !== input.revisionId || existingRequest.revision.positionId !== input.positionId || existingRequest.groupKey !== input.groupKey || existingRequest.timeRangeKey !== input.timeRangeKey || existingRequest.employeeId !== input.employeeId || existingRequest.operationDate.toISOString().slice(0,10) !== input.operationDate) conflict('REQUEST_KEY_REUSED', 'Ключ запроса уже использован для другой смены');
        return this.attendanceView(existingRequest, input.positionId);
      }
      const requestAudit = await tx.objectAuditLog.findFirst({where: {objectId, actionCode: 'scheduling_shift_confirmed', payload: {path: ['data', 'requestKey'], equals: input.requestKey}}});
      if (requestAudit) {
        const auditData = (requestAudit.payload as unknown as {data: {attendanceId: string; event: ConfirmShiftDto}}).data;
        const {requestKey: ignored, ...event} = input; void ignored;
        const {requestKey: original, ...savedEvent} = auditData.event; void original;
        if (!isDeepStrictEqual(event, savedEvent)) conflict('REQUEST_KEY_REUSED', 'Ключ запроса уже использован для другой смены');
        const replay = await tx.objectShiftAttendance.findUniqueOrThrow({where: {id: auditData.attendanceId}});
        return this.attendanceView(replay, input.positionId);
      }
      const saved = await tx.objectShiftAttendance.findFirst({where: {objectId, revisionId: input.revisionId, groupKey: input.groupKey, timeRangeKey: input.timeRangeKey, employeeId: input.employeeId, operationDate: dateOnly(input.operationDate)}, include: {revision: {select: {positionId: true}}}});
      if (saved && saved.revision.positionId !== input.positionId) conflict('SHIFT_NOT_EXPECTED', 'Версия графика не относится к указанной позиции');
      if (saved?.status === 'confirmed') {
        await this.audit(tx, user, objectId, 'scheduling_shift_confirmed', {attendanceId: saved.id, requestKey: input.requestKey, event: input, replay: true});
        return this.attendanceView(saved, input.positionId);
      }
      const position = this.view(await this.position(tx, objectId, input.positionId));
      const sourcePosition = saved ? {...position, revisions: position.revisions.filter(r => r.id === saved.revisionId)} : position;
      const shift = calendarPreview([sourcePosition], input.operationDate, input.operationDate).shifts.find(s => s.revisionId === input.revisionId && s.groupKey === input.groupKey && s.timeRangeKey === input.timeRangeKey && s.employeeId === input.employeeId);
      if (!shift) conflict('SHIFT_NOT_EXPECTED', 'Смена не соответствует действующей версии графика');
      const employee = await tx.employee.findFirst({where: {id: input.employeeId, deletedAt: null, employmentStatus: 'active'}});
      if (!employee) throw new BadRequestException('Сотрудник неактивен');
      const warnings = await this.employeeWarnings(tx, objectId, employee.id, input.operationDate, new Date(shift.startsAt), new Date(shift.endsAt));
      if (warnings.length) conflict(warnings[0], 'Сотрудник вне состава объекта, недоступен или подменён');
      const legacy = await tx.objectAttendanceFact.findFirst({where: {objectId, employeeId: employee.id, operationDate: legacyFactRange(input.operationDate)}});
      if (legacy && legacy.source !== 'shifts') conflict('LEGACY_ATTENDANCE_CONFLICT', 'За эту дату уже есть дневной факт. Сначала снимите его через прежний attendance API');
      const peers = await tx.objectShiftAttendance.findMany({where: {objectId, employeeId: employee.id, operationDate: dateOnly(input.operationDate), status: 'confirmed'}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
      const sameContour = peers.find(p => p.contourId === shift.contourId);
      if (saved && peers.some(peer => peer.contourId === saved.contourId && (peer.dailyRateSnapshot !== saved.dailyRateSnapshot || !isDeepStrictEqual(peer.ratePolicySnapshot, saved.ratePolicySnapshot)))) {
        conflict('CONTOUR_SNAPSHOT_CONFLICT', 'Сохранённые условия отменённого выхода отличаются от уже подтверждённых условий этого контура за дату. Повторное подтверждение не может изменить сохранённую оплату');
      }
      const assignment = await tx.objectEmployeeAssignment.findUnique({where: {objectId_employeeId: {objectId, employeeId: employee.id}}});
      const substitution = await tx.employeeSubstitution.findFirst({where: {objectId, substituteEmployeeId: employee.id, status: {in: ['planned', 'active']}, startDate: {lte: dayStart(input.operationDate)}, OR: [{endDate: null}, {endDate: {gte: dayStart(input.operationDate)}}]}});
      const season = object.planningSettings?.automaticSeasons && object.planningSettings.summerStartsOn && object.planningSettings.winterStartsOn ? annualSeason(object.planningSettings.summerStartsOn, object.planningSettings.winterStartsOn, dayStart(input.operationDate)) : object.seasonMode;
      const profile = object.planningSettings?.automaticSeasons ? seasonalCompensation(object, season) : object;
      let policy = parseRatePolicySnapshot(sameContour?.ratePolicySnapshot) ?? parseRatePolicySnapshot(saved?.ratePolicySnapshot) ?? parseRatePolicySnapshot(substitution?.ratePolicySnapshot) ?? (assignment?.ratePolicyUpdatedAt ? normalizeRatePolicy(assignment, profile.dailyRate) : buildObjectDefaultRatePolicy({paymentType: profile.paymentType as 'monthly' | 'daily', monthlySalary: profile.monthlySalary, dailyRate: profile.dailyRate, scheduleCode: profile.paymentScheduleCode, scheduleWeekdays: profile.paymentScheduleWeekdays, scheduleCycleStartDate: profile.paymentScheduleCycleStartDate}));
      let amount = sameContour?.dailyRateSnapshot ?? saved?.dailyRateSnapshot ?? policy.baseAmount;
      if (!sameContour && !saved) {
        if (shift.contourId) {
          if (!['daily_rate', 'per_attendance', 'agreed_substitution_rate'].includes(policy.ratePolicyType)) conflict('INCOMPATIBLE_PAY_MODES', 'Отдельные дневные контуры несовместимы с месячным или специальным режимом сотрудника');
          const contour = await tx.objectPayContour.findFirst({where: {id: shift.contourId, objectId, isActive: true}});
          if (!contour) conflict('CONTOUR_INACTIVE', 'Контур оплаты неактивен');
          if (input.operationDate < contour.effectiveFrom.toISOString().slice(0,10)) conflict('HISTORICAL_RATE_UNAVAILABLE', 'Для даты выхода нет сохранённой исторической ставки контура');
          amount = (season === 'summer' ? contour.summerDailyRate : season === 'winter' ? contour.winterDailyRate : null) ?? contour.dailyRate;
          policy = normalizeRatePolicy({ratePolicyType: 'per_attendance', ratePolicyBaseAmount: amount}, amount);
        } else {
          const changed = assignment?.ratePolicyUpdatedAt ?? object.updatedAt;
          if (input.operationDate < new Date(changed.getTime() + 10800000).toISOString().slice(0,10)) conflict('HISTORICAL_RATE_UNAVAILABLE', 'Для даты выхода нет исторического снимка действующей ставки');
          if (policy.ratePolicyType === 'partial_shift') conflict('INCOMPATIBLE_PAY_MODES', 'Частичная смена требует прежнего attendance API с явным количеством часов');
          if (policy.ratePolicyType === 'monthly_fixed') { const [year, month] = input.operationDate.split('-').map(Number); amount = calculateMonthlySalaryDailyRate({monthlySalary: policy.baseAmount, year, month, scheduleCode: policy.scheduleCode, scheduleWeekdays: policy.scheduleWeekdays, scheduleCycleStartDate: policy.scheduleCycleStartDate}).dailyRate; }
        }
        policy = pinRatePolicyProductionCalendar(policy, Number(input.operationDate.slice(0,4)));
      }
      if (peers.length && peers.some(p => p.contourId !== shift.contourId) && (!shift.contourId || peers.some(p => !p.contourId))) conflict('INCOMPATIBLE_PAY_MODES', 'Нельзя смешивать неявную базовую оплату и явно выделенные контуры в одной дате');
      if (saved && input.operationDate < todayMoscow() && !canManuallyCorrectTimesheet(roles(user)) && !user.permissionCodes?.includes('timesheet.manual_correction')) throw new ForbiddenException('Повторное подтверждение исторического выхода требует права корректировки табеля');
      const item = saved
        ? await tx.objectShiftAttendance.update({where: {id: saved.id}, data: {status: 'confirmed', version: {increment: 1}}})
        : await tx.objectShiftAttendance.create({data: {objectId, employeeId: employee.id, operationDate: dateOnly(input.operationDate), revisionId: input.revisionId, groupKey: input.groupKey, timeRangeKey: input.timeRangeKey, requestKey: input.requestKey, contourId: shift.contourId, startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt), dailyRateSnapshot: amount, ratePolicySnapshot: json(policy), createdByUserId: user.id}});
      await this.aggregate(tx, user, objectId, employee.id, input.operationDate);
      await this.audit(tx, user, objectId, 'scheduling_shift_confirmed', {attendanceId: item.id, requestKey: input.requestKey, event: input, previousStatus: saved?.status, previousVersion: saved?.version, version: item.version});
      return this.attendanceView(item, input.positionId);
    });
  }
  async cancel(user: SchedulingUser, objectId: string, id: string, input: CancelShiftDto) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, user, objectId);
      const item = await tx.objectShiftAttendance.findFirst({where: {id, objectId}, include: {revision: {select: {positionId: true}}}});
      if (!item) throw new NotFoundException('Выход не найден');
      const date = item.operationDate.toISOString().slice(0,10); await this.writableDay(tx, objectId, date);
      if (date < todayMoscow() && !canManuallyCorrectTimesheet(roles(user)) && !user.permissionCodes?.includes('timesheet.manual_correction')) throw new ForbiddenException('Отмена исторического выхода требует права корректировки табеля');
      if (item.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Факт выхода уже изменён');
      if (item.status === 'cancelled') return this.attendanceView(item, item.revision.positionId);
      if (!input.reason.trim()) throw new BadRequestException('Укажите причину отмены');
      const updated = await tx.objectShiftAttendance.update({where: {id}, data: {status: 'cancelled', version: {increment: 1}, cancelledByUserId: user.id, cancelledAt: new Date(), cancelReason: input.reason.trim()}});
      await this.aggregate(tx, user, objectId, item.employeeId, date);
      await this.audit(tx, user, objectId, 'scheduling_shift_cancelled', {attendanceId: id, reason: input.reason.trim()});
      return this.attendanceView(updated, item.revision.positionId);
    });
  }
  private async aggregate(tx: Prisma.TransactionClient, user: SchedulingUser, objectId: string, employeeId: string, date: string) {
    const shifts = await tx.objectShiftAttendance.findMany({where: {objectId, employeeId, operationDate: dateOnly(date), status: 'confirmed'}, orderBy: [{createdAt: 'asc'}, {id: 'asc'}]});
    const paid = new Map<string, ObjectShiftAttendance>();
    for (const shift of shifts) if (!paid.has(shift.contourId ?? 'default')) paid.set(shift.contourId ?? 'default', shift);
    const exits = [...paid.values()]; const amount = exits.reduce((sum, s) => sum + s.dailyRateSnapshot, 0);
    if (amount > 2147483647) throw new BadRequestException('Сумма дневных начислений превышает допустимый предел');
    const policy = exits.length === 1 ? exits[0].ratePolicySnapshot : json(normalizeRatePolicy({ratePolicyType: 'per_attendance', ratePolicyBaseAmount: amount}, amount));
    const key = {objectId, employeeId, operationDate: legacyFactDay(date)};
    if (exits.length) await tx.objectAttendanceFact.upsert({where: {objectId_employeeId_operationDate: key}, create: {...key, source: 'shifts', dailyRateSnapshot: amount, ratePolicySnapshot: json(policy), createdByUserId: user.id, calculationExplanation: `Подтверждено контуров оплаты: ${exits.length}`}, update: {source: 'shifts', dailyRateSnapshot: amount, ratePolicySnapshot: json(policy), calculationExplanation: `Подтверждено контуров оплаты: ${exits.length}`}});
    else await tx.objectAttendanceFact.deleteMany({where: {objectId, employeeId, source: 'shifts', operationDate: legacyFactRange(date)}});
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    const container = await tx.timesheetMonth.upsert({where: {objectId_year_month: {objectId, year, month}}, create: {objectId, year, month, createdByUserId: user.id}, update: {}});
    const employee = await tx.employee.findUniqueOrThrow({where: {id: employeeId}});
    await tx.timesheetEmployeeRow.upsert({where: {timesheetMonthId_employeeId: {timesheetMonthId: container.id, employeeId}}, create: {timesheetMonthId: container.id, employeeId, employeeNameSnapshot: employee.fullName}, update: {}});
    await this.timesheets.syncAttendanceDay(tx, {objectId, timesheetMonthId: container.id, year, month, dayOfMonth, actorUserId: user.id, previousFactEmployeeIds: [], employeeIds: [employeeId], reconcileMonthly: true});
  }
}
