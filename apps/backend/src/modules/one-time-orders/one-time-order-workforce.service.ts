import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createSimpleXlsxWorkbook } from '../timesheets/utils/simple-xlsx.util';
import type { XlsxCell } from '../timesheets/utils/simple-xlsx.util';
import { canReviewAccountability } from '../accountability/utils/accountability-access.util';

import {
  AddOneTimeOrderEmployeeDto,
  UpdateOneTimeOrderEmployeePaymentDto,
} from './dto/one-time-order-workforce.dto';
import { canEditOneTimeOrderByScope, canViewOneTimeOrderByScope } from './utils/one-time-order-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface OrderScope {
  id: string;
  title: string;
  workCycle: number;
  createdByUserId: string;
  executionDate: Date | null;
  executionStartDate: Date | null;
  executionEndDate: Date | null;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
    isActive: boolean;
  }>;
}

export interface OneTimeOrderWorkforceEmployee {
  employeeId: string;
  fullName: string;
  position: string | null;
  baseDailyRate: number | null;
  orderPayment: number | null;
  isActive: boolean;
  assignedAt: string;
  removedAt: string | null;
}

export interface OneTimeOrderAttendanceResponse {
  operationDate: string;
  workCycle: number;
  submittedAt: string | null;
  submittedBy: { id: string; fullName: string } | null;
  employees: Array<
    OneTimeOrderWorkforceEmployee & {
      present: boolean;
      rateSnapshot: number | null;
      finalValue: number | null;
    }
  >;
}

export interface OneTimeOrderAttendanceCoverageResponse {
  workCycle: number;
  startDate: string | null;
  endDate: string | null;
  missingDates: string[];
  history: Array<{
    operationDate: string;
    action: string;
    at: string;
    actor: string;
    reason: string | null;
    presentEmployees: string[];
    previousPresentEmployees: string[];
  }>;
  days: Array<{
    operationDate: string;
    hasAttendance: boolean;
    submittedAt: string | null;
    submittedBy: { id: string; fullName: string } | null;
    presentEmployeeCount: number;
    employeeCount: number;
  }>;
}

export interface OneTimeOrderTimesheetResponse {
  oneTimeOrderId: string;
  workCycle: number;
  month: string;
  rows: Array<{
    employeeId: string;
    fullName: string;
    days: Array<{
      operationDate: string;
      present: boolean;
      rateSnapshot: number;
      automaticValue: number;
      finalValue: number;
      manualOverride: boolean;
      manualReason: string | null;
    }>;
    total: number;
    paidTotal: number | null;
    pendingPayoutTotal: number | null;
  }>;
}

export interface OneTimeOrderTimesheetExportQuery {
  month?: string;
  workCycle?: number;
  employeeId?: string;
}

