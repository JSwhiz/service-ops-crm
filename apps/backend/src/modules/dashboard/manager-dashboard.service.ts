import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ObjectResponseDto } from '../objects/dto/object-response.dto';
import { ObjectsService } from '../objects/objects.service';
import { OneTimeOrdersService } from '../one-time-orders/one-time-orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskListResponseDto, TaskResponseDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

type ScopeMode = 'regular' | 'one_time' | 'hybrid' | 'empty';
type ManagerIssue =
  | 'object_no_employees'
  | 'object_attendance_missing'
  | 'object_daily_report_missing'
  | 'order_no_employees'
  | 'order_attendance_missing'
  | 'order_daily_report_missing';

export interface ManagerDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  scope: { mode: ScopeMode; regularAssignments: number; oneTimeAssignments: number };
  today: {
    regularObjects: number;
    oneTimeOrders: number;
    employeesOnRegularObjects: number;
    regularAttendanceMissing: number;
    oneTimeAttendanceMissing: number;
    myTasksToday: number;
  };
  attention: {
    total: number;
    items: Array<{
      id: string;
      kind: 'scope_issue' | 'task';
      issueCode?: ManagerIssue;
      entityId?: string;
      badge: string;
      tone: 'danger' | 'warning' | 'neutral';
      title: string;
      subtitle: string;
      meta: string;
      taskId?: string;
    }>;
  };
  objects: {
    total: number;
    items: Array<{
      id: string;
      name: string;
      address: string;
      employeeCount: number;
      issues: ManagerIssue[];
    }>;
  };
  orders: {
    total: number;
    today: number;
    items: Array<{
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      executionStartDate: string | null;
      executionEndDate: string | null;
      employeeCount: number;
      issues: ManagerIssue[];
    }>;
  };
  tasks: { totalRelevant: number; items: TaskResponseDto[] };
}

const MANAGER_ROLES = new Set(['manager', 'senior_manager', 'operation_manager']);
const PREVIEW_LIMIT = 5;

function roleCodes(user: CurrentAuthUser): string[] {
  return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
}

function clock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const value = (type: string): string => parts.find((item) => item.type === type)?.value ?? '0';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
    dayStartUtc: new Date(Date.UTC(year, month - 1, day, -3, 0, 0)),
  };
}

function dateKey(value: string | null | undefined): string | null {
  return value?.slice(0, 10) ?? null;
}

function orderRunsToday(
  order: { executionStartDate: string | null; executionEndDate: string | null },
  today: string,
): boolean {
  const start = dateKey(order.executionStartDate);
  if (!start) return false;
  const end = dateKey(order.executionEndDate) ?? start;
  return start <= today && end >= today;
}

function isMine(task: TaskResponseDto, userId: string): boolean {
  return Boolean(task.myAssignment || task.assignees.some((item) => item.id === userId && item.isActive));
}

