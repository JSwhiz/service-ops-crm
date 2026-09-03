import { ForbiddenException, Injectable } from '@nestjs/common';

import { AccountabilityService } from '../accountability/accountability.service';
import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import { CandidatesService } from '../candidates/candidates.service';
import { EmployeesService } from '../employees/employees.service';
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

type ObjectIssueCode =
  | 'no_responsible'
  | 'no_employees'
  | 'attendance_missing'
  | 'daily_report_missing';

type AttentionTone = 'danger' | 'warning' | 'neutral';

export interface LeadershipAttentionItem {
  id: string;
  kind: 'object_issue' | 'task' | 'approval';
  badge: string;
  tone: AttentionTone;
  title: string;
  subtitle: string;
  meta: string;
  objectIssueCode?: ObjectIssueCode;
  taskId?: string;
  approval?: {
    id: string;
    sourceEntityType: string;
    sourceEntityId: string;
  };
}

export interface LeadershipDashboardObjectPreview {
  id: string;
  name: string;
  address: string;
  responsible: { id: string; login: string; fullName: string } | null;
  employeeCount: number;
  issues: ObjectIssueCode[];
}

export interface LeadershipDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  attention: {
    total: number;
    items: LeadershipAttentionItem[];
    objectIssues: {
      noResponsible: number;
      noEmployees: number;
      attendanceMissing: number;
      dailyReportMissing: number;
    };
    pendingApprovals: number;
    overdueTasks: number;
    awaitingConfirmationTasks: number;
  };
  today: {
    activeObjects: number;
    employeesOnObjects: number;
    objectsWithoutAttendanceMark: number;
    oneTimeOrders: number;
    decisionsRequired: number;
  };
  tasks: {
    totalRelevant: number;
    items: TaskResponseDto[];
  };
  money: {
    available: boolean;
    submittedExpenses: number;
    closingRequestedAccounts: number;
    oneTimeOrderReceipts: { count: number; amount: number };
  };
  objects: {
    active: number;
    problematic: number;
    items: LeadershipDashboardObjectPreview[];
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
  people: {
    available: boolean;
    activeEmployees: number;
    employeesWithoutActiveObject: number;
    overdueCandidateSla: number | null;
    userAbsencesAvailable: boolean;
    userAbsencesToday: number | null;
  };
}

const LEADERSHIP_DASHBOARD_ROLE_CODES = new Set([
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  'deputy_director',
]);
const PREVIEW_LIMIT = 5;
const EXPANDED_LIMIT = 14;

function getRoleCodes(user: CurrentAuthUser): string[] {
  return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
}

function getMoscowClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type: string): string =>
    parts.find((item) => item.type === type)?.value ?? '0';
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

function taskIsMine(task: TaskResponseDto, userId: string): boolean {
  return Boolean(
    task.myAssignment ||
      task.assignees.some((assignee) => assignee.id === userId && assignee.isActive),
  );
}