@Injectable()
export class OneTimeOrderWorkforceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listEmployees(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    const order = await this.assertOrderVisible(currentUser, orderId);
    const rows = await this.prisma.$queryRaw<
      Array<{
        employeeId: string;
        fullName: string;
        position: string | null;
        baseDailyRate: number | null;
        orderPayment: Prisma.Decimal | null;
        isActive: boolean;
        assignedAt: Date;
        removedAt: Date | null;
      }>
    >`
      SELECT
        assignment."employeeId",
        employee."fullName",
        employee."position",
        employee."baseDailyRate",
        assignment."orderPayment",
        assignment."isActive",
        assignment."assignedAt",
        assignment."removedAt"
      FROM "one_time_order_employee_assignments" assignment
      JOIN "employees" employee ON employee."id" = assignment."employeeId"
      WHERE assignment."oneTimeOrderId" = ${order.id}
        AND assignment."workCycle" = ${order.workCycle}
        AND employee."deletedAt" IS NULL
      ORDER BY assignment."isActive" DESC, employee."fullName" ASC
    `;
    return rows.map((row) => ({
      ...row,
      baseDailyRate:
        row.baseDailyRate === null ? null : Number(row.baseDailyRate),
      orderPayment:
        row.orderPayment === null ? null : Number(row.orderPayment),
      assignedAt: row.assignedAt.toISOString(),
      removedAt: row.removedAt?.toISOString() ?? null,
    }));
  }

  async addEmployee(
    currentUser: CurrentAuthUser,
    orderId: string,
    payload: AddOneTimeOrderEmployeeDto,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    const order = await this.assertOrderWritable(currentUser, orderId);
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: payload.employeeId,
        deletedAt: null,
        employmentStatus: { not: 'dismissed' },
      },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.$executeRaw`
      INSERT INTO "one_time_order_employee_assignments" (
        "id", "oneTimeOrderId", "workCycle", "employeeId", "isActive",
        "assignedAt", "removedAt", "createdByUserId", "removedByUserId",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::TEXT, ${order.id}, ${order.workCycle}, ${employee.id}, true,
        CURRENT_TIMESTAMP, NULL, ${currentUser.id}, NULL,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("oneTimeOrderId", "workCycle", "employeeId")
      DO UPDATE SET
        "isActive" = true,
        "assignedAt" = CURRENT_TIMESTAMP,
        "removedAt" = NULL,
        "removedByUserId" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    `;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: order.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.workforce.employee_added',
      newValues: {
        employeeId: employee.id,
        workCycle: order.workCycle,
      },
    });
    return this.listEmployees(currentUser, order.id);
  }

  async updateEmployeePayment(
    currentUser: CurrentAuthUser,
    orderId: string,
    employeeId: string,
    payload: UpdateOneTimeOrderEmployeePaymentDto,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    const order = await this.assertOrderWritable(currentUser, orderId);
    const existing = await this.prisma.$queryRaw<
      Array<{ orderPayment: Prisma.Decimal | null }>
    >`
      SELECT assignment."orderPayment"
      FROM "one_time_order_employee_assignments" assignment
      WHERE assignment."oneTimeOrderId" = ${order.id}
        AND assignment."workCycle" = ${order.workCycle}
        AND assignment."employeeId" = ${employeeId}
        AND assignment."isActive" = true
      LIMIT 1
    `;
    if (existing.length === 0) {
      throw new NotFoundException('Active one-time employee assignment not found');
    }

    const nextAmount =
      payload.amount === undefined || payload.amount === null
        ? null
        : new Prisma.Decimal(payload.amount);
    await this.prisma.$executeRaw`
      UPDATE "one_time_order_employee_assignments"
      SET
        "orderPayment" = ${nextAmount},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "oneTimeOrderId" = ${order.id}
        AND "workCycle" = ${order.workCycle}
        AND "employeeId" = ${employeeId}
        AND "isActive" = true
    `;

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: order.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.workforce.payment_changed',
      oldValues: {
        employeeId,
        workCycle: order.workCycle,
        amount:
          existing[0]?.orderPayment === null ||
          existing[0]?.orderPayment === undefined
            ? null
            : Number(existing[0].orderPayment),
      },
      newValues: {
        employeeId,
        workCycle: order.workCycle,
        amount: nextAmount === null ? null : Number(nextAmount),
      },
    });

    return this.listEmployees(currentUser, order.id);
  }

  async removeEmployee(
    currentUser: CurrentAuthUser,
    orderId: string,
    employeeId: string,
  ): Promise<OneTimeOrderWorkforceEmployee[]> {
    const order = await this.assertOrderWritable(currentUser, orderId);
    const changed = await this.prisma.$executeRaw`
      UPDATE "one_time_order_employee_assignments"
      SET
        "isActive" = false,
        "removedAt" = CURRENT_TIMESTAMP,
        "removedByUserId" = ${currentUser.id},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "oneTimeOrderId" = ${order.id}
        AND "workCycle" = ${order.workCycle}
        AND "employeeId" = ${employeeId}
        AND "isActive" = true
    `;
    if (changed === 0) {
      throw new NotFoundException('Active one-time employee assignment not found');
    }

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: order.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.workforce.employee_removed',
      newValues: { employeeId, workCycle: order.workCycle },
    });
    return this.listEmployees(currentUser, order.id);
  }

  async getTodayAttendance(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OneTimeOrderAttendanceResponse> {
    return this.getAttendance(currentUser, orderId);
  }

  async getAttendance(
    currentUser: CurrentAuthUser,
    orderId: string,
    requestedDate?: string,
  ): Promise<OneTimeOrderAttendanceResponse> {
    const order = await this.assertOrderVisible(currentUser, orderId);
    const operationDate = requestedDate ?? this.getMoscowBusinessDate();
    this.assertValidOperationDate(operationDate);
    return this.loadAttendance(order, operationDate);
  }

  async getAttendanceCoverage(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OneTimeOrderAttendanceCoverageResponse> {
    const order = await this.assertOrderVisible(currentUser, orderId);
    const start = order.executionStartDate ?? order.executionDate;
    const end = order.executionEndDate ?? start;
    if (!start || !end) {
      return { workCycle: order.workCycle, startDate: null, endDate: null, missingDates: [], days: [], history: [] };
    }
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    if (endDate < startDate) throw new BadRequestException('Order execution end date precedes start date');
    const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
    const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
    const dayCount = Math.floor((endMs - startMs) / 86_400_000) + 1;
    if (dayCount > 366) throw new BadRequestException('Attendance coverage range cannot exceed one year');

    const [submissions, entries, auditEvents] = await Promise.all([
      this.prisma.$queryRaw<Array<{ operationDate: Date; submittedAt: Date; submittedByUserId: string; fullName: string }>>`
        SELECT submission."operationDate", submission."submittedAt", submission."submittedByUserId", users."fullName"
        FROM "one_time_order_attendance_submissions" submission
        JOIN "users" users ON users."id" = submission."submittedByUserId"
        WHERE submission."oneTimeOrderId" = ${order.id}
          AND submission."workCycle" = ${order.workCycle}
          AND submission."operationDate" >= ${startDate}::DATE
          AND submission."operationDate" <= ${endDate}::DATE
      `,
      this.prisma.$queryRaw<Array<{ operationDate: Date; employeeCount: bigint; presentEmployeeCount: bigint }>>`
        SELECT entry."operationDate", COUNT(*) AS "employeeCount",
          COUNT(*) FILTER (WHERE entry."attendancePresent" = true) AS "presentEmployeeCount"
        FROM "one_time_order_timesheet_day_entries" entry
        WHERE entry."oneTimeOrderId" = ${order.id}
          AND entry."workCycle" = ${order.workCycle}
          AND entry."operationDate" >= ${startDate}::DATE
          AND entry."operationDate" <= ${endDate}::DATE
        GROUP BY entry."operationDate"
      `,
      this.prisma.$queryRaw<Array<{
        action: string;
        createdAt: Date;
        fullName: string;
        oldValues: Prisma.JsonValue | null;
        newValues: Prisma.JsonValue | null;
      }>>`
        SELECT event."action", event."createdAt", users."fullName",
          event."oldValues", event."newValues"
        FROM "audit_events" event
        LEFT JOIN "users" users ON users."id" = event."actorUserId"
        WHERE event."entityType" = 'one_time_order'
          AND event."entityId" = ${order.id}
          AND event."action" IN ('one_time_order.attendance.submitted', 'one_time_order.attendance.corrected')
          AND COALESCE(event."newValues"->>'workCycle', event."oldValues"->>'workCycle') = ${String(order.workCycle)}
          AND COALESCE(event."newValues"->>'operationDate', event."oldValues"->>'operationDate') >= ${startDate}
          AND COALESCE(event."newValues"->>'operationDate', event."oldValues"->>'operationDate') <= ${endDate}
        ORDER BY event."createdAt" DESC
      `,
    ]);
    const submissionByDate = new Map(submissions.map((item) => [item.operationDate.toISOString().slice(0, 10), item]));
    const entriesByDate = new Map(entries.map((item) => [item.operationDate.toISOString().slice(0, 10), item]));
    const parseAuditObject = (value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> =>
      value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
    const auditObjects = auditEvents.map((event) => ({
      event,
      oldValues: parseAuditObject(event.oldValues),
      newValues: parseAuditObject(event.newValues),
    }));
    const employeeIds = [...new Set(auditObjects.flatMap(({ oldValues, newValues }) => [
      ...(Array.isArray(oldValues.presentEmployeeIds) ? oldValues.presentEmployeeIds : []),
      ...(Array.isArray(newValues.presentEmployeeIds) ? newValues.presentEmployeeIds : []),
    ]).filter((value): value is string => typeof value === 'string'))];
    const employeeNames = new Map((await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } }, select: { id: true, fullName: true },
    })).map((employee) => [employee.id, employee.fullName]));
    const history = auditObjects.map(({ event, oldValues, newValues }) => {
      const idList = (value: Prisma.JsonValue | undefined): string[] =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      const names = (ids: string[]): string[] => ids.map((id) => employeeNames.get(id) ?? 'Сотрудник');
      const dateValue = newValues.operationDate ?? oldValues.operationDate;
      return {
        operationDate: typeof dateValue === 'string' ? dateValue : '',
        action: event.action,
        at: event.createdAt.toISOString(),
        actor: event.fullName ?? 'Пользователь удалён',
        reason: typeof newValues.reason === 'string' ? newValues.reason : null,
        presentEmployees: names(idList(newValues.presentEmployeeIds)),
        previousPresentEmployees: names(idList(oldValues.presentEmployeeIds)),
      };
    });
    const days = Array.from({ length: dayCount }, (_unused, index) => {
      const operationDate = new Date(startMs + index * 86_400_000).toISOString().slice(0, 10);
      const submission = submissionByDate.get(operationDate);
      const facts = entriesByDate.get(operationDate);
      return {
        operationDate,
        hasAttendance: Boolean(submission),
        submittedAt: submission?.submittedAt.toISOString() ?? null,
        submittedBy: submission ? { id: submission.submittedByUserId, fullName: submission.fullName } : null,
        presentEmployeeCount: Number(facts?.presentEmployeeCount ?? 0n),
        employeeCount: Number(facts?.employeeCount ?? 0n),
      };
    });
    return {
      workCycle: order.workCycle,
      startDate,
      endDate,
      missingDates: days.filter((day) => !day.hasAttendance).map((day) => day.operationDate),
      days,
      history,
    };
  }

  async submitTodayAttendance(
    currentUser: CurrentAuthUser,
    orderId: string,
    employeeIds: string[],
    requestedDate?: string,
    correctionReason?: string,
  ): Promise<OneTimeOrderAttendanceResponse> {
    const order = await this.assertOrderWritable(currentUser, orderId);
    const operationDate = requestedDate ?? this.getMoscowBusinessDate();
    this.assertValidOperationDate(operationDate);
    if (operationDate > this.getMoscowBusinessDate()) {
      throw new BadRequestException('Attendance cannot be recorded for a future date');
    }
    const activeEmployees = await this.prisma.$queryRaw<
      Array<{ employeeId: string; baseDailyRate: number | null }>
    >`
      SELECT assignment."employeeId", employee."baseDailyRate"
      FROM "one_time_order_employee_assignments" assignment
      JOIN "employees" employee ON employee."id" = assignment."employeeId"
      WHERE assignment."oneTimeOrderId" = ${order.id}
        AND assignment."workCycle" = ${order.workCycle}
        AND assignment."assignedAt"::DATE <= ${operationDate}::DATE
        AND (assignment."isActive" = true OR assignment."removedAt"::DATE >= ${operationDate}::DATE)
        AND employee."deletedAt" IS NULL
    `;
    const activeIds = new Set(activeEmployees.map((item) => item.employeeId));
    for (const employeeId of employeeIds) {
      if (!activeIds.has(employeeId)) {
        throw new BadRequestException(
          'Attendance contains an employee outside the active one-time workforce',
        );
      }
    }
    const presentIds = new Set(employeeIds);

    await this.prisma.$transaction(async (tx) => {
      const existingSubmission = await tx.$queryRaw<Array<{
        submittedAt: Date;
        submittedByUserId: string;
      }>>`
        SELECT "submittedAt", "submittedByUserId"
        FROM "one_time_order_attendance_submissions"
        WHERE "oneTimeOrderId" = ${order.id}
          AND "workCycle" = ${order.workCycle}
          AND "operationDate" = ${operationDate}::DATE
        FOR UPDATE
      `;
      const oldEntries = await tx.$queryRaw<Array<{
        employeeId: string;
        attendancePresent: boolean;
      }>>`
        SELECT "employeeId", "attendancePresent"
        FROM "one_time_order_timesheet_day_entries"
        WHERE "oneTimeOrderId" = ${order.id}
          AND "workCycle" = ${order.workCycle}
          AND "operationDate" = ${operationDate}::DATE
      `;
      const oldPresentIds = oldEntries.filter((entry) => entry.attendancePresent).map((entry) => entry.employeeId).sort();
      const nextPresentIds = [...presentIds].sort();
      const changed = Boolean(existingSubmission[0]) && JSON.stringify(oldPresentIds) !== JSON.stringify(nextPresentIds);
      const normalizedReason = correctionReason?.trim();
      if (changed && !normalizedReason) {
        throw new BadRequestException('A reason is required to change a saved attendance record');
      }
      for (const employee of activeEmployees) {
        const present = presentIds.has(employee.employeeId);
        const rate = new Prisma.Decimal(employee.baseDailyRate ?? 0);
        const automaticValue = present ? rate : new Prisma.Decimal(0);
        await tx.$executeRaw`
          INSERT INTO "one_time_order_timesheet_day_entries" (
            "id", "oneTimeOrderId", "workCycle", "employeeId", "operationDate",
            "attendancePresent", "rateSnapshot", "automaticValue", "finalValue",
            "manualOverride", "manualReason", "createdByUserId", "updatedByUserId",
            "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::TEXT, ${order.id}, ${order.workCycle}, ${employee.employeeId},
            ${operationDate}::DATE, ${present}, ${rate}, ${automaticValue}, ${automaticValue},
            false, NULL, ${currentUser.id}, ${currentUser.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT ("oneTimeOrderId", "workCycle", "employeeId", "operationDate")
          DO UPDATE SET
            "attendancePresent" = EXCLUDED."attendancePresent",
            "automaticValue" = CASE
              WHEN "one_time_order_timesheet_day_entries"."attendancePresent" IS DISTINCT FROM EXCLUDED."attendancePresent"
                THEN CASE WHEN EXCLUDED."attendancePresent" THEN "one_time_order_timesheet_day_entries"."rateSnapshot" ELSE 0 END
              ELSE "one_time_order_timesheet_day_entries"."automaticValue"
            END,
            "finalValue" = CASE
              WHEN "one_time_order_timesheet_day_entries"."manualOverride" = true
                THEN "one_time_order_timesheet_day_entries"."finalValue"
              WHEN "one_time_order_timesheet_day_entries"."attendancePresent" IS DISTINCT FROM EXCLUDED."attendancePresent"
                THEN CASE WHEN EXCLUDED."attendancePresent" THEN "one_time_order_timesheet_day_entries"."rateSnapshot" ELSE 0 END
              ELSE "one_time_order_timesheet_day_entries"."finalValue"
            END,
            "updatedByUserId" = EXCLUDED."updatedByUserId",
            "updatedAt" = CURRENT_TIMESTAMP
        `;
      }

      await tx.$executeRaw`
        INSERT INTO "one_time_order_attendance_submissions" (
          "id", "oneTimeOrderId", "workCycle", "operationDate", "submittedAt", "submittedByUserId"
        ) VALUES (
          gen_random_uuid()::TEXT, ${order.id}, ${order.workCycle}, ${operationDate}::DATE,
          CURRENT_TIMESTAMP, ${currentUser.id}
        )
        ON CONFLICT ("oneTimeOrderId", "workCycle", "operationDate")
        DO UPDATE SET
          "submittedAt" = CURRENT_TIMESTAMP,
          "submittedByUserId" = EXCLUDED."submittedByUserId"
      `;

      if (changed) {
        await this.auditService.writeAuditEvent({
          entityType: 'one_time_order',
          entityId: order.id,
          actorUserId: currentUser.id,
          action: 'one_time_order.attendance.corrected',
          oldValues: {
            workCycle: order.workCycle,
            operationDate,
            presentEmployeeIds: oldPresentIds,
            submittedAt: existingSubmission[0]?.submittedAt.toISOString() ?? null,
            submittedByUserId: existingSubmission[0]?.submittedByUserId ?? null,
          },
          newValues: {
            workCycle: order.workCycle,
            operationDate,
            presentEmployeeIds: nextPresentIds,
            reason: normalizedReason,
          },
        }, tx);
      } else if (!existingSubmission[0]) {
        await this.auditService.writeAuditEvent({
          entityType: 'one_time_order',
          entityId: order.id,
          actorUserId: currentUser.id,
          action: 'one_time_order.attendance.submitted',
          newValues: {
            workCycle: order.workCycle,
            operationDate,
            presentEmployeeIds: nextPresentIds,
            corrected: false,
          },
        }, tx);
      }
    });
    return this.loadAttendance(order, operationDate);
  }

  async getTimesheet(
    currentUser: CurrentAuthUser,
    orderId: string,
    month?: string,
    requestedWorkCycle?: number,
  ): Promise<OneTimeOrderTimesheetResponse> {
    const order = await this.assertOrderVisible(currentUser, orderId);
    const workCycle = requestedWorkCycle ?? order.workCycle;
    const normalizedMonth = month ?? this.getMoscowBusinessDate().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) {
      throw new BadRequestException('month must use YYYY-MM format');
    }
    const [year, monthNumber] = normalizedMonth.split('-').map(Number);
    if (monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('month must use YYYY-MM format');
    }
    const nextMonth = monthNumber === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
    const start = `${normalizedMonth}-01`;

    const entries = await this.prisma.$queryRaw<
      Array<{
        employeeId: string;
        fullName: string;
        operationDate: Date;
        attendancePresent: boolean;
        rateSnapshot: Prisma.Decimal;
        automaticValue: Prisma.Decimal;
        finalValue: Prisma.Decimal;
        manualOverride: boolean;
        manualReason: string | null;
      }>
    >`
      SELECT
        entry."employeeId",
        employee."fullName",
        entry."operationDate",
        entry."attendancePresent",
        entry."rateSnapshot",
        entry."automaticValue",
        entry."finalValue",
        entry."manualOverride",
        entry."manualReason"
      FROM "one_time_order_timesheet_day_entries" entry
      JOIN "employees" employee ON employee."id" = entry."employeeId"
      WHERE entry."oneTimeOrderId" = ${order.id}
        AND entry."workCycle" = ${workCycle}
        AND entry."operationDate" >= ${start}::DATE
        AND entry."operationDate" < ${nextMonth}::DATE
      ORDER BY employee."fullName" ASC, entry."operationDate" ASC
    `;

    const canViewPayouts = canReviewAccountability({
      roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
      permissionCodes: currentUser.permissionCodes,
    }) || order.assignments.some(
      (assignment) => assignment.userId === currentUser.id &&
        assignment.assignmentRoleCode === 'one_time_manager',
    );
    const payoutRows = canViewPayouts
      ? await this.prisma.$queryRaw<Array<{
          employeeId: string;
          fullName: string;
          paidTotal: Prisma.Decimal;
          pendingPayoutTotal: Prisma.Decimal;
        }>>`
          SELECT
            expense."employeeId",
            employee."fullName",
            COALESCE(SUM(expense."amount") FILTER (WHERE expense."status" IN ('approved', 'reconciled')), 0) AS "paidTotal",
            COALESCE(SUM(expense."amount") FILTER (WHERE expense."status" IN ('draft', 'submitted')), 0) AS "pendingPayoutTotal"
          FROM "accountability_expenses" expense
          JOIN "accountability_accounts" account
            ON account."id" = expense."accountabilityAccountId"
          JOIN "employees" employee ON employee."id" = expense."employeeId"
          WHERE expense."oneTimeOrderId" = ${order.id}
            AND expense."oneTimeOrderWorkCycle" = ${workCycle}
            AND expense."expenseCategory" = 'employee_payout'
            AND expense."expenseDate" >= ${start}::DATE
            AND expense."expenseDate" < ${nextMonth}::DATE
            AND (${canReviewAccountability({
              roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
              permissionCodes: currentUser.permissionCodes,
            })} OR account."userId" = ${currentUser.id})
          GROUP BY expense."employeeId", employee."fullName"
        `
      : [];

    const rows = new Map<string, OneTimeOrderTimesheetResponse['rows'][number]>();
    for (const entry of entries) {
      let row = rows.get(entry.employeeId);
      if (!row) {
        row = {
          employeeId: entry.employeeId,
          fullName: entry.fullName,
          days: [],
          total: 0,
          paidTotal: canViewPayouts ? 0 : null,
          pendingPayoutTotal: canViewPayouts ? 0 : null,
        };
        rows.set(entry.employeeId, row);
      }
      const finalValue = Number(entry.finalValue);
      row.days.push({
        operationDate: entry.operationDate.toISOString().slice(0, 10),
        present: entry.attendancePresent,
        rateSnapshot: Number(entry.rateSnapshot),
        automaticValue: Number(entry.automaticValue),
        finalValue,
        manualOverride: entry.manualOverride,
        manualReason: entry.manualReason,
      });
      row.total += finalValue;
    }

    for (const payout of payoutRows) {
      let row = rows.get(payout.employeeId);
      if (!row) {
        row = {
          employeeId: payout.employeeId,
          fullName: payout.fullName,
          days: [],
          total: 0,
          paidTotal: 0,
          pendingPayoutTotal: 0,
        };
        rows.set(payout.employeeId, row);
      }
      row.paidTotal = Number(payout.paidTotal);
      row.pendingPayoutTotal = Number(payout.pendingPayoutTotal);
    }

    return {
      oneTimeOrderId: order.id,
      workCycle,
      month: normalizedMonth,
      rows: Array.from(rows.values()),
    };
  }

  async exportTimesheet(
    currentUser: CurrentAuthUser,
    orderId: string,
    query: OneTimeOrderTimesheetExportQuery,
  ): Promise<Buffer> {
    const timesheet = await this.getTimesheet(currentUser, orderId, query.month, query.workCycle);
    const rows: XlsxCell[][] = [
      [{ value: `Разовый заказ ${orderId}`, styleId: 1 }],
      [{ value: `Цикл ${timesheet.workCycle} · ${timesheet.month}` }],
      [],
      [
        { value: 'Сотрудник', styleId: 1 },
        { value: 'Дата', styleId: 1 },
        { value: 'Отметка', styleId: 1 },
        { value: 'Ставка на дату', styleId: 1 },
        { value: 'Автоматически', styleId: 1 },
        { value: 'Итог', styleId: 1 },
        { value: 'Изменено вручную', styleId: 1 },
        { value: 'Причина изменения', styleId: 1 },
      ],
    ];
    for (const person of timesheet.rows) {
      if (query.employeeId && person.employeeId !== query.employeeId) continue;
      for (const day of person.days) {
        rows.push([
          person.fullName,
          day.operationDate,
          day.present ? 'Вышел' : 'Не вышел',
          day.rateSnapshot,
          day.automaticValue,
          day.finalValue,
          day.manualOverride ? 'Да' : 'Нет',
          day.manualReason,
        ]);
      }
    }
    if (rows.length === 4) rows.push(['За выбранный период отметок нет.']);
    return createSimpleXlsxWorkbook([{
      name: 'Выходы',
      rows,
      columnWidths: [30, 14, 14, 18, 18, 18, 20, 42],
      freeze: { rows: 4, columns: 1 },
      pageSetup: { orientation: 'landscape', fitToWidth: 1 },
    }, {
      name: 'Выплаты',
      rows: [
        [{ value: `Разовый заказ ${orderId} · цикл ${timesheet.workCycle} · ${timesheet.month}`, styleId: 1 }],
        [],
        [
          { value: 'Сотрудник', styleId: 1 },
          { value: 'Начислено по табелю', styleId: 1 },
          { value: 'Фактически выплачено', styleId: 1 },
          { value: 'Черновики и на проверке', styleId: 1 },
          { value: 'Остаток к выплате', styleId: 1 },
        ],
        ...timesheet.rows
          .filter((person) => !query.employeeId || person.employeeId === query.employeeId)
          .map((person) => [
            person.fullName,
            person.total,
            person.paidTotal,
            person.pendingPayoutTotal,
            person.paidTotal === null ? null : person.total - person.paidTotal,
          ]),
      ],
      columnWidths: [30, 22, 22, 20, 20],
      freeze: { rows: 3, columns: 1 },
      pageSetup: { orientation: 'landscape', fitToWidth: 1 },
    }]);
  }

  private async loadAttendance(
    order: OrderScope,
    operationDate: string,
  ): Promise<OneTimeOrderAttendanceResponse> {
    const employees = await this.prisma.$queryRaw<
      Array<{
        employeeId: string;
        fullName: string;
        position: string | null;
        baseDailyRate: number | null;
        orderPayment: Prisma.Decimal | null;
        isActive: boolean;
        assignedAt: Date;
        removedAt: Date | null;
        attendancePresent: boolean | null;
        rateSnapshot: Prisma.Decimal | null;
        finalValue: Prisma.Decimal | null;
      }>
    >`
      SELECT
        assignment."employeeId",
        employee."fullName",
        employee."position",
        employee."baseDailyRate",
        assignment."orderPayment",
        assignment."isActive",
        assignment."assignedAt",
        assignment."removedAt",
        entry."attendancePresent",
        entry."rateSnapshot",
        entry."finalValue"
      FROM "one_time_order_employee_assignments" assignment
      JOIN "employees" employee ON employee."id" = assignment."employeeId"
      LEFT JOIN "one_time_order_timesheet_day_entries" entry
        ON entry."oneTimeOrderId" = assignment."oneTimeOrderId"
       AND entry."workCycle" = assignment."workCycle"
       AND entry."employeeId" = assignment."employeeId"
       AND entry."operationDate" = ${operationDate}::DATE
      WHERE assignment."oneTimeOrderId" = ${order.id}
        AND assignment."workCycle" = ${order.workCycle}
        AND assignment."assignedAt"::DATE <= ${operationDate}::DATE
        AND (assignment."isActive" = true OR assignment."removedAt"::DATE >= ${operationDate}::DATE)
        AND employee."deletedAt" IS NULL
      ORDER BY employee."fullName" ASC
    `;
    const submission = await this.prisma.$queryRaw<
      Array<{
        submittedAt: Date;
        submittedByUserId: string;
        fullName: string;
      }>
    >`
      SELECT submission."submittedAt", submission."submittedByUserId", users."fullName"
      FROM "one_time_order_attendance_submissions" submission
      JOIN "users" users ON users."id" = submission."submittedByUserId"
      WHERE submission."oneTimeOrderId" = ${order.id}
        AND submission."workCycle" = ${order.workCycle}
        AND submission."operationDate" = ${operationDate}::DATE
      LIMIT 1
    `;

    return {
      operationDate,
      workCycle: order.workCycle,
      submittedAt: submission[0]?.submittedAt.toISOString() ?? null,
      submittedBy: submission[0]
        ? {
            id: submission[0].submittedByUserId,
            fullName: submission[0].fullName,
          }
        : null,
      employees: employees.map((employee) => ({
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        position: employee.position,
        baseDailyRate:
          employee.baseDailyRate === null ? null : Number(employee.baseDailyRate),
        orderPayment:
          employee.orderPayment === null ? null : Number(employee.orderPayment),
        isActive: employee.isActive,
        assignedAt: employee.assignedAt.toISOString(),
        removedAt: employee.removedAt?.toISOString() ?? null,
        present: employee.attendancePresent === true,
        rateSnapshot:
          employee.rateSnapshot === null ? null : Number(employee.rateSnapshot),
        finalValue:
          employee.finalValue === null ? null : Number(employee.finalValue),
      })),
    };
  }

  private async assertOrderVisible(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OrderScope> {
    const order = await this.loadOrderScope(orderId);
    if (
      !canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
        permissionCodes: currentUser.permissionCodes,
        order,
      })
    ) {
      throw new ForbiddenException('One-time workforce access denied');
    }
    return order;
  }

  private async assertOrderWritable(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<OrderScope> {
    const order = await this.loadOrderScope(orderId);
    if (
      !canEditOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
        permissionCodes: currentUser.permissionCodes,
        order,
      })
    ) {
      throw new ForbiddenException('One-time workforce update denied');
    }
    return order;
  }

  private async loadOrderScope(orderId: string): Promise<OrderScope> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        title: true,
        workCycle: true,
        createdByUserId: true,
        executionDate: true,
        executionStartDate: true,
        executionEndDate: true,
        assignments: {
          where: { isActive: true },
          select: {
            userId: true,
            assignmentRoleCode: true,
            isActive: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('One-time order not found');
    return order;
  }

  private getMoscowBusinessDate(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
  }

  private assertValidOperationDate(value: string): void {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Attendance date must be a valid YYYY-MM-DD date');
    }
  }
}
