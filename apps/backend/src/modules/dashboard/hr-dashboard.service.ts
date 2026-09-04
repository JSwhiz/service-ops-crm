import { ForbiddenException, Injectable } from '@nestjs/common';

import { TaskListResponseDto, TaskResponseDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';
import { UserAbsencesService } from '../user-absences/user-absences.service';
import { PrismaService } from '../prisma/prisma.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

export interface HrDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  today: {
    activeEmployees: number;
    employeesWithoutObject: number;
    newCandidates: number;
    overdueCandidateSla: number;
    userAbsencesToday: number;
    myTasksToday: number;
  };
  attention: {
    total: number;
    items: Array<{
      id: string;
      kind: 'candidate_sla' | 'employee_without_object' | 'task';
      badge: string;
      tone: 'warning' | 'danger' | 'neutral';
      title: string;
      subtitle: string;
      meta: string;
      entityId?: string;
    }>;
  };
  candidates: {
    newCount: number;
    inProgressCount: number;
    overdueSlaCount: number;
    items: Array<{
      id: string;
      fullName: string;
      phone: string | null;
      status: string;
      candidateType: string;
      managerName: string | null;
      responseDueAt: string | null;
      overdue: boolean;
    }>;
  };
  employees: {
    activeCount: number;
    withoutObjectCount: number;
    items: Array<{
      id: string;
      fullName: string;
      position: string | null;
      objectCount: number;
    }>;
  };
  absences: {
    today: number;
    upcoming: Array<{
      id: string;
      userId: string;
      fullName: string;
      absenceType: string;
      startDate: string;
      endDate: string;
    }>;
  };
  tasks: {
    totalRelevant: number;
    items: TaskResponseDto[];
  };
}

function moscowClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}` };
}

function dateKey(value: string | null): string | null {
  return value?.slice(0, 10) ?? null;
}

function isMine(task: TaskResponseDto, userId: string): boolean {
  return Boolean(
    task.myAssignment ||
      task.assignees.some((item) => item.id === userId && item.isActive),
  );
}

@Injectable()
export class HrDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly userAbsencesService: UserAbsencesService,
  ) {}

  async getDashboard(user: CurrentAuthUser): Promise<HrDashboardResponse> {
    const roles = user.roleCodes?.length ? user.roleCodes : [user.roleCode];
    if (!roles.includes('hr')) {
      throw new ForbiddenException('HR dashboard is not available for this role');
    }

    const now = new Date();
    const today = moscowClock().date;
    const [
      activeEmployees,
      employeesWithoutObject,
      newCandidates,
      inProgressCandidates,
      overdueAssignments,
      candidateRows,
      employeeRows,
      absencesToday,
      upcomingAbsences,
      tasksResult,
    ] = await Promise.all([
      this.prisma.employee.count({
        where: { deletedAt: null, employmentStatus: 'active' },
      }),
      this.prisma.employee.count({
        where: {
          deletedAt: null,
          employmentStatus: 'active',
          objectAssignments: { none: { isActive: true } },
        },
      }),
      this.prisma.candidate.count({
        where: { deletedAt: null, status: 'new' },
      }),
      this.prisma.candidate.count({
        where: { deletedAt: null, status: 'in_progress' },
      }),
      this.prisma.candidateManagerAssignment.findMany({
        where: {
          endedAt: null,
          firstRespondedAt: null,
          responseDueAt: { lt: now },
          candidate: { deletedAt: null },
        },
        select: {
          id: true,
          candidateId: true,
          responseDueAt: true,
          candidate: { select: { fullName: true } },
          manager: { select: { fullName: true } },
        },
        orderBy: { responseDueAt: 'asc' },
        take: 20,
      }),
      this.prisma.candidate.findMany({
        where: { deletedAt: null, status: { in: ['new', 'in_progress'] } },
        select: {
          id: true,
          fullName: true,
          phone: true,
          status: true,
          candidateType: true,
          assignments: {
            where: { endedAt: null },
            select: {
              responseDueAt: true,
              firstRespondedAt: true,
              manager: { select: { fullName: true } },
            },
            take: 1,
            orderBy: { assignedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.employee.findMany({
        where: {
          deletedAt: null,
          employmentStatus: 'active',
          objectAssignments: { none: { isActive: true } },
        },
        select: {
          id: true,
          fullName: true,
          position: true,
          objectAssignments: {
            where: { isActive: true },
            select: { id: true },
          },
        },
        orderBy: { fullName: 'asc' },
        take: 5,
      }),
      this.userAbsencesService.countTodayForLeadership(today),
      this.userAbsencesService.listUpcomingForLeadership(today, 5),
      this.tasksService.listTasks(user, {
        page: 1,
        limit: 100,
        sortBy: 'dueAt',
        sortDirection: 'asc',
      }),
    ]);

    const tasks = Array.isArray(tasksResult)
      ? tasksResult
      : (tasksResult as TaskListResponseDto).items;
    const relevantTasks = tasks
      .filter((task) => !['completed', 'cancelled'].includes(task.status))
      .filter((task) => isMine(task, user.id))
      .sort((a, b) => {
        const rank = (task: TaskResponseDto): number =>
          task.isOverdue ? 0 : dateKey(task.dueAt) === today ? 1 : task.dueAt ? 2 : 3;
        return rank(a) - rank(b) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
      });

    const overdueCandidateIds = new Set(
      overdueAssignments.map((assignment) => assignment.candidateId),
    );
    const candidates = candidateRows
      .map((candidate) => {
        const assignment = candidate.assignments[0];
        return {
          id: candidate.id,
          fullName: candidate.fullName,
          phone: candidate.phone,
          status: candidate.status,
          candidateType: candidate.candidateType,
          managerName: assignment?.manager.fullName ?? null,
          responseDueAt: assignment?.responseDueAt.toISOString() ?? null,
          overdue: overdueCandidateIds.has(candidate.id),
        };
      })
      .sort((a, b) => Number(b.overdue) - Number(a.overdue))
      .slice(0, 5);

    const attention: HrDashboardResponse['attention']['items'] = [];
    for (const assignment of overdueAssignments.slice(0, 5)) {
      attention.push({
        id: `candidate-${assignment.candidateId}`,
        kind: 'candidate_sla',
        badge: 'SLA',
        tone: 'danger',
        title: 'Просрочен ответ кандидату',
        subtitle: `${assignment.candidate.fullName} · ${assignment.manager.fullName}`,
        meta: 'Просрочено',
        entityId: assignment.candidateId,
      });
    }
    if (employeesWithoutObject > 0) {
      attention.push({
        id: 'employees-without-object',
        kind: 'employee_without_object',
        badge: 'Сотрудники',
        tone: 'warning',
        title: 'Есть сотрудники без объекта',
        subtitle: `${employeesWithoutObject} активных сотрудников без назначения`,
        meta: 'Требует распределения',
      });
    }
    for (const task of relevantTasks.filter((item) => item.isOverdue).slice(0, 3)) {
      attention.push({
        id: `task-${task.id}`,
        kind: 'task',
        badge: 'Задача',
        tone: 'danger',
        title: task.title,
        subtitle: task.targetName || 'Без привязки',
        meta: 'Просрочено',
        entityId: task.id,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      timeZone: 'Europe/Moscow',
      today: {
        activeEmployees,
        employeesWithoutObject,
        newCandidates,
        overdueCandidateSla: overdueAssignments.length,
        userAbsencesToday: absencesToday,
        myTasksToday: relevantTasks.filter((task) => dateKey(task.dueAt) === today).length,
      },
      attention: {
        total: overdueAssignments.length + (employeesWithoutObject > 0 ? 1 : 0) + relevantTasks.filter((item) => item.isOverdue).length,
        items: attention.slice(0, 5),
      },
      candidates: {
        newCount: newCandidates,
        inProgressCount: inProgressCandidates,
        overdueSlaCount: overdueAssignments.length,
        items: candidates,
      },
      employees: {
        activeCount: activeEmployees,
        withoutObjectCount: employeesWithoutObject,
        items: employeeRows.map((employee) => ({
          id: employee.id,
          fullName: employee.fullName,
          position: employee.position,
          objectCount: employee.objectAssignments.length,
        })),
      },
      absences: {
        today: absencesToday,
        upcoming: upcomingAbsences.map((absence) => ({
          id: absence.id,
          userId: absence.userId,
          fullName: absence.user.fullName,
          absenceType: absence.absenceType,
          startDate: absence.startDate,
          endDate: absence.endDate,
        })),
      },
      tasks: {
        totalRelevant: relevantTasks.length,
        items: relevantTasks.slice(0, 5),
      },
    };
  }
}
