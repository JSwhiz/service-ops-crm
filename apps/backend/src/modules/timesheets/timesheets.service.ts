import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';
import {
  MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
  TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
} from '../approvals/constants/approval.constants';
import { PrismaService } from '../prisma/prisma.service';

import { CreateTimesheetManualExceptionDto } from './dto/create-timesheet-manual-exception.dto';
import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import {
  GetTimesheetOverviewQueryDto,
  ListTimesheetOverviewEmployeesQueryDto,
  ListTimesheetOverviewObjectsQueryDto,
} from './dto/get-timesheet-overview-query.dto';
import { ListTimesheetCorrectionsQueryDto } from './dto/list-timesheet-corrections-query.dto';
import { TimesheetCorrectionItemDto } from './dto/timesheet-correction-item.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import {
  TimesheetOverviewReferenceDto,
  TimesheetOverviewResponseDto,
} from './dto/timesheet-overview-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import type { TimesheetRatePolicySnapshot } from './types/timesheet-rate-policy.type';
import {
  canManuallyCorrectTimesheet,
  hasWideTimesheetAccess,
} from './utils/timesheet-access.util';
import {
  calculateTimesheetAutoValues,
  getRatePolicyLabel,
  normalizeRatePolicy,
  parseRatePolicySnapshot,
} from './utils/timesheet-rate-policy.util';
import type {
  CalculatedTimesheetDay,
  RatePolicyRecord,
} from './utils/timesheet-rate-policy.util';
import { createSimpleXlsxWorkbook } from './utils/simple-xlsx.util';
import type { XlsxCell } from './utils/simple-xlsx.util';
import { calculateTimesheetPeriodTotals } from './utils/timesheet-totals.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class TimesheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimesheet(
    currentUser: CurrentAuthUser,
    query: GetTimesheetQueryDto,
  ): Promise<TimesheetResponseDto> {
    await this.assertAccess(currentUser, query.objectId);

    const object = await this.prisma.object.findFirst({
      where: {
        id: query.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        dailyRate: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const monthContainer = await this.ensureMonthContainer(
      query.objectId,
      query.year,
      query.month,
      currentUser.id,
    );

    await this.syncAutomaticEntries({
      objectId: query.objectId,
      timesheetMonthId: monthContainer.id,
      year: query.year,
      month: query.month,
    });

    const rows = await this.prisma.timesheetEmployeeRow.findMany({
      where: {
        timesheetMonthId: monthContainer.id,
      },
      include: {
        entries: {
          include: {
            updatedBy: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: {
            dayOfMonth: 'asc',
          },
        },
      },
      orderBy: {
        employeeNameSnapshot: 'asc',
      },
    });

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: query.objectId,
        operationDate: this.getMonthRange(query.year, query.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
        dailyRateSnapshot: true,
        workedHours: true,
        ratePolicySnapshot: true,
      },
    });

    const factSet = new Set(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return `${fact.employeeId}:${day}`;
      }),
    );
    const factsByEmployeeId = this.groupAttendanceFactsByEmployee(monthFacts);
    const policyByEmployeeId = await this.loadRatePoliciesByEmployeeId({
      objectId: query.objectId,
      employeeIds: rows.map((row) => row.employeeId),
      objectDailyRate: object.dailyRate,
    });

    const daysInSelectedMonth = this.getDaysInMonth(query.year, query.month);

    const mappedRows = rows.map((row) => {
      const entriesByDay = new Map(
        row.entries.map((entry) => [entry.dayOfMonth, entry]),
      );
      const ratePolicy =
        policyByEmployeeId.get(row.employeeId) ??
        normalizeRatePolicy(null, object.dailyRate);
      const autoValues = calculateTimesheetAutoValues({
        year: query.year,
        month: query.month,
        daysInMonth: daysInSelectedMonth,
        policy: ratePolicy,
        facts: factsByEmployeeId.get(row.employeeId) ?? [],
      });

      const fullEntries = Array.from(
        { length: daysInSelectedMonth },
        (_, index) => {
          const dayOfMonth = index + 1;
          const existing = entriesByDay.get(dayOfMonth);
          const calculated = autoValues.get(dayOfMonth);
          const autoValue =
            existing?.autoValue ??
            calculated?.autoValue ??
            (existing?.isChangedManually ? 0 : existing?.dayValue ?? 0);
          const finalValue = existing?.dayValue ?? calculated?.autoValue ?? 0;
          const manualValue = existing?.isChangedManually
            ? existing.dayValue
            : null;
          const ratePolicySnapshot =
            this.normalizeStoredPolicySnapshot(
              existing?.ratePolicySnapshot ?? null,
            ) ?? calculated?.ratePolicySnapshot ?? ratePolicy;

          return {
            dayOfMonth,
            dayValue: finalValue,
            autoValue,
            finalValue,
            manualValue,
            difference: finalValue - autoValue,
            comment: existing?.comment ?? null,
            isChangedManually: existing?.isChangedManually ?? false,
            hasFact: factSet.has(`${row.employeeId}:${dayOfMonth}`),
            workedHours: existing?.workedHours ?? calculated?.workedHours ?? null,
            ratePolicySnapshot,
            calculationExplanation:
              existing?.calculationExplanation ??
              calculated?.calculationExplanation ??
              null,
            updatedAt: existing?.updatedAt.toISOString() ?? null,
            updatedByUserId: existing?.updatedBy?.id ?? null,
            updatedByUserName: existing?.updatedBy?.fullName ?? null,
          };
        },
      );

      const totals = calculateTimesheetPeriodTotals(fullEntries);

      return {
        employeeId: row.employeeId,
        employeeName: row.employeeNameSnapshot,
        advanceTotal: totals.advanceTotal,
        salaryTotal: totals.salaryTotal,
        rowTotal: totals.monthTotal,
        ratePolicy: {
          ...ratePolicy,
          label: getRatePolicyLabel(ratePolicy),
        },
        entries: fullEntries,
      };
    });

    const totals = calculateTimesheetPeriodTotals(
      mappedRows.flatMap((row) => row.entries),
    );

    return {
      objectId: object.id,
      objectName: object.name,
      objectDailyRate: object.dailyRate,
      year: query.year,
      month: query.month,
      status: monthContainer.status,
      daysInMonth: daysInSelectedMonth,
      advanceTotal: totals.advanceTotal,
      salaryTotal: totals.salaryTotal,
      monthTotal: totals.monthTotal,
      capabilities: {
        canManualCorrection: canManuallyCorrectTimesheet(
          this.getRoleCodes(currentUser),
        ),
      },
      rows: mappedRows,
    };
  }

  async exportTimesheet(
    currentUser: CurrentAuthUser,
    query: GetTimesheetQueryDto,
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const timesheet = await this.getTimesheet(currentUser, query);
    const dayHeaders = Array.from(
      { length: timesheet.daysInMonth },
      (_unused, index) => index + 1,
    );
    const lastDayColumnIndex = dayHeaders.length + 1;
    const advanceColumnIndex = lastDayColumnIndex + 1;
    const salaryColumnIndex = lastDayColumnIndex + 2;
    const totalColumnIndex = lastDayColumnIndex + 3;
    const advanceColumnName = this.toExcelColumnName(advanceColumnIndex);
    const salaryColumnName = this.toExcelColumnName(salaryColumnIndex);
    const totalColumnName = this.toExcelColumnName(totalColumnIndex);
    const day15ColumnName = this.toExcelColumnName(Math.min(15, dayHeaders.length) + 1);
    const day16ColumnName = this.toExcelColumnName(Math.min(16, dayHeaders.length) + 1);

    const mainRows: XlsxCell[][] = [
      [`Объект: ${timesheet.objectName}`],
      [`Период: ${timesheet.month}.${timesheet.year}`],
      [],
      [
        { value: 'Сотрудник', styleId: 1 },
        ...dayHeaders.map((day) => ({ value: day, styleId: 1 })),
        { value: 'Аванс', styleId: 1 },
        { value: 'ЗП', styleId: 1 },
        { value: 'Итого', styleId: 1 },
      ],
      ...timesheet.rows.map((row, rowIndex) => {
        const excelRowNumber = rowIndex + 5;
        return [
          row.employeeName,
          ...row.entries.map((entry) => ({
            value: entry.finalValue,
            styleId: entry.isChangedManually ? 2 : undefined,
          })),
          {
            formula: `SUM(B${excelRowNumber}:${day15ColumnName}${excelRowNumber})`,
            value: row.advanceTotal,
          },
          {
            formula: `SUM(${day16ColumnName}${excelRowNumber}:${this.toExcelColumnName(lastDayColumnIndex)}${excelRowNumber})`,
            value: row.salaryTotal,
          },
          {
            formula: `${advanceColumnName}${excelRowNumber}+${salaryColumnName}${excelRowNumber}`,
            value: row.rowTotal,
          },
        ];
      }),
      [
        { value: 'Итого', styleId: 1 },
        ...dayHeaders.map((day, index) => ({
          formula: `SUM(${this.toExcelColumnName(index + 2)}5:${this.toExcelColumnName(index + 2)}${timesheet.rows.length + 4})`,
          value: timesheet.rows.reduce(
            (sum, row) => sum + (row.entries[index]?.finalValue ?? 0),
            0,
          ),
        })),
        {
          formula: `SUM(${advanceColumnName}5:${advanceColumnName}${timesheet.rows.length + 4})`,
          value: timesheet.advanceTotal,
        },
        {
          formula: `SUM(${salaryColumnName}5:${salaryColumnName}${timesheet.rows.length + 4})`,
          value: timesheet.salaryTotal,
        },
        {
          formula: `SUM(${totalColumnName}5:${totalColumnName}${timesheet.rows.length + 4})`,
          value: timesheet.monthTotal,
        },
      ],
    ];

    const autoRows: XlsxCell[][] = [
      [`Объект: ${timesheet.objectName}`],
      [`Период: ${timesheet.month}.${timesheet.year}`],
      [],
      [
        { value: 'Сотрудник', styleId: 1 },
        { value: 'Политика', styleId: 1 },
        ...dayHeaders.map((day) => ({ value: day, styleId: 1 })),
      ],
      ...timesheet.rows.map((row) => [
        row.employeeName,
        row.ratePolicy.label,
        ...row.entries.map((entry) =>
          entry.calculationExplanation
            ? `${entry.autoValue} · ${entry.calculationExplanation}`
            : entry.autoValue,
        ),
      ]),
    ];

    const deviationRows: XlsxCell[][] = [
      [
        { value: 'Сотрудник', styleId: 1 },
        { value: 'День', styleId: 1 },
        { value: 'Политика', styleId: 1 },
        { value: 'Auto', styleId: 1 },
        { value: 'Final', styleId: 1 },
        { value: 'Отклонение', styleId: 1 },
        { value: 'Комментарий', styleId: 1 },
        { value: 'Кто изменил', styleId: 1 },
        { value: 'Когда', styleId: 1 },
        { value: 'Fact', styleId: 1 },
      ],
      ...timesheet.rows.flatMap((row) =>
        row.entries
          .filter((entry) => entry.isChangedManually || entry.difference !== 0)
          .map((entry) => [
            row.employeeName,
            entry.dayOfMonth,
            row.ratePolicy.label,
            entry.autoValue,
            entry.finalValue,
            { value: entry.difference, styleId: 2 },
            entry.comment ?? '',
            entry.updatedByUserName ?? '',
            entry.updatedAt ?? '',
            entry.hasFact ? 'да' : 'нет',
          ]),
      ),
    ];

    const summaryRows: XlsxCell[][] = [
      [{ value: 'Показатель', styleId: 1 }, { value: 'Значение', styleId: 1 }],
      ['Объект', timesheet.objectName],
      ['Период', `${timesheet.month}.${timesheet.year}`],
      [
        'Всего авто',
        timesheet.rows.reduce(
          (sum, row) =>
            sum + row.entries.reduce((rowSum, entry) => rowSum + entry.autoValue, 0),
          0,
        ),
      ],
      ['Всего итог', timesheet.monthTotal],
      ['Аванс', timesheet.advanceTotal],
      ['ЗП', timesheet.salaryTotal],
      [
        'Сумма отклонений',
        timesheet.rows.reduce(
          (sum, row) =>
            sum + row.entries.reduce((rowSum, entry) => rowSum + entry.difference, 0),
          0,
        ),
      ],
      ['Сотрудников', timesheet.rows.length],
      [
        'Ручных изменений',
        timesheet.rows.reduce(
          (sum, row) =>
            sum + row.entries.filter((entry) => entry.isChangedManually).length,
          0,
        ),
      ],
      [],
      [{ value: 'Итоги по типам расчета', styleId: 1 }],
      ...this.buildPolicySummaryRows(timesheet),
    ];

    return {
      fileName: `timesheet-${timesheet.objectId}-${timesheet.year}-${String(timesheet.month).padStart(2, '0')}.xlsx`,
      buffer: createSimpleXlsxWorkbook([
        { name: 'Табель', rows: mainRows },
        { name: 'Авторасчет', rows: autoRows },
        { name: 'Отклонения', rows: deviationRows },
        { name: 'Сводка', rows: summaryRows },
      ]),
    };
  }

  async getOverview(
    currentUser: CurrentAuthUser,
    query: GetTimesheetOverviewQueryDto,
  ): Promise<TimesheetOverviewResponseDto> {
    if (query.objectId) {
      await this.assertAccess(currentUser, query.objectId);
    }

    const objectWhere = this.buildTimesheetObjectWhere(currentUser, query.objectId);
    const objects = await this.prisma.object.findMany({
      where: objectWhere,
      select: { id: true, name: true, dailyRate: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const objectIds = objects.map((object) => object.id);
    const daysInMonth = this.getDaysInMonth(query.year, query.month);

    if (objectIds.length === 0) {
      return this.emptyOverview(currentUser, query, daysInMonth);
    }

    const employeeFilter = query.employeeId
      ? { employeeId: query.employeeId }
      : {};
    const [months, assignments, facts] = await Promise.all([
      this.prisma.timesheetMonth.findMany({
        where: {
          objectId: { in: objectIds },
          year: query.year,
          month: query.month,
        },
        select: {
          objectId: true,
          rows: {
            where: employeeFilter,
            select: {
              employeeId: true,
              employeeNameSnapshot: true,
              entries: { orderBy: { dayOfMonth: 'asc' } },
            },
          },
        },
      }),
      this.prisma.objectEmployeeAssignment.findMany({
        where: {
          objectId: { in: objectIds },
          isActive: true,
          ...employeeFilter,
        },
        include: {
          employee: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.objectAttendanceFact.findMany({
        where: {
          objectId: { in: objectIds },
          operationDate: this.getMonthRange(query.year, query.month),
          ...employeeFilter,
        },
        include: {
          employee: { select: { id: true, fullName: true } },
        },
        orderBy: { operationDate: 'asc' },
      }),
    ]);

    const objectById = new Map(objects.map((object) => [object.id, object]));
    const assignmentByPair = new Map(
      assignments.map((assignment) => [
        this.buildOverviewPairKey(assignment.objectId, assignment.employeeId),
        assignment,
      ]),
    );
    const rowByPair = new Map<string, (typeof months)[number]['rows'][number]>();
    const factsByPair = new Map<string, typeof facts>();
    const employeeNameByPair = new Map<string, string>();
    const pairKeys = new Set<string>();

    for (const month of months) {
      for (const row of month.rows) {
        const key = this.buildOverviewPairKey(month.objectId, row.employeeId);
        pairKeys.add(key);
        rowByPair.set(key, row);
        employeeNameByPair.set(key, row.employeeNameSnapshot);
      }
    }

    for (const assignment of assignments) {
      const key = this.buildOverviewPairKey(
        assignment.objectId,
        assignment.employeeId,
      );
      pairKeys.add(key);
      employeeNameByPair.set(key, assignment.employee.fullName);
    }

    for (const fact of facts) {
      const key = this.buildOverviewPairKey(fact.objectId, fact.employeeId);
      pairKeys.add(key);
      employeeNameByPair.set(key, fact.employee.fullName);
      const current = factsByPair.get(key) ?? [];
      current.push(fact);
      factsByPair.set(key, current);
    }

    const mappedRows = [...pairKeys].map((key) => {
      const [objectId, employeeId] = key.split(':');
      if (!objectId || !employeeId) {
        throw new NotFoundException('Timesheet row is invalid');
      }
      const object = objectById.get(objectId);
      if (!object) {
        throw new NotFoundException('Object not found');
      }
      const storedRow = rowByPair.get(key);
      const assignment = assignmentByPair.get(key);
      const pairFacts = factsByPair.get(key) ?? [];
      const entriesByDay = new Map(
        (storedRow?.entries ?? []).map((entry) => [entry.dayOfMonth, entry]),
      );
      const storedPolicy = (storedRow?.entries ?? [])
        .map((entry) => parseRatePolicySnapshot(entry.ratePolicySnapshot))
        .find((policy) => policy !== null);
      const factPolicy = pairFacts
        .map((fact) => parseRatePolicySnapshot(fact.ratePolicySnapshot))
        .find((policy) => policy !== null);
      const policy = assignment
        ? normalizeRatePolicy(assignment, object.dailyRate)
        : storedPolicy ?? factPolicy ?? normalizeRatePolicy(null, object.dailyRate);
      const calculated = calculateTimesheetAutoValues({
        year: query.year,
        month: query.month,
        daysInMonth,
        policy,
        facts: pairFacts.map((fact) => ({
          dayOfMonth: fact.operationDate.getDate(),
          dailyRateSnapshot: fact.dailyRateSnapshot,
          workedHours: fact.workedHours,
          ratePolicySnapshot: fact.ratePolicySnapshot,
        })),
      });
      const factDays = new Set(pairFacts.map((fact) => fact.operationDate.getDate()));
      const entries = Array.from({ length: daysInMonth }, (_unused, index) => {
        const dayOfMonth = index + 1;
        const stored = entriesByDay.get(dayOfMonth);
        const automatic = calculated.get(dayOfMonth);
        const autoValue =
          automatic?.autoValue ??
          stored?.autoValue ??
          (stored?.isChangedManually ? 0 : stored?.dayValue ?? 0);
        const finalValue = stored?.isChangedManually
          ? stored.dayValue
          : automatic?.autoValue ?? stored?.dayValue ?? 0;

        return {
          dayOfMonth,
          finalValue,
          autoValue,
          manualValue: stored?.isChangedManually ? stored.dayValue : null,
          isChangedManually: stored?.isChangedManually ?? false,
          hasFact: factDays.has(dayOfMonth),
          workedHours: stored?.workedHours ?? automatic?.workedHours ?? null,
          comment: stored?.comment ?? null,
          calculationExplanation:
            stored?.calculationExplanation ??
            automatic?.calculationExplanation ??
            null,
        };
      });
      const totals = calculateTimesheetPeriodTotals(entries);

      return {
        objectId,
        objectName: object.name,
        employeeId,
        employeeName: employeeNameByPair.get(key) ?? 'Сотрудник',
        entries,
        advanceTotal: totals.advanceTotal,
        salaryTotal: totals.salaryTotal,
        monthTotal: totals.monthTotal,
      };
    });

    mappedRows.sort(
      (left, right) =>
        left.objectName.localeCompare(right.objectName, 'ru') ||
        left.employeeName.localeCompare(right.employeeName, 'ru') ||
        left.employeeId.localeCompare(right.employeeId),
    );
    const totals = calculateTimesheetPeriodTotals(
      mappedRows.flatMap((row) => row.entries),
    );

    return {
      year: query.year,
      month: query.month,
      daysInMonth,
      rows: mappedRows,
      totals,
      capabilities: {
        canManualCorrection: canManuallyCorrectTimesheet(
          this.getRoleCodes(currentUser),
        ),
        canExport: true,
      },
    };
  }

  async listOverviewObjects(
    currentUser: CurrentAuthUser,
    query: ListTimesheetOverviewObjectsQueryDto,
  ): Promise<TimesheetOverviewReferenceDto[]> {
    const objects = await this.prisma.object.findMany({
      where: {
        ...this.buildTimesheetObjectWhere(currentUser),
        ...(query.selectedId
          ? { id: query.selectedId }
          : query.q
            ? { name: { contains: query.q, mode: 'insensitive' } }
            : {}),
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 30,
    });

    return objects;
  }

  async listOverviewEmployees(
    currentUser: CurrentAuthUser,
    query: ListTimesheetOverviewEmployeesQueryDto,
  ): Promise<TimesheetOverviewReferenceDto[]> {
    if (query.objectId) {
      await this.assertAccess(currentUser, query.objectId);
    }
    const objects = await this.prisma.object.findMany({
      where: this.buildTimesheetObjectWhere(currentUser, query.objectId),
      select: { id: true },
    });
    const objectIds = objects.map((object) => object.id);
    if (objectIds.length === 0) {
      return [];
    }

    const [months, assignments, facts] = await Promise.all([
      this.prisma.timesheetMonth.findMany({
        where: {
          objectId: { in: objectIds },
          year: query.year,
          month: query.month,
        },
        select: { rows: { select: { employeeId: true } } },
      }),
      this.prisma.objectEmployeeAssignment.findMany({
        where: { objectId: { in: objectIds }, isActive: true },
        select: { employeeId: true },
      }),
      this.prisma.objectAttendanceFact.findMany({
        where: {
          objectId: { in: objectIds },
          operationDate: this.getMonthRange(query.year, query.month),
        },
        select: { employeeId: true },
      }),
    ]);
    const employeeIds = [
      ...new Set([
        ...months.flatMap((month) => month.rows.map((row) => row.employeeId)),
        ...assignments.map((assignment) => assignment.employeeId),
        ...facts.map((fact) => fact.employeeId),
      ]),
    ];

    const employees = await this.prisma.employee.findMany({
      where: {
        id: {
          in: query.selectedId
            ? employeeIds.filter((id) => id === query.selectedId)
            : employeeIds,
        },
        ...(!query.selectedId && query.q
          ? {
              OR: [
                { fullName: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: 30,
    });

    return employees.map((employee) => ({
      id: employee.id,
      name: employee.fullName,
    }));
  }

  async exportOverview(
    currentUser: CurrentAuthUser,
    query: GetTimesheetOverviewQueryDto,
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const overview = await this.getOverview(currentUser, query);
    const days = Array.from(
      { length: overview.daysInMonth },
      (_unused, index) => index + 1,
    );
    const firstDataRow = 4;
    const lastDataRow = firstDataRow + overview.rows.length - 1;
    const lastDayColumnIndex = days.length + 2;
    const advanceColumnIndex = lastDayColumnIndex + 1;
    const salaryColumnIndex = lastDayColumnIndex + 2;
    const totalColumnIndex = lastDayColumnIndex + 3;
    const advanceColumnName = this.toExcelColumnName(advanceColumnIndex);
    const salaryColumnName = this.toExcelColumnName(salaryColumnIndex);
    const totalColumnName = this.toExcelColumnName(totalColumnIndex);
    const day15ColumnName = this.toExcelColumnName(17);
    const day16ColumnName = this.toExcelColumnName(18);

    const rows: XlsxCell[][] = [
      [`Период: ${String(overview.month).padStart(2, '0')}.${overview.year}`],
      [],
      [
        { value: 'Объект', styleId: 1 },
        { value: 'Сотрудник', styleId: 1 },
        ...days.map((day) => ({ value: day, styleId: 1 })),
        { value: 'Аванс', styleId: 1 },
        { value: 'ЗП', styleId: 1 },
        { value: 'Итого', styleId: 1 },
      ],
      ...overview.rows.map((row, index) => {
        const excelRow = firstDataRow + index;
        return [
          row.objectName,
          row.employeeName,
          ...row.entries.map((entry) => ({
            value: entry.finalValue,
            styleId: entry.isChangedManually ? 2 : undefined,
          })),
          {
            formula: `SUM(C${excelRow}:${day15ColumnName}${excelRow})`,
            value: row.advanceTotal,
          },
          {
            formula: `SUM(${day16ColumnName}${excelRow}:${this.toExcelColumnName(lastDayColumnIndex)}${excelRow})`,
            value: row.salaryTotal,
          },
          {
            formula: `${advanceColumnName}${excelRow}+${salaryColumnName}${excelRow}`,
            value: row.monthTotal,
          },
        ];
      }),
      [
        { value: 'ИТОГО', styleId: 1 },
        '',
        ...days.map((_day, index) => ({
          formula:
            overview.rows.length > 0
              ? `SUM(${this.toExcelColumnName(index + 3)}${firstDataRow}:${this.toExcelColumnName(index + 3)}${lastDataRow})`
              : undefined,
          value: overview.rows.reduce(
            (sum, row) => sum + (row.entries[index]?.finalValue ?? 0),
            0,
          ),
        })),
        {
          formula:
            overview.rows.length > 0
              ? `SUM(${advanceColumnName}${firstDataRow}:${advanceColumnName}${lastDataRow})`
              : undefined,
          value: overview.totals.advanceTotal,
        },
        {
          formula:
            overview.rows.length > 0
              ? `SUM(${salaryColumnName}${firstDataRow}:${salaryColumnName}${lastDataRow})`
              : undefined,
          value: overview.totals.salaryTotal,
        },
        {
          formula:
            overview.rows.length > 0
              ? `SUM(${totalColumnName}${firstDataRow}:${totalColumnName}${lastDataRow})`
              : undefined,
          value: overview.totals.monthTotal,
        },
      ],
    ];

    return {
      fileName: `timesheet-overview-${overview.year}-${String(overview.month).padStart(2, '0')}.xlsx`,
      buffer: createSimpleXlsxWorkbook([
        {
          name: 'Табель',
          rows,
          columnWidths: [28, 30, ...days.map(() => 10), 16, 16, 18],
          freeze: { rows: 3, columns: 2 },
          pageSetup: {
            orientation: 'landscape',
            fitToWidth: 1,
            fitToHeight: 0,
          },
        },
      ]),
    };
  }

  async listCorrections(
    currentUser: CurrentAuthUser,
    query: ListTimesheetCorrectionsQueryDto,
  ): Promise<TimesheetCorrectionItemDto[]> {
    await this.assertAccess(currentUser, query.objectId);

    const monthContainer = await this.ensureMonthContainer(
      query.objectId,
      query.year,
      query.month,
      currentUser.id,
    );

    const correctionEntries = await this.prisma.timesheetDayEntry.findMany({
      where: {
        row: {
          timesheetMonthId: monthContainer.id,
        },
        isChangedManually: true,
      },
      include: {
        row: {
          select: {
            employeeId: true,
            employeeNameSnapshot: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [
        {
          dayOfMonth: 'asc',
        },
        {
          updatedAt: 'desc',
        },
      ],
    });

    if (correctionEntries.length === 0) {
      return [];
    }

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: query.objectId,
        operationDate: this.getMonthRange(query.year, query.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
      },
    });

    const factSet = new Set(
      monthFacts.map((fact) => {
        const day = new Date(fact.operationDate).getDate();
        return `${fact.employeeId}:${day}`;
      }),
    );

    return correctionEntries.map((entry) => ({
      employeeId: entry.row.employeeId,
      employeeName: entry.row.employeeNameSnapshot,
      dayOfMonth: entry.dayOfMonth,
      dayValue: entry.dayValue,
      comment: entry.comment ?? null,
      hasFact: factSet.has(`${entry.row.employeeId}:${entry.dayOfMonth}`),
      updatedAt: entry.updatedAt.toISOString(),
      updatedByUserId: entry.updatedBy?.id ?? null,
      updatedByUserName: entry.updatedBy?.fullName ?? null,
    }));
  }

  async upsertEntry(
    currentUser: CurrentAuthUser,
    payload: UpsertTimesheetEntryDto,
  ): Promise<TimesheetResponseDto> {
    await this.assertAccess(currentUser, payload.objectId);
    this.assertManualCorrectionAccess(currentUser);

    const daysInMonth = this.getDaysInMonth(payload.year, payload.month);
    if (payload.dayOfMonth > daysInMonth) {
      throw new NotFoundException('Day exceeds month length');
    }

    const object = await this.prisma.object.findFirst({
      where: {
        id: payload.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const monthContainer = await this.ensureMonthContainer(
      payload.objectId,
      payload.year,
      payload.month,
      currentUser.id,
    );

    const mutationContext = await this.prepareEntryMutationContext({
      objectId: payload.objectId,
      employeeId: payload.employeeId,
      year: payload.year,
      month: payload.month,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      comment: payload.comment,
      monthContainerId: monthContainer.id,
    });

    await this.applyEntryMutation(this.prisma, {
      rowId: mutationContext.row.id,
      existingEntryId: mutationContext.existingEntry?.id ?? null,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      expectedAutoValue: mutationContext.expectedAutoValue,
      hasAttendanceFact: mutationContext.hasAttendanceFact,
      calculatedDay: mutationContext.calculatedDay,
      normalizedComment: mutationContext.normalizedComment,
      actorUserId: currentUser.id,
    });

    return this.getTimesheet(currentUser, {
      objectId: payload.objectId,
      year: payload.year,
      month: payload.month,
    });
  }

  async requestManualException(
    currentUser: CurrentAuthUser,
    payload: CreateTimesheetManualExceptionDto,
  ): Promise<ApprovalRequestResponseDto> {
    await this.assertAccess(currentUser, payload.objectId);

    if (canManuallyCorrectTimesheet(this.getRoleCodes(currentUser))) {
      throw new BadRequestException(
        'Direct manual correction is available for current user',
      );
    }

    const daysInMonth = this.getDaysInMonth(payload.year, payload.month);
    if (payload.dayOfMonth > daysInMonth) {
      throw new NotFoundException('Day exceeds month length');
    }

    const monthContainer = await this.ensureMonthContainer(
      payload.objectId,
      payload.year,
      payload.month,
      currentUser.id,
    );

    const mutationContext = await this.prepareEntryMutationContext({
      objectId: payload.objectId,
      employeeId: payload.employeeId,
      year: payload.year,
      month: payload.month,
      dayOfMonth: payload.dayOfMonth,
      dayValue: payload.dayValue,
      comment: payload.comment,
      monthContainerId: monthContainer.id,
    });

    if (payload.dayValue === mutationContext.expectedAutoValue) {
      throw new BadRequestException(
        'Manual exception must differ from current automatic value',
      );
    }

    const existingPendingRequest = await this.prisma.timesheetManualException.findFirst({
      where: {
        objectId: payload.objectId,
        employeeId: payload.employeeId,
        year: payload.year,
        month: payload.month,
        dayOfMonth: payload.dayOfMonth,
        status: 'pending',
      },
      select: {
        id: true,
      },
    });

    if (existingPendingRequest) {
      throw new ConflictException(
        'Timesheet manual exception approval is already pending for this day',
      );
    }

    const createdRequest = await this.prisma.$transaction(async (tx) => {
      const exception = await tx.timesheetManualException.create({
        data: {
          objectId: payload.objectId,
          employeeId: payload.employeeId,
          year: payload.year,
          month: payload.month,
          dayOfMonth: payload.dayOfMonth,
          requestedDayValue: payload.dayValue,
          currentDayValueSnapshot: mutationContext.currentDayValueSnapshot,
          comment: mutationContext.normalizedComment ?? payload.comment.trim(),
          requestedByUserId: currentUser.id,
        },
      });

      return tx.approvalRequest.create({
        data: {
          approvalType: MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: exception.id,
          createdByUserId: currentUser.id,
          payloadSnapshot: {
            summaryTitle: 'Исключение табеля',
            summarySubtitle: `${mutationContext.row.employeeNameSnapshot} · ${payload.year}-${String(payload.month).padStart(2, '0')} · день ${payload.dayOfMonth}`,
            objectId: payload.objectId,
            employeeId: payload.employeeId,
            employeeName: mutationContext.row.employeeNameSnapshot,
            year: payload.year,
            month: payload.month,
            dayOfMonth: payload.dayOfMonth,
            currentDayValue: mutationContext.currentDayValueSnapshot,
            requestedDayValue: payload.dayValue,
            comment: mutationContext.normalizedComment ?? payload.comment.trim(),
          },
        },
        include: {
          createdBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
          cancelledBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
        },
      });
    });

    await this.prisma.auditEvent.create({
      data: {
        entityType: 'approval_request',
        entityId: createdRequest.id,
        actorUserId: currentUser.id,
        action: 'approval.request.created',
        newValues: {
          approvalType: MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: createdRequest.sourceEntityId,
        },
      },
    });

    return this.mapApprovalRequest(createdRequest, currentUser.id);
  }

  async applyManualExceptionApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      exceptionId: string;
      decision: 'approve' | 'reject' | 'cancel';
      actorUserId: string;
    },
  ): Promise<void> {
    const exception = await tx.timesheetManualException.findFirst({
      where: {
        id: params.exceptionId,
      },
      select: {
        id: true,
        objectId: true,
        employeeId: true,
        year: true,
        month: true,
        dayOfMonth: true,
        requestedDayValue: true,
        currentDayValueSnapshot: true,
        comment: true,
        status: true,
        resolvedAt: true,
      },
    });

    if (!exception) {
      throw new NotFoundException('Timesheet manual exception not found');
    }

    if (exception.status !== 'pending') {
      throw new ConflictException('Timesheet manual exception is already resolved');
    }

    if (params.decision === 'approve') {
      const monthContainer = await this.ensureMonthContainer(
        exception.objectId,
        exception.year,
        exception.month,
        params.actorUserId,
        tx,
      );
      const mutationContext = await this.prepareEntryMutationContext({
        objectId: exception.objectId,
        employeeId: exception.employeeId,
        year: exception.year,
        month: exception.month,
        dayOfMonth: exception.dayOfMonth,
        dayValue: exception.requestedDayValue,
        comment: exception.comment,
        monthContainerId: monthContainer.id,
        client: tx,
      });

      if (mutationContext.currentDayValueSnapshot !== exception.currentDayValueSnapshot) {
        throw new ConflictException(
          'Timesheet cell changed after approval request was created',
        );
      }

      await this.applyEntryMutation(tx, {
        rowId: mutationContext.row.id,
        existingEntryId: mutationContext.existingEntry?.id ?? null,
        dayOfMonth: exception.dayOfMonth,
        dayValue: exception.requestedDayValue,
        expectedAutoValue: mutationContext.expectedAutoValue,
        hasAttendanceFact: mutationContext.hasAttendanceFact,
        calculatedDay: mutationContext.calculatedDay,
        normalizedComment: exception.comment,
        actorUserId: params.actorUserId,
      });
    }

    await tx.timesheetManualException.update({
      where: {
        id: exception.id,
      },
      data: {
        status:
          params.decision === 'approve'
            ? 'approved'
            : params.decision === 'reject'
              ? 'rejected'
              : 'cancelled',
        resolvedByUserId: params.actorUserId,
        resolvedAt: new Date(),
      },
    });
  }

  private async prepareEntryMutationContext(params: {
    objectId: string;
    employeeId: string;
    year: number;
    month: number;
    dayOfMonth: number;
    dayValue: number;
    comment?: string;
    monthContainerId: string;
    client?: PrismaService | Prisma.TransactionClient;
  }): Promise<{
    row: {
      id: string;
      employeeNameSnapshot: string;
      entries: Array<{
        id: string;
        dayOfMonth: number;
        dayValue: number;
        autoValue: number;
        isChangedManually: boolean;
        ratePolicySnapshot: Prisma.JsonValue | null;
        calculationExplanation: string | null;
        workedHours: number | null;
      }>;
    };
    existingEntry: {
      id: string;
      dayOfMonth: number;
      dayValue: number;
      autoValue: number;
      isChangedManually: boolean;
      ratePolicySnapshot: Prisma.JsonValue | null;
      calculationExplanation: string | null;
      workedHours: number | null;
    } | undefined;
    expectedAutoValue: number;
    currentDayValueSnapshot: number;
    hasAttendanceFact: boolean;
    calculatedDay: CalculatedTimesheetDay | null;
    normalizedComment: string | null;
  }> {
    const client = params.client ?? this.prisma;

    const row = await client.timesheetEmployeeRow.findFirst({
      where: {
        timesheetMonthId: params.monthContainerId,
        employeeId: params.employeeId,
      },
      include: {
        entries: {
          select: {
            id: true,
            dayOfMonth: true,
            dayValue: true,
            autoValue: true,
            isChangedManually: true,
            ratePolicySnapshot: true,
            calculationExplanation: true,
            workedHours: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Employee row for timesheet not found');
    }

    const existingEntry = row.entries.find(
      (entry) => entry.dayOfMonth === params.dayOfMonth,
    );

    const attendanceFact = await client.objectAttendanceFact.findFirst({
      where: {
        objectId: params.objectId,
        employeeId: params.employeeId,
        operationDate: this.getDayRange(
          params.year,
          params.month,
          params.dayOfMonth,
        ),
      },
      select: {
        dailyRateSnapshot: true,
        workedHours: true,
        ratePolicySnapshot: true,
      },
    });

    const object = await client.object.findUnique({
      where: {
        id: params.objectId,
      },
      select: {
        dailyRate: true,
      },
    });
    const ratePolicy = await this.loadRatePolicyForEmployee({
      client,
      objectId: params.objectId,
      employeeId: params.employeeId,
      objectDailyRate: object?.dailyRate ?? 0,
    });
    const calculatedDay =
      calculateTimesheetAutoValues({
        year: params.year,
        month: params.month,
        daysInMonth: this.getDaysInMonth(params.year, params.month),
        policy: ratePolicy,
        facts: attendanceFact
          ? [
              {
                dayOfMonth: params.dayOfMonth,
                dailyRateSnapshot: attendanceFact.dailyRateSnapshot,
                workedHours: attendanceFact.workedHours,
                ratePolicySnapshot: attendanceFact.ratePolicySnapshot,
              },
            ]
          : [],
      }).get(params.dayOfMonth) ?? null;
    const expectedAutoValue = calculatedDay?.autoValue ?? 0;
    const normalizedComment = params.comment?.trim() || null;

    if (params.dayValue !== expectedAutoValue && !normalizedComment) {
      throw new BadRequestException(
        'Manual timesheet correction requires a comment',
      );
    }

    return {
      row,
      existingEntry,
      expectedAutoValue,
      currentDayValueSnapshot: existingEntry?.dayValue ?? expectedAutoValue,
      hasAttendanceFact: Boolean(attendanceFact),
      calculatedDay,
      normalizedComment,
    };
  }

  private async applyEntryMutation(
    tx: Prisma.TransactionClient,
    params: {
      rowId: string;
      existingEntryId: string | null;
      dayOfMonth: number;
      dayValue: number;
      expectedAutoValue: number;
      hasAttendanceFact: boolean;
      calculatedDay: CalculatedTimesheetDay | null;
      normalizedComment: string | null;
      actorUserId: string;
    },
  ): Promise<void> {
    if (params.dayValue === params.expectedAutoValue) {
      if (!params.hasAttendanceFact && params.expectedAutoValue === 0) {
        if (params.existingEntryId) {
          await tx.timesheetDayEntry.delete({
            where: {
              id: params.existingEntryId,
            },
          });
        }

        return;
      }

      await tx.timesheetDayEntry.upsert({
        where: {
          rowId_dayOfMonth: {
            rowId: params.rowId,
            dayOfMonth: params.dayOfMonth,
          },
        },
        update: {
          dayValue: params.expectedAutoValue,
          autoValue: params.expectedAutoValue,
          manualValue: null,
          difference: 0,
          comment: null,
          isChangedManually: false,
          workedHours: params.calculatedDay?.workedHours ?? null,
          ratePolicySnapshot: this.policySnapshotToJson(
            params.calculatedDay?.ratePolicySnapshot,
          ),
          calculationExplanation:
            params.calculatedDay?.calculationExplanation ?? null,
          updatedByUserId: params.actorUserId,
        },
        create: {
          rowId: params.rowId,
          dayOfMonth: params.dayOfMonth,
          dayValue: params.expectedAutoValue,
          autoValue: params.expectedAutoValue,
          manualValue: null,
          difference: 0,
          comment: null,
          isChangedManually: false,
          workedHours: params.calculatedDay?.workedHours ?? null,
          ratePolicySnapshot: this.policySnapshotToJson(
            params.calculatedDay?.ratePolicySnapshot,
          ),
          calculationExplanation:
            params.calculatedDay?.calculationExplanation ?? null,
          createdByUserId: params.actorUserId,
          updatedByUserId: params.actorUserId,
        },
      });

      return;
    }

    await tx.timesheetDayEntry.upsert({
      where: {
        rowId_dayOfMonth: {
          rowId: params.rowId,
          dayOfMonth: params.dayOfMonth,
        },
      },
      update: {
        dayValue: params.dayValue,
        autoValue: params.expectedAutoValue,
        manualValue: params.dayValue,
        difference: params.dayValue - params.expectedAutoValue,
        comment: params.normalizedComment,
        isChangedManually: true,
        workedHours: params.calculatedDay?.workedHours ?? null,
        ratePolicySnapshot: this.policySnapshotToJson(
          params.calculatedDay?.ratePolicySnapshot,
        ),
        calculationExplanation:
          params.calculatedDay?.calculationExplanation ?? null,
        updatedByUserId: params.actorUserId,
      },
      create: {
        rowId: params.rowId,
        dayOfMonth: params.dayOfMonth,
        dayValue: params.dayValue,
        autoValue: params.expectedAutoValue,
        manualValue: params.dayValue,
        difference: params.dayValue - params.expectedAutoValue,
        comment: params.normalizedComment,
        isChangedManually: true,
        workedHours: params.calculatedDay?.workedHours ?? null,
        ratePolicySnapshot: this.policySnapshotToJson(
          params.calculatedDay?.ratePolicySnapshot,
        ),
        calculationExplanation:
          params.calculatedDay?.calculationExplanation ?? null,
        createdByUserId: params.actorUserId,
        updatedByUserId: params.actorUserId,
      },
    });
  }

  private async assertAccess(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideTimesheetAccess(roleCodes)) {
      return;
    }

    const assignment = await this.prisma.objectAssignment.findFirst({
      where: {
        objectId,
        userId: currentUser.id,
        isActive: true,
        assignmentRoleCode: {
          in: ['manager', 'responsible'],
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException('Access to timesheet denied');
    }
  }

  private buildTimesheetObjectWhere(
    currentUser: CurrentAuthUser,
    objectId?: string,
  ): Prisma.ObjectWhereInput {
    const roleCodes = this.getRoleCodes(currentUser);

    return {
      deletedAt: null,
      ...(objectId ? { id: objectId } : {}),
      ...(hasWideTimesheetAccess(roleCodes)
        ? {}
        : {
            assignments: {
              some: {
                userId: currentUser.id,
                isActive: true,
                assignmentRoleCode: { in: ['manager', 'responsible'] },
              },
            },
          }),
    };
  }

  private emptyOverview(
    currentUser: CurrentAuthUser,
    query: GetTimesheetOverviewQueryDto,
    daysInMonth: number,
  ): TimesheetOverviewResponseDto {
    return {
      year: query.year,
      month: query.month,
      daysInMonth,
      rows: [],
      totals: { advanceTotal: 0, salaryTotal: 0, monthTotal: 0 },
      capabilities: {
        canManualCorrection: canManuallyCorrectTimesheet(
          this.getRoleCodes(currentUser),
        ),
        canExport: true,
      },
    };
  }

  private buildOverviewPairKey(objectId: string, employeeId: string): string {
    return `${objectId}:${employeeId}`;
  }

  private assertManualCorrectionAccess(currentUser: CurrentAuthUser): void {
    const roleCodes = this.getRoleCodes(currentUser);

    // TODO: extend this bridge with timesheet.manual_correction capability
    // when runtime capability enforcement is introduced.
    if (!canManuallyCorrectTimesheet(roleCodes)) {
      throw new ForbiddenException('Manual timesheet correction denied');
    }
  }

  private async ensureMonthContainer(
    objectId: string,
    year: number,
    month: number,
    currentUserId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const object = await client.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const monthContainer = await client.timesheetMonth.upsert({
      where: {
        objectId_year_month: {
          objectId,
          year,
          month,
        },
      },
      update: {},
      create: {
        objectId,
        year,
        month,
        status: 'open',
        createdByUserId: currentUserId,
      },
    });

    const [activeAssignments, monthAttendanceFacts] = await Promise.all([
      client.objectEmployeeAssignment.findMany({
        where: {
          objectId,
          isActive: true,
        },
        include: {
          employee: true,
        },
      }),
      client.objectAttendanceFact.findMany({
        where: {
          objectId,
          operationDate: this.getMonthRange(year, month),
        },
        select: {
          employeeId: true,
        },
      }),
    ]);

    const employeeIds = Array.from(
      new Set([
        ...activeAssignments.map((assignment) => assignment.employeeId),
        ...monthAttendanceFacts.map((fact) => fact.employeeId),
      ]),
    );

    if (employeeIds.length === 0) {
      return monthContainer;
    }

    const employees = await client.employee.findMany({
      where: {
        id: {
          in: employeeIds,
        },
      },
      select: {
        id: true,
        fullName: true,
      },
    });

    const employeeNameById = new Map(
      employees.map((employee) => [employee.id, employee.fullName]),
    );

    for (const employeeId of employeeIds) {
      await client.timesheetEmployeeRow.upsert({
        where: {
          timesheetMonthId_employeeId: {
            timesheetMonthId: monthContainer.id,
            employeeId,
          },
        },
        update: {
          employeeNameSnapshot: employeeNameById.get(employeeId) ?? 'Сотрудник',
        },
        create: {
          timesheetMonthId: monthContainer.id,
          employeeId,
          employeeNameSnapshot: employeeNameById.get(employeeId) ?? 'Сотрудник',
        },
      });
    }

    return monthContainer;
  }

  private async syncAutomaticEntries(params: {
    objectId: string;
    timesheetMonthId: string;
    year: number;
    month: number;
  }): Promise<void> {
    const object = await this.prisma.object.findUnique({
      where: {
        id: params.objectId,
      },
      select: {
        dailyRate: true,
      },
    });
    const rows = await this.prisma.timesheetEmployeeRow.findMany({
      where: {
        timesheetMonthId: params.timesheetMonthId,
      },
      include: {
        entries: true,
        employee: {
          select: {
            baseDailyRate: true,
          },
        },
      },
    });

    if (rows.length === 0 || !object) {
      return;
    }

    const monthFacts = await this.prisma.objectAttendanceFact.findMany({
      where: {
        objectId: params.objectId,
        operationDate: this.getMonthRange(params.year, params.month),
      },
      select: {
        employeeId: true,
        operationDate: true,
        dailyRateSnapshot: true,
        workedHours: true,
        ratePolicySnapshot: true,
      },
    });

    const daysInMonth = this.getDaysInMonth(params.year, params.month);
    const factsByEmployeeId = this.groupAttendanceFactsByEmployee(monthFacts);
    const policyByEmployeeId = await this.loadRatePoliciesByEmployeeId({
      objectId: params.objectId,
      employeeIds: rows.map((row) => row.employeeId),
      objectDailyRate: object.dailyRate,
    });
    const operations: Prisma.PrismaPromise<unknown>[] = [];

    for (const row of rows) {
      const entriesByDay = new Map(
        row.entries.map((entry) => [entry.dayOfMonth, entry]),
      );
      const ratePolicy =
        policyByEmployeeId.get(row.employeeId) ??
        normalizeRatePolicy(null, row.employee.baseDailyRate ?? object.dailyRate);
      const autoValues = calculateTimesheetAutoValues({
        year: params.year,
        month: params.month,
        daysInMonth,
        policy: ratePolicy,
        facts: factsByEmployeeId.get(row.employeeId) ?? [],
      });

      for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
        const calculatedDay = autoValues.get(dayOfMonth) ?? null;
        const autoValue = calculatedDay?.autoValue ?? 0;
        const hasAutoValue = Boolean(calculatedDay) && autoValue !== 0;
        const existing = entriesByDay.get(dayOfMonth);

        if (hasAutoValue) {
          if (!existing) {
            operations.push(
              this.prisma.timesheetDayEntry.create({
                data: {
                  rowId: row.id,
                  dayOfMonth,
                  dayValue: autoValue,
                  autoValue,
                  manualValue: null,
                  difference: 0,
                  comment: null,
                  isChangedManually: false,
                  workedHours: calculatedDay?.workedHours ?? null,
                  ratePolicySnapshot: this.policySnapshotToJson(
                    calculatedDay?.ratePolicySnapshot,
                  ),
                  calculationExplanation:
                    calculatedDay?.calculationExplanation ?? null,
                },
              }),
            );
            continue;
          }

          if (!existing.isChangedManually) {
            if (
              existing.dayValue !== autoValue ||
              existing.autoValue !== autoValue ||
              existing.comment !== null
            ) {
              operations.push(
                this.prisma.timesheetDayEntry.update({
                  where: {
                    id: existing.id,
                  },
                  data: {
                    dayValue: autoValue,
                    autoValue,
                    manualValue: null,
                    difference: 0,
                    comment: null,
                    isChangedManually: false,
                    workedHours: calculatedDay?.workedHours ?? null,
                    ratePolicySnapshot: this.policySnapshotToJson(
                      calculatedDay?.ratePolicySnapshot,
                    ),
                    calculationExplanation:
                      calculatedDay?.calculationExplanation ?? null,
                  },
                }),
              );
            }

            continue;
          }

          const hasMeaningfulManualComment =
            typeof existing.comment === 'string' &&
            existing.comment.trim().length > 0;

          if (!hasMeaningfulManualComment) {
            operations.push(
              this.prisma.timesheetDayEntry.update({
                where: {
                  id: existing.id,
                },
                data: {
                  dayValue: autoValue,
                  autoValue,
                  manualValue: null,
                  difference: 0,
                  comment: null,
                  isChangedManually: false,
                  workedHours: calculatedDay?.workedHours ?? null,
                  ratePolicySnapshot: this.policySnapshotToJson(
                    calculatedDay?.ratePolicySnapshot,
                  ),
                  calculationExplanation:
                    calculatedDay?.calculationExplanation ?? null,
                },
              }),
            );
          }

          if (hasMeaningfulManualComment) {
            operations.push(
              this.prisma.timesheetDayEntry.update({
                where: {
                  id: existing.id,
                },
                data: {
                  autoValue,
                  manualValue: existing.dayValue,
                  difference: existing.dayValue - autoValue,
                  workedHours: calculatedDay?.workedHours ?? null,
                  ratePolicySnapshot: this.policySnapshotToJson(
                    calculatedDay?.ratePolicySnapshot,
                  ),
                  calculationExplanation:
                    calculatedDay?.calculationExplanation ?? null,
                },
              }),
            );
          }

          continue;
        }

        if (existing && !existing.isChangedManually) {
          operations.push(
            this.prisma.timesheetDayEntry.delete({
              where: {
                id: existing.id,
              },
            }),
          );
        }

        if (existing?.isChangedManually) {
          operations.push(
            this.prisma.timesheetDayEntry.update({
              where: {
                id: existing.id,
              },
              data: {
                autoValue: 0,
                manualValue: existing.dayValue,
                difference: existing.dayValue,
                workedHours: null,
                calculationExplanation: null,
              },
            }),
          );
        }
      }
    }

    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
    }
  }

  private groupAttendanceFactsByEmployee(
    facts: Array<{
      employeeId: string;
      operationDate: Date;
      dailyRateSnapshot: number;
      workedHours: number | null;
      ratePolicySnapshot: Prisma.JsonValue | null;
    }>,
  ): Map<string, Array<{
    dayOfMonth: number;
    dailyRateSnapshot: number;
    workedHours: number | null;
    ratePolicySnapshot: Prisma.JsonValue | null;
  }>> {
    const grouped = new Map<string, Array<{
      dayOfMonth: number;
      dailyRateSnapshot: number;
      workedHours: number | null;
      ratePolicySnapshot: Prisma.JsonValue | null;
    }>>();

    for (const fact of facts) {
      const items = grouped.get(fact.employeeId) ?? [];
      items.push({
        dayOfMonth: new Date(fact.operationDate).getDate(),
        dailyRateSnapshot: fact.dailyRateSnapshot,
        workedHours: fact.workedHours,
        ratePolicySnapshot: fact.ratePolicySnapshot,
      });
      grouped.set(fact.employeeId, items);
    }

    return grouped;
  }

  private async loadRatePoliciesByEmployeeId(params: {
    objectId: string;
    employeeIds: string[];
    objectDailyRate: number;
    client?: PrismaService | Prisma.TransactionClient;
  }): Promise<Map<string, TimesheetRatePolicySnapshot>> {
    const client = params.client ?? this.prisma;

    if (params.employeeIds.length === 0) {
      return new Map();
    }

    const assignments = await client.objectEmployeeAssignment.findMany({
      where: {
        objectId: params.objectId,
        employeeId: {
          in: params.employeeIds,
        },
      },
      include: {
        employee: {
          select: {
            baseDailyRate: true,
          },
        },
      },
    });

    return new Map(
      assignments.map((assignment) => [
        assignment.employeeId,
        normalizeRatePolicy(
          assignment as RatePolicyRecord,
          params.objectDailyRate,
        ),
      ]),
    );
  }

  private async loadRatePolicyForEmployee(params: {
    objectId: string;
    employeeId: string;
    objectDailyRate: number;
    client: PrismaService | Prisma.TransactionClient;
  }): Promise<TimesheetRatePolicySnapshot> {
    const policies = await this.loadRatePoliciesByEmployeeId({
      objectId: params.objectId,
      employeeIds: [params.employeeId],
      objectDailyRate: params.objectDailyRate,
      client: params.client,
    });

    return policies.get(params.employeeId) ?? normalizeRatePolicy(null, params.objectDailyRate);
  }

  private normalizeStoredPolicySnapshot(
    value: Prisma.JsonValue | null,
  ): TimesheetRatePolicySnapshot | null {
    return parseRatePolicySnapshot(value);
  }

  private policySnapshotToJson(
    value: TimesheetRatePolicySnapshot | undefined,
  ): Prisma.InputJsonValue | undefined {
    return value
      ? (value as unknown as Prisma.InputJsonObject)
      : undefined;
  }

  private buildPolicySummaryRows(timesheet: TimesheetResponseDto): XlsxCell[][] {
    const summary = new Map<string, { employees: number; total: number }>();

    for (const row of timesheet.rows) {
      const current = summary.get(row.ratePolicy.ratePolicyType) ?? {
        employees: 0,
        total: 0,
      };
      current.employees += 1;
      current.total += row.rowTotal;
      summary.set(row.ratePolicy.ratePolicyType, current);
    }

    return [...summary.entries()].map(([policyType, item]) => [
      policyType,
      `сотрудников: ${item.employees}`,
      item.total,
    ]);
  }

  private mapApprovalRequest(
    request: {
      id: string;
      approvalType: string;
      sourceEntityType: string;
      sourceEntityId: string;
      status: string;
      decisionComment: string | null;
      payloadSnapshot: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
      resolvedAt: Date | null;
      cancelledAt: Date | null;
      createdBy: {
        id: string;
        login: string;
        fullName: string;
      };
      resolvedBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
      cancelledBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
    },
    currentUserId: string,
  ): ApprovalRequestResponseDto {
    const payloadSnapshot =
      request.payloadSnapshot &&
      typeof request.payloadSnapshot === 'object' &&
      !Array.isArray(request.payloadSnapshot)
        ? (request.payloadSnapshot as Prisma.JsonObject as Record<string, unknown>)
        : {};

    const summaryTitle =
      typeof payloadSnapshot.summaryTitle === 'string' &&
      payloadSnapshot.summaryTitle.trim()
        ? payloadSnapshot.summaryTitle
        : request.approvalType;
    const summarySubtitle =
      typeof payloadSnapshot.summarySubtitle === 'string' &&
      payloadSnapshot.summarySubtitle.trim()
        ? payloadSnapshot.summarySubtitle
        : null;

    return {
      id: request.id,
      approvalType: request.approvalType,
      sourceEntityType: request.sourceEntityType,
      sourceEntityId: request.sourceEntityId,
      status: request.status,
      decisionComment: request.decisionComment,
      payloadSnapshot,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      createdBy: request.createdBy,
      resolvedBy: request.resolvedBy,
      cancelledBy: request.cancelledBy,
      summary: {
        title: summaryTitle,
        subtitle: summarySubtitle,
      },
      capabilities: {
        canApprove: false,
        canReject: false,
        canCancel:
          request.status === 'pending' && request.createdBy.id === currentUserId,
      },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  private getMonthRange(year: number, month: number) {
    return {
      gte: new Date(year, month - 1, 1),
      lt: new Date(year, month, 1),
    };
  }

  private getDayRange(year: number, month: number, dayOfMonth: number) {
    return {
      gte: new Date(year, month - 1, dayOfMonth),
      lt: new Date(year, month - 1, dayOfMonth + 1),
    };
  }

  private toExcelColumnName(index: number): string {
    let value = index;
    let name = '';

    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }

    return name;
  }
}