@Injectable()
export class ManagerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectsService: ObjectsService,
    private readonly tasksService: TasksService,
    private readonly oneTimeOrdersService: OneTimeOrdersService,
  ) {}

  async getDashboard(user: CurrentAuthUser): Promise<ManagerDashboardResponse> {
    if (!roleCodes(user).some((role) => MANAGER_ROLES.has(role))) {
      throw new ForbiddenException('Manager dashboard is not available for this role');
    }

    const now = clock();
    const [regularAssignments, oneTimeAssignments, objectsResult, tasksResult, ordersResult] = await Promise.all([
      this.prisma.objectAssignment.count({ where: { userId: user.id, isActive: true } }),
      this.prisma.oneTimeOrderAssignment.count({
        where: { userId: user.id, assignmentRoleCode: 'one_time_manager', isActive: true },
      }),
      this.objectsService.listObjects(user, { status: 'active' }),
      this.tasksService.listTasks(user, { page: 1, limit: 100, sortBy: 'dueAt', sortDirection: 'asc' }),
      this.oneTimeOrdersService.listOrders(user, {
        page: 1,
        limit: 100,
        managerUserId: user.id,
        sortBy: 'executionStartDate',
        sortDirection: 'asc',
      }),
    ]);

    const objects: ObjectResponseDto[] = Array.isArray(objectsResult) ? objectsResult : objectsResult.items;
    const tasks = Array.isArray(tasksResult) ? tasksResult : (tasksResult as TaskListResponseDto).items;
    const openOrders = ordersResult.items.filter((order) => !['completed', 'cancelled'].includes(order.status));
    const todayOrders = openOrders.filter((order) => orderRunsToday(order, now.date));
    const [objectSignals, orderSignals] = await Promise.all([
      this.loadObjectSignals(objects, now),
      this.loadOrderSignals(todayOrders.map((order) => order.id), now),
    ]);

    const mappedObjects = objects.map((object) => {
      const signal = objectSignals.get(object.id);
      const issues: ManagerIssue[] = [];
      if (object.employees.length === 0) issues.push('object_no_employees');
      if (signal?.attendanceMissing) issues.push('object_attendance_missing');
      if (signal?.dailyReportMissing) issues.push('object_daily_report_missing');
      return { id: object.id, name: object.name, address: object.address, employeeCount: object.employees.length, issues };
    });

    const mappedOrders = openOrders.map((order) => {
      const signal = orderSignals.get(order.id);
      const issues: ManagerIssue[] = [];
      if (signal?.noEmployees) issues.push('order_no_employees');
      if (signal?.attendanceMissing) issues.push('order_attendance_missing');
      if (signal?.dailyReportMissing) issues.push('order_daily_report_missing');
      return {
        id: order.id,
        title: order.title,
        status: order.status,
        executionAddress: order.executionAddress,
        executionStartDate: order.executionStartDate,
        executionEndDate: order.executionEndDate,
        employeeCount: signal?.employeeCount ?? 0,
        issues,
      };
    });

    const relevantTasks = [...tasks]
      .filter((task) => !['completed', 'cancelled'].includes(task.status))
      .filter((task) => isMine(task, user.id) || task.isOverdue)
      .sort((a, b) => {
        const rank = (task: TaskResponseDto): number => {
          if (isMine(task, user.id) && task.isOverdue) return 0;
          if (isMine(task, user.id) && dateKey(task.dueAt) === now.date) return 1;
          if (isMine(task, user.id) && task.dueAt) return 2;
          if (isMine(task, user.id)) return 3;
          return 4;
        };
        return rank(a) - rank(b) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
      });

    const attention: ManagerDashboardResponse['attention']['items'] = [];
    for (const item of [...mappedObjects, ...mappedOrders]) {
      for (const issue of item.issues) {
        const isOrder = issue.startsWith('order_');
        attention.push({
          id: `${issue}-${item.id}`,
          kind: 'scope_issue',
          issueCode: issue,
          entityId: item.id,
          badge: issue.includes('attendance') ? 'Отметка' : issue.includes('report') ? 'Отчёт' : 'Люди',
          tone: 'warning',
          title: issue.includes('attendance') ? 'Нет отметки присутствия' : issue.includes('report') ? 'Нет дневного отчёта' : 'Нет сотрудников',
          subtitle: 'name' in item ? item.name : item.title,
          meta: isOrder ? 'Разовый заказ' : 'Объект',
        });
      }
    }
    for (const task of relevantTasks.filter((item) => item.isOverdue)) {
      attention.push({
        id: `task-${task.id}`,
        kind: 'task',
        taskId: task.id,
        badge: 'Просрочено',
        tone: 'danger',
        title: task.title,
        subtitle: task.targetName || 'Без привязки',
        meta: 'Задача',
      });
    }

    const scopeMode: ScopeMode = regularAssignments > 0 && oneTimeAssignments > 0
      ? 'hybrid'
      : regularAssignments > 0
        ? 'regular'
        : oneTimeAssignments > 0
          ? 'one_time'
          : 'empty';
    const uniqueEmployees = new Set(objects.flatMap((object) => object.employees.map((employee) => employee.id)));

    return {
      generatedAt: new Date().toISOString(),
      timeZone: 'Europe/Moscow',
      scope: { mode: scopeMode, regularAssignments, oneTimeAssignments },
      today: {
        regularObjects: objects.length,
        oneTimeOrders: todayOrders.length,
        employeesOnRegularObjects: uniqueEmployees.size,
        regularAttendanceMissing: mappedObjects.filter((item) => item.issues.includes('object_attendance_missing')).length,
        oneTimeAttendanceMissing: mappedOrders.filter((item) => item.issues.includes('order_attendance_missing')).length,
        myTasksToday: relevantTasks.filter((task) => isMine(task, user.id) && dateKey(task.dueAt) === now.date).length,
      },
      attention: { total: attention.length, items: attention.slice(0, PREVIEW_LIMIT) },
      objects: {
        total: mappedObjects.length,
        items: [...mappedObjects.filter((item) => item.issues.length), ...mappedObjects.filter((item) => !item.issues.length)].slice(0, PREVIEW_LIMIT),
      },
      orders: {
        total: mappedOrders.length,
        today: todayOrders.length,
        items: [...mappedOrders.filter((item) => item.issues.length), ...mappedOrders.filter((item) => !item.issues.length)].slice(0, PREVIEW_LIMIT),
      },
      tasks: { totalRelevant: relevantTasks.length, items: relevantTasks.slice(0, PREVIEW_LIMIT) },
    };
  }

  private async loadObjectSignals(
    objects: ObjectResponseDto[],
    now: ReturnType<typeof clock>,
  ): Promise<Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>> {
    const result = new Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>();
    const ids = objects.map((object) => object.id);
    if (!ids.length) return result;
    const attendanceRequired = now.minutes >= 8 * 60 + 30;
    const reportRequired = now.minutes >= 17 * 60;
    const nextDayStartUtc = new Date(now.dayStartUtc.getTime() + 86_400_000);
    const [submissions, reports] = await Promise.all([
      attendanceRequired
        ? this.prisma.objectAuditLog.findMany({
            where: { objectId: { in: ids }, actionCode: 'attendance.submitted', createdAt: { gte: now.dayStartUtc, lt: nextDayStartUtc } },
            select: { objectId: true },
            distinct: ['objectId'],
          })
        : Promise.resolve([]),
      reportRequired
        ? this.prisma.objectDailyReport.findMany({
            where: { objectId: { in: ids }, reportDate: new Date(`${now.date}T00:00:00.000Z`) },
            select: { objectId: true },
          })
        : Promise.resolve([]),
    ]);
    const submitted = new Set(submissions.map((item) => item.objectId));
    const reported = new Set(reports.map((item) => item.objectId));
    for (const object of objects) {
      result.set(object.id, {
        attendanceMissing: attendanceRequired && !submitted.has(object.id),
        dailyReportMissing: reportRequired && !reported.has(object.id),
      });
    }
    return result;
  }

  private async loadOrderSignals(
    orderIds: string[],
    now: ReturnType<typeof clock>,
  ): Promise<Map<string, { employeeCount: number; noEmployees: boolean; attendanceMissing: boolean; dailyReportMissing: boolean }>> {
    const result = new Map<string, { employeeCount: number; noEmployees: boolean; attendanceMissing: boolean; dailyReportMissing: boolean }>();
    if (!orderIds.length) return result;
    const cycles = await this.prisma.oneTimeOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, workCycle: true },
    });
    const attendanceRequired = now.minutes >= 8 * 60 + 30;
    const reportRequired = now.minutes >= 17 * 60;
    const staffing = await this.prisma.$queryRaw<Array<{ oneTimeOrderId: string; workCycle: number; count: bigint }>>(Prisma.sql`
      SELECT "oneTimeOrderId", "workCycle", COUNT(*)::bigint AS "count"
      FROM "one_time_order_employee_assignments"
      WHERE "oneTimeOrderId" IN (${Prisma.join(orderIds)}) AND "isActive" = true
      GROUP BY "oneTimeOrderId", "workCycle"
    `);
    const submissions = attendanceRequired
      ? await this.prisma.$queryRaw<Array<{ oneTimeOrderId: string; workCycle: number }>>(Prisma.sql`
          SELECT "oneTimeOrderId", "workCycle"
          FROM "one_time_order_attendance_submissions"
          WHERE "oneTimeOrderId" IN (${Prisma.join(orderIds)})
            AND "operationDate" = CAST(${now.date} AS DATE)
        `)
      : [];
    const reports = reportRequired
      ? await this.prisma.oneTimeOrderDailyReport.findMany({
          where: { oneTimeOrderId: { in: orderIds }, reportDate: new Date(`${now.date}T00:00:00.000Z`) },
          select: { oneTimeOrderId: true },
        })
      : [];
    const staffingMap = new Map(staffing.map((item) => [`${item.oneTimeOrderId}:${item.workCycle}`, Number(item.count)]));
    const submitted = new Set(submissions.map((item) => `${item.oneTimeOrderId}:${item.workCycle}`));
    const reported = new Set(reports.map((item) => item.oneTimeOrderId));
    for (const order of cycles) {
      const key = `${order.id}:${order.workCycle}`;
      const employeeCount = staffingMap.get(key) ?? 0;
      result.set(order.id, {
        employeeCount,
        noEmployees: employeeCount === 0,
        attendanceMissing: attendanceRequired && !submitted.has(key),
        dailyReportMissing: reportRequired && !reported.has(order.id),
      });
    }
    return result;
  }
}
