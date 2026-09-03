import { ForbiddenException, Injectable } from '@nestjs/common';

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

type OperationObjectIssue = 'no_employees' | 'attendance_missing' | 'daily_report_missing';
type AttentionTone = 'danger' | 'warning' | 'neutral';

export interface OperationManagerAttentionItem {
  id: string;
  kind: 'object_issue' | 'task';
  badge: string;
  tone: AttentionTone;
  title: string;
  subtitle: string;
  meta: string;
  objectIssueCode?: OperationObjectIssue;
  taskId?: string;
}

export interface OperationManagerDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  attention: {
    total: number;
    items: OperationManagerAttentionItem[];
    objectIssues: {
      noEmployees: number;
      attendanceMissing: number;
      dailyReportMissing: number;
    };
    overdueTasks: number;
  };
  today: {
    activeObjects: number;
    employeesOnObjects: number;
    attendanceMissing: number;
    dailyReportMissing: number;
    myTasksToday: number;
  };
  objects: {
    active: number;
    problematic: number;
    items: Array<{
      id: string;
      name: string;
      address: string;
      employeeCount: number;
      issues: OperationObjectIssue[];
    }>;
  };
  tasks: {
    totalRelevant: number;
    items: TaskResponseDto[];
  };
  orders: {
    totalAccessible: number;
    items: Array<{
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      executionStartDate: string | null;
      linkedObject: { id: string; name: string } | null;
    }>;
  };
}

const PREVIEW_LIMIT = 5;
const OPERATION_MANAGER_ROLE = 'operation_manager';

function roleCodes(user: CurrentAuthUser): string[] {
  return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
}

function clock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const value = (type: string): string => parts.find((item) => item.type === type)?.value ?? '0';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const dayStartUtc = new Date(Date.UTC(year, month - 1, day, -3, 0, 0));
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: hour * 60 + minute,
    dayStartUtc,
    nextDayStartUtc: new Date(dayStartUtc.getTime() + 86_400_000),
  };
}

function dateKey(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function isMine(task: TaskResponseDto, userId: string): boolean {
  return Boolean(task.myAssignment || task.assignees.some((item) => item.id === userId && item.isActive));
}

function shortDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(value));
}

