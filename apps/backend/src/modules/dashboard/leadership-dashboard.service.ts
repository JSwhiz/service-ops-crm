import { ForbiddenException, Injectable } from '@nestjs/common';

import { AccountabilityService } from '../accountability/accountability.service';
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

const LEADERSHIP_DASHBOARD_ROLE_CODES = new Set([
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  'deputy_director',
]);
const PREVIEW_LIMIT = 5;

export interface LeadershipDashboardObjectPreview {
  id: string;
  name: string;
  address: string;
  responsible: { id: string; login: string; fullName: string } | null;
  employeeCount: number;
  issues: Array<'no_responsible' | 'no_employees' | 'attendance_missing' | 'daily_report_missing'>;
}

export interface LeadershipDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  attention: {
    total: number;
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

function roleCodes(user: CurrentAuthUser): string[] {
  return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
}

function getMoscowClock(now = new Date()): {
  date: string;
  minutes: number;
  dayStartUtc: Date;
  nextDayStartUtc: Date;
} {
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
    nextDayStartUtc: new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000),
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
        const dueToday = dateKey(task.dueAt) === today;
        const createdToday = dateKey(task.createdAt) === today;
        if (mine && task.isOverdue) return 0;
        if (mine && dueToday) return 1;
        if (mine && createdToday) return 2;
        if (mine && task.dueAt) return 3;
        if (mine) return 4;
        if (task.isOverdue) return 5;
        return 6;
      };
      const rankDelta = rank(a) - rank(b);
      if (rankDelta !== 0) return rankDelta;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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

  async getDashboard(user: CurrentAuthUser): Promise<LeadershipDashboardResponse> {
    if (!roleCodes(user).some((code) => LEADERSHIP_DASHBOARD_ROLE_CODES.has(code))) {
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

    const activeObjects = Array.isArray(objectsResult)
      ? objectsResult
      : objectsResult.items;
    const taskItems = Array.isArray(tasksResult)
      ? tasksResult
      : (tasksResult as TaskListResponseDto).items;
    const rankedTasks = rankTasks(taskItems, user.id, clock.date);
    const accessibleOrders = ordersResult.items;

    const objectSignals = await this.loadObjectSignals(activeObjects, clock);
    const problemObjects = activeObjects
      .map((object) => this.mapObjectPreview(object, objectSignals.get(object.id)))
      .filter((object) => object.issues.length > 0);
    const normalObjects = activeObjects
      .map((object) => this.mapObjectPreview(object, objectSignals.get(object.id)))
      .filter((object) => object.issues.length === 0);
    const objectPreview = [...problemObjects, ...normalObjects].slice(0, 4);

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
        const delta = group(aDate) - group(bDate);
        if (delta !== 0) return delta;
        return (aDate ?? '9999-12-31').localeCompare(bDate ?? '9999-12-31');
      })
      .slice(0, 3);

    const [money, people] = await Promise.all([
      this.loadMoney(user),
      this.loadPeople(user),
    ]);

    const noResponsible = problemObjects.filter((item) => item.issues.includes('no_responsible')).length;
    const noEmployees = problemObjects.filter((item) => item.issues.includes('no_employees')).length;
    const attendanceMissing = problemObjects.filter((item) => item.issues.includes('attendance_missing')).length;
    const dailyReportMissing = problemObjects.filter((item) => item.issues.includes('daily_report_missing')).length;
    const overdueTasks = taskItems.filter((task) => task.isOverdue && task.status !== 'completed').length;
    const awaitingConfirmationTasks = taskItems.filter(
      (task) => task.status === 'awaiting_confirmation' && !task.isOverdue,
    ).length;
    const objectIssueKinds = Number(noResponsible > 0) + Number(noEmployees > 0) + Number(attendanceMissing > 0) + Number(dailyReportMissing > 0);
    const attentionTotal = objectIssueKinds + overdueTasks + approvals.length + awaitingConfirmationTasks;

    return {
      generatedAt: new Date().toISOString(),
      timeZone: 'Europe/Moscow',
      attention: {
        total: attentionTotal,
        objectIssues: {
          noResponsible,
          noEmployees,
          attendanceMissing,
          dailyReportMissing,
        },
        pendingApprovals: approvals.length,
        overdueTasks,
        awaitingConfirmationTasks,
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
        items: rankedTasks.slice(0, PREVIEW_LIMIT),
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

  private async loadObjectSignals(
    objects: ObjectResponseDto[],
    clock: ReturnType<typeof getMoscowClock>,
  ): Promise<Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>> {
    const result = new Map<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>();
    const ids = objects.map((object) => object.id);
    if (ids.length === 0) return result;

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
    const issues: LeadershipDashboardObjectPreview['issues'] = [];
    if (!object.responsible) issues.push('no_responsible');
    if (object.employees.length === 0) issues.push('no_employees');
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

  private async loadMoney(user: CurrentAuthUser): Promise<LeadershipDashboardResponse['money']> {
    try {
      const accounts = await this.accountabilityService.listAccounts(user);
      const accountIds = accounts.map((account) => account.accountId);
      if (accountIds.length === 0) {
        return {
          available: true,
          submittedExpenses: 0,
          closingRequestedAccounts: 0,
          oneTimeOrderReceipts: { count: 0, amount: 0 },
        };
      }
      const receipts = await this.prisma.accountabilityFunding.aggregate({
        where: {
          accountabilityAccountId: { in: accountIds },
          fundingType: 'one_time_order_receipt',
          entryDirection: 'credit',
        },
        _count: { _all: true },
        _sum: { amount: true },
      });
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
          count: receipts._count._all,
          amount: Number(receipts._sum.amount ?? 0),
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

  private async loadPeople(user: CurrentAuthUser): Promise<LeadershipDashboardResponse['people']> {
    try {
      const [active, unassigned, candidates] = await Promise.all([
        this.employeesService.listEmployees(user, {
          archiveState: 'active',
          page: 1,
          limit: 1,
        }),
        this.employeesService.listEmployees(user, {
          archiveState: 'active',
          hasActiveObjectAssignment: false,
          page: 1,
          limit: 1,
        }),
        this.candidatesService
          .list(user, {
            archiveState: 'active',
            slaState: 'overdue',
            page: 1,
            limit: 1,
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