function rankTasks(items: TaskResponseDto[], userId: string, today: string): TaskResponseDto[] {
  return items
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .filter((task) => taskIsMine(task, userId) || task.isOverdue)
    .sort((a, b) => {
      const rank = (task: TaskResponseDto): number => {
        const mine = taskIsMine(task, userId);
        if (mine && task.isOverdue) return 0;
        if (mine && dateKey(task.dueAt) === today) return 1;
        if (mine && dateKey(task.createdAt) === today) return 2;
        if (mine && task.dueAt) return 3;
        if (mine) return 4;
        if (task.isOverdue) return 5;
        return 6;
      };
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue !== bDue
        ? aDue - bDue
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function formatShortDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function taskMeta(task: TaskResponseDto, today: string): string {
  if (task.isOverdue) return task.dueAt ? `до ${formatShortDate(task.dueAt)}` : 'Просрочено';
  if (dateKey(task.dueAt) === today) return 'Сегодня';
  return formatShortDate(task.dueAt);
}

function approvalAttentionItem(item: ApprovalRequestResponseDto): LeadershipAttentionItem {
  return {
    id: `approval-${item.id}`,
    kind: 'approval',
    badge: 'Согласование',
    tone: 'warning',
    title: item.summary.title,
    subtitle: item.summary.subtitle ?? 'Ожидает решения',
    meta: formatShortDate(item.createdAt),
    approval: {
      id: item.id,
      sourceEntityType: item.sourceEntityType,
      sourceEntityId: item.sourceEntityId,
    },
  };
}

@Injectable()
export class LeadershipDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectsService: ObjectsService,
    private readonly tasksService: TasksService,
    private readonly oneTimeOrdersService: OneTimeOrdersService,
    private readonly approvalsService: ApprovalsService,
    private readonly accountabilityService: AccountabilityService,
    private readonly employeesService: EmployeesService,
    private readonly candidatesService: CandidatesService,
  ) {}

  async getDashboard(
    user: CurrentAuthUser,
    expanded = false,
  ): Promise<LeadershipDashboardResponse> {
    if (!getRoleCodes(user).some((code) => LEADERSHIP_DASHBOARD_ROLE_CODES.has(code))) {
      throw new ForbiddenException('Leadership dashboard is not available for this role');
    }

    const clock = getMoscowClock();
    const [objectsResult, tasksResult, ordersResult, approvals] = await Promise.all([
      this.objectsService.listObjects(user, { status: 'active' }),
      this.tasksService.listTasks(user, {
        page: 1,
        limit: 100,
        sortBy: 'dueAt',
        sortDirection: 'asc',
      }),
      this.oneTimeOrdersService.listOrders(user, {
        page: 1,
        limit: 100,
        sortBy: 'executionStartDate',
        sortDirection: 'asc',
      }),
      this.approvalsService.listRequests(user, { status: 'pending' }),
    ]);

    const activeObjects: ObjectResponseDto[] = Array.isArray(objectsResult)
      ? objectsResult
      : objectsResult.items;
    const taskItems = Array.isArray(tasksResult)
      ? tasksResult
      : (tasksResult as TaskListResponseDto).items;
    const rankedTasks = rankTasks(taskItems, user.id, clock.date);
    const accessibleOrders = ordersResult.items;
    const signalMap = await this.loadObjectSignals(activeObjects, clock);
    const mappedObjects = activeObjects.map((object) =>
      this.mapObjectPreview(object, signalMap.get(object.id)),
    );
    const problemObjects = mappedObjects.filter((object) => object.issues.length > 0);
    const objectPreview = [
      ...problemObjects,
      ...mappedObjects.filter((object) => object.issues.length === 0),
    ].slice(0, 4);

    const uniqueEmployees = new Set(
      activeObjects.flatMap((object) => object.employees.map((employee) => employee.id)),
    );
    const todayOrders = accessibleOrders.filter(
      (order) =>
        dateKey(order.executionStartDate) === clock.date &&
        !['completed', 'cancelled'].includes(order.status),
    );
    const rankedOrders = [...accessibleOrders]
      .filter((order) => !['completed', 'cancelled'].includes(order.status))
      .sort((a, b) => {
        const aDate = dateKey(a.executionStartDate);
        const bDate = dateKey(b.executionStartDate);
        const group = (date: string | null): number =>
          date === null ? 3 : date < clock.date ? 0 : date === clock.date ? 1 : 2;
        const byGroup = group(aDate) - group(bDate);
        return byGroup !== 0
          ? byGroup
          : (aDate ?? '9999-12-31').localeCompare(bDate ?? '9999-12-31');
      })
      .slice(0, 3);

    const [money, people] = await Promise.all([
      this.loadMoney(user),
      this.loadPeople(user),
    ]);

    const countIssue = (code: ObjectIssueCode): number =>
      problemObjects.filter((object) => object.issues.includes(code)).length;
    const noResponsible = countIssue('no_responsible');
    const noEmployees = countIssue('no_employees');
    const attendanceMissing = countIssue('attendance_missing');
    const dailyReportMissing = countIssue('daily_report_missing');
    const overdueTasks = taskItems.filter(
      (task) => task.isOverdue && task.status !== 'completed',
    );
    const confirmationTasks = taskItems.filter(
      (task) => task.status === 'awaiting_confirmation' && !task.isOverdue,
    );

    const attentionItems = this.buildAttentionItems({
      noResponsible,
      noEmployees,
      attendanceMissing,
      dailyReportMissing,
      overdueTasks,
      confirmationTasks,
      approvals,
      today: clock.date,
    });
    const itemLimit = expanded ? EXPANDED_LIMIT : PREVIEW_LIMIT;

    return {
      generatedAt: new Date().toISOString(),
      timeZone: 'Europe/Moscow',
      attention: {
        total: attentionItems.length,
        items: attentionItems.slice(0, itemLimit),
        objectIssues: {
          noResponsible,
          noEmployees,
          attendanceMissing,
          dailyReportMissing,
        },
        pendingApprovals: approvals.length,
        overdueTasks: overdueTasks.length,
        awaitingConfirmationTasks: confirmationTasks.length,
      },
      today: {
        activeObjects: activeObjects.length,
        employeesOnObjects: uniqueEmployees.size,
        objectsWithoutAttendanceMark: attendanceMissing,
        oneTimeOrders: todayOrders.length,
        decisionsRequired: approvals.length,
      },
      tasks: {
        totalRelevant: rankedTasks.length,
        items: rankedTasks.slice(0, itemLimit),
      },
      money,
      objects: {
        active: activeObjects.length,
        problematic: problemObjects.length,
        items: objectPreview,
      },
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
      people,
    };
  }

  private buildAttentionItems(params: {
    noResponsible: number;
    noEmployees: number;
    attendanceMissing: number;
    dailyReportMissing: number;
    overdueTasks: TaskResponseDto[];
    confirmationTasks: TaskResponseDto[];
    approvals: ApprovalRequestResponseDto[];
    today: string;
  }): LeadershipAttentionItem[] {
    const rows: LeadershipAttentionItem[] = [];
    const addObjectIssue = (
      count: number,
      code: ObjectIssueCode,
      badge: string,
      title: string,
      subtitle: string,
      meta: string,
    ): void => {
      if (!count) return;
      rows.push({
        id: `object-${code}`,
        kind: 'object_issue',
        objectIssueCode: code,
        badge,
        tone: 'warning',
        title,
        subtitle,
        meta,
      });
    };

    addObjectIssue(
      params.attendanceMissing,
      'attendance_missing',
      'Объекты',
      'Нет отметки присутствия',
      `${params.attendanceMissing} объектов без отправленной отметки`,
      'Сегодня',
    );
    addObjectIssue(
      params.dailyReportMissing,
      'daily_report_missing',
      'Отчёт',
      'Нет дневного отчёта',
      `${params.dailyReportMissing} объектов без отчёта после 17:00`,
      'Сегодня',
    );
    addObjectIssue(
      params.noResponsible,
      'no_responsible',
      'Объекты',
      'Нет ответственного',
      `${params.noResponsible} активных объектов без ответственного`,
      'Сейчас',
    );
    addObjectIssue(
      params.noEmployees,
      'no_employees',
      'Объекты',
      'Нет сотрудников',
      `${params.noEmployees} активных объектов без сотрудников`,
      'Сейчас',
    );

    rows.push(
      ...params.overdueTasks.map((task) => ({
        id: `task-overdue-${task.id}`,
        kind: 'task' as const,
        taskId: task.id,
        badge: 'Просрочено',
        tone: 'danger' as const,
        title: task.title,
        subtitle: task.targetName || 'Без привязки',
        meta: taskMeta(task, params.today),
      })),
      ...params.approvals.map(approvalAttentionItem),
      ...params.confirmationTasks.map((task) => ({
        id: `task-confirm-${task.id}`,
        kind: 'task' as const,
        taskId: task.id,
        badge: 'Подтверждение',
        tone: 'neutral' as const,
        title: task.title,
        subtitle: task.targetName || 'Без привязки',
        meta: taskMeta(task, params.today),
      })),
    );

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = item.taskId ? `task:${item.taskId}` : item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async loadObjectSignals(
    objects: ObjectResponseDto[],
    clock: ReturnType<typeof getMoscowClock>,
  ): Promise<Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>> {
    const result = new Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>();
    const ids = objects.map((object) => object.id);
    if (!ids.length) return result;

    const attendanceRequired = clock.minutes >= 8 * 60 + 30;
    const reportRequired = clock.minutes >= 17 * 60;
    const [submissions, reports] = await Promise.all([
      attendanceRequired
        ? this.prisma.objectAuditLog.findMany({
            where: {
              objectId: { in: ids },
              actionCode: 'attendance.submitted',
              createdAt: { gte: clock.dayStartUtc, lt: clock.nextDayStartUtc },
            },
            select: { objectId: true },
            distinct: ['objectId'],
          })
        : Promise.resolve([]),
      reportRequired
        ? this.prisma.objectDailyReport.findMany({
            where: {
              objectId: { in: ids },
              reportDate: new Date(`${clock.date}T00:00:00.000Z`),
            },
            select: { objectId: true },
          })
        : Promise.resolve([]),
    ]);
    const submittedIds = new Set(submissions.map((item) => item.objectId));
    const reportIds = new Set(reports.map((item) => item.objectId));
    for (const object of objects) {
      result.set(object.id, {
        attendanceMissing: attendanceRequired && !submittedIds.has(object.id),
        dailyReportMissing: reportRequired && !reportIds.has(object.id),
      });
    }
    return result;
  }

  private mapObjectPreview(
    object: ObjectResponseDto,
    signal: { attendanceMissing: boolean; dailyReportMissing: boolean } | undefined,
  ): LeadershipDashboardObjectPreview {
    const issues: ObjectIssueCode[] = [];
    if (!object.responsible) issues.push('no_responsible');
    if (!object.employees.length) issues.push('no_employees');
    if (signal?.attendanceMissing) issues.push('attendance_missing');
    if (signal?.dailyReportMissing) issues.push('daily_report_missing');
    return {
      id: object.id,
      name: object.name,
      address: object.address,
      responsible: object.responsible,
      employeeCount: object.employees.length,
      issues,
    };
  }

  private async loadMoney(
    user: CurrentAuthUser,
  ): Promise<LeadershipDashboardResponse['money']> {
    try {
      const accounts = await this.accountabilityService.listAccounts(user);
      const accountIds = accounts.map((account) => account.accountId);
      const receiptAggregate = accountIds.length
        ? await this.prisma.accountabilityFunding.aggregate({
            where: {
              accountabilityAccountId: { in: accountIds },
              fundingType: 'one_time_order_receipt',
              entryDirection: 'credit',
            },
            _count: { _all: true },
            _sum: { amount: true },
          })
        : null;
      return {
        available: true,
        submittedExpenses: accounts.reduce(
          (sum, account) => sum + account.summary.submittedExpensesCount,
          0,
        ),
        closingRequestedAccounts: accounts.filter(
          (account) => account.status === 'closing_requested',
        ).length,
        oneTimeOrderReceipts: {
          count: receiptAggregate?._count._all ?? 0,
          amount: Number(receiptAggregate?._sum.amount ?? 0),
        },
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return {
          available: false,
          submittedExpenses: 0,
          closingRequestedAccounts: 0,
          oneTimeOrderReceipts: { count: 0, amount: 0 },
        };
      }
      throw error;
    }
  }

  private async loadPeople(
    user: CurrentAuthUser,
  ): Promise<LeadershipDashboardResponse['people']> {
    try {
      const employeeBase = {
        archiveState: 'active' as const,
        sortBy: 'fullName' as const,
        sortOrder: 'asc' as const,
        page: 1,
        limit: 1,
      };
      const [active, unassigned, candidates] = await Promise.all([
        this.employeesService.listEmployees(user, employeeBase),
        this.employeesService.listEmployees(user, {
          ...employeeBase,
          hasActiveObjectAssignment: false,
        }),
        this.candidatesService
          .list(user, {
            archiveState: 'active',
            slaState: 'overdue',
            page: 1,
            limit: 1,
            sort: 'updatedAt',
            sortDirection: 'desc',
          })
          .catch(() => null),
      ]);
      return {
        available: true,
        activeEmployees: active.total,
        employeesWithoutActiveObject: unassigned.total,
        overdueCandidateSla: candidates?.total ?? null,
        userAbsencesAvailable: false,
        userAbsencesToday: null,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return {
          available: false,
          activeEmployees: 0,
          employeesWithoutActiveObject: 0,
          overdueCandidateSla: null,
          userAbsencesAvailable: false,
          userAbsencesToday: null,
        };
      }
      throw error;
    }
  }
}