@Injectable()
export class OperationManagerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectsService: ObjectsService,
    private readonly tasksService: TasksService,
    private readonly oneTimeOrdersService: OneTimeOrdersService,
  ) {}

  async getDashboard(user: CurrentAuthUser): Promise<OperationManagerDashboardResponse> {
    if (!roleCodes(user).includes(OPERATION_MANAGER_ROLE)) {
      throw new ForbiddenException('Operation manager dashboard is not available for this role');
    }

    const now = clock();
    const [objectsResult, tasksResult, ordersResult] = await Promise.all([
      this.objectsService.listObjects(user, { status: 'active' }),
      this.tasksService.listTasks(user, { page: 1, limit: 100, sortBy: 'dueAt', sortDirection: 'asc' }),
      this.oneTimeOrdersService.listOrders(user, { page: 1, limit: 60, sortBy: 'executionStartDate', sortDirection: 'asc' }),
    ]);

    const objects: ObjectResponseDto[] = Array.isArray(objectsResult) ? objectsResult : objectsResult.items;
    const tasks = Array.isArray(tasksResult) ? tasksResult : (tasksResult as TaskListResponseDto).items;
    const signals = await this.loadSignals(objects, now);
    const mappedObjects = objects.map((object) => {
      const signal = signals.get(object.id);
      const issues: OperationObjectIssue[] = [];
      if (!object.employees.length) issues.push('no_employees');
      if (signal?.attendanceMissing) issues.push('attendance_missing');
      if (signal?.dailyReportMissing) issues.push('daily_report_missing');
      return { id: object.id, name: object.name, address: object.address, employeeCount: object.employees.length, issues };
    });
    const problemObjects = mappedObjects.filter((object) => object.issues.length > 0);
    const objectItems = [...problemObjects, ...mappedObjects.filter((object) => object.issues.length === 0)].slice(0, PREVIEW_LIMIT);
    const uniqueEmployees = new Set(objects.flatMap((object) => object.employees.map((employee) => employee.id)));

    const relevantTasks = [...tasks]
      .filter((task) => !['completed', 'cancelled'].includes(task.status))
      .filter((task) => isMine(task, user.id) || task.isOverdue)
      .sort((a, b) => {
        const rank = (task: TaskResponseDto): number => {
          if (isMine(task, user.id) && task.isOverdue) return 0;
          if (isMine(task, user.id) && dateKey(task.dueAt) === now.date) return 1;
          if (isMine(task, user.id) && task.dueAt) return 2;
          if (isMine(task, user.id)) return 3;
          return task.isOverdue ? 4 : 5;
        };
        const delta = rank(a) - rank(b);
        if (delta) return delta;
        return (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
      });

    const noEmployees = problemObjects.filter((object) => object.issues.includes('no_employees')).length;
    const attendanceMissing = problemObjects.filter((object) => object.issues.includes('attendance_missing')).length;
    const dailyReportMissing = problemObjects.filter((object) => object.issues.includes('daily_report_missing')).length;
    const overdueTasks = tasks.filter((task) => task.isOverdue && task.status !== 'completed');

    const attention: OperationManagerAttentionItem[] = [];
    const addIssue = (count: number, code: OperationObjectIssue, badge: string, title: string, subtitle: string): void => {
      if (!count) return;
      attention.push({ id: `object-${code}`, kind: 'object_issue', objectIssueCode: code, badge, tone: 'warning', title, subtitle, meta: 'Сегодня' });
    };
    addIssue(attendanceMissing, 'attendance_missing', 'Объекты', 'Нет отметки присутствия', `${attendanceMissing} объектов без отправленной отметки`);
    addIssue(dailyReportMissing, 'daily_report_missing', 'Отчёт', 'Нет дневного отчёта', `${dailyReportMissing} объектов без отчёта после 17:00`);
    addIssue(noEmployees, 'no_employees', 'Объекты', 'Нет сотрудников', `${noEmployees} объектов без сотрудников`);
    attention.push(...overdueTasks.map((task) => ({
      id: `task-${task.id}`,
      kind: 'task' as const,
      taskId: task.id,
      badge: 'Просрочено',
      tone: 'danger' as const,
      title: task.title,
      subtitle: task.targetName || 'Без привязки',
      meta: task.dueAt ? `до ${shortDate(task.dueAt)}` : 'Просрочено',
    })));

    const rankedOrders = [...ordersResult.items]
      .filter((order) => !['completed', 'cancelled'].includes(order.status))
      .sort((a, b) => {
        const group = (value: string | null): number => {
          const key = dateKey(value);
          return key === null ? 3 : key < now.date ? 0 : key === now.date ? 1 : 2;
        };
        const delta = group(a.executionStartDate) - group(b.executionStartDate);
        return delta || (dateKey(a.executionStartDate) ?? '9999').localeCompare(dateKey(b.executionStartDate) ?? '9999');
      })
      .slice(0, 3);

    return {
      generatedAt: new Date().toISOString(),
      timeZone: 'Europe/Moscow',
      attention: {
        total: attention.length,
        items: attention.slice(0, PREVIEW_LIMIT),
        objectIssues: { noEmployees, attendanceMissing, dailyReportMissing },
        overdueTasks: overdueTasks.length,
      },
      today: {
        activeObjects: objects.length,
        employeesOnObjects: uniqueEmployees.size,
        attendanceMissing,
        dailyReportMissing,
        myTasksToday: tasks.filter((task) => isMine(task, user.id) && dateKey(task.dueAt) === now.date && !['completed', 'cancelled'].includes(task.status)).length,
      },
      objects: { active: objects.length, problematic: problemObjects.length, items: objectItems },
      tasks: { totalRelevant: relevantTasks.length, items: relevantTasks.slice(0, PREVIEW_LIMIT) },
      orders: {
        totalAccessible: ordersResult.total,
        items: rankedOrders.map((order) => ({
          id: order.id,
          title: order.title,
          status: order.status,
          executionAddress: order.executionAddress,
          executionStartDate: order.executionStartDate,
          linkedObject: order.linkedObject,
        })),
      },
    };
  }

  private async loadSignals(objects: ObjectResponseDto[], now: ReturnType<typeof clock>): Promise<Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>> {
    const result = new Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>();
    const ids = objects.map((object) => object.id);
    if (!ids.length) return result;
    const attendanceRequired = now.minutes >= 8 * 60 + 30;
    const reportRequired = now.minutes >= 17 * 60;
    const [submissions, reports] = await Promise.all([
      attendanceRequired ? this.prisma.objectAuditLog.findMany({
        where: { objectId: { in: ids }, actionCode: 'attendance.submitted', createdAt: { gte: now.dayStartUtc, lt: now.nextDayStartUtc } },
        select: { objectId: true }, distinct: ['objectId'],
      }) : Promise.resolve([]),
      reportRequired ? this.prisma.objectDailyReport.findMany({
        where: { objectId: { in: ids }, reportDate: new Date(`${now.date}T00:00:00.000Z`) }, select: { objectId: true },
      }) : Promise.resolve([]),
    ]);
    const submitted = new Set(submissions.map((item) => item.objectId));
    const reported = new Set(reports.map((item) => item.objectId));
    for (const object of objects) result.set(object.id, { attendanceMissing: attendanceRequired && !submitted.has(object.id), dailyReportMissing: reportRequired && !reported.has(object.id) });
    return result;
  }
}
