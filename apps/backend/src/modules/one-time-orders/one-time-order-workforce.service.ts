import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { AddOneTimeOrderEmployeeDto } from './dto/one-time-order-workforce.dto';
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
  }>;
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
    const order = await this.assertOrderVisible(currentUser, orderId);
    const operationDate = this.getMoscowBusinessDate();
    return this.loadAttendance(order, operationDate);
  }

  async submitTodayAttendance(
    currentUser: CurrentAuthUser,
    orderId: string,
    employeeIds: string[],
  ): Promise<OneTimeOrderAttendanceResponse> {
    const order = await this.assertOrderWritable(currentUser, orderId);
    const operationDate = this.getMoscowBusinessDate();
    const activeEmployees = await this.prisma.$queryRaw<
      Array<{ employeeId: string; baseDailyRate: number | null }>
    >`
      SELECT assignment."employeeId", employee."baseDailyRate"
      FROM "one_time_order_employee_assignments" assignment
      JOIN "employees" employee ON employee."id" = assignment."employeeId"
      WHERE assignment."oneTimeOrderId" = ${order.id}
        AND assignment."workCycle" = ${order.workCycle}
        AND assignment."isActive" = true
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
            "rateSnapshot" = EXCLUDED."rateSnapshot",
            "automaticValue" = EXCLUDED."automaticValue",
            "finalValue" = CASE
              WHEN "one_time_order_timesheet_day_entries"."manualOverride" = true
                THEN "one_time_order_timesheet_day_entries"."finalValue"
              ELSE EXCLUDED."finalValue"
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
    });

    await this.auditService.writeAuditEvent({
      entityType: 'one_time_order',
      entityId: order.id,
      actorUserId: currentUser.id,
      action: 'one_time_order.attendance.submitted',
      newValues: {
        workCycle: order.workCycle,
        operationDate,
        presentEmployeeIds: employeeIds,
      },
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

    const rows = new Map<string, OneTimeOrderTimesheetResponse['rows'][number]>();
    for (const entry of entries) {
      let row = rows.get(entry.employeeId);
      if (!row) {
        row = {
          employeeId: entry.employeeId,
          fullName: entry.fullName,
          days: [],
          total: 0,
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

    return {
      oneTimeOrderId: order.id,
      workCycle,
      month: normalizedMonth,
      rows: Array.from(rows.values()),
    };
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
        AND assignment."isActive" = true
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
}
