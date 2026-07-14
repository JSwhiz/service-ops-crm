import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import {
  TASK_APPROVAL_SOURCE_ENTITY_TYPE,
  TASK_RESULT_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import {
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { canViewObjectByScope } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import {
  TaskListResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TaskStatus } from './types/task-status.type';
import { hasWideTaskAccess } from './utils/task-access.util';
import {
  canSubmitTaskResult,
  getAllowedTaskStatusTransitions,
} from './utils/task-transition-policy.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

interface TaskScopeObjectView {
  id: string;
  name: string;
  createdByUserId: string;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
    isActive?: boolean;
  }>;
}

interface TaskScopeOneTimeOrderView {
  id: string;
  title: string;
  createdByUserId: string;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
    isActive?: boolean;
  }>;
}

interface TaskView {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  objectId: string | null;
  oneTimeOrderId: string | null;
  dueAt: Date | null;
  dueTimeSpecified: boolean;
  requiresConfirmation: boolean;
  completionRequirement: string;
  autoCloseAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  workCycle: number;
  visibilityMode: string;
  resultText: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  object: TaskScopeObjectView | null;
  oneTimeOrder: TaskScopeOneTimeOrderView | null;
  createdBy: { id: string; login: string; fullName: string };
  submittedBy: { id: string; login: string; fullName: string } | null;
  assignees: Array<{
    id: string;
    userId: string;
    isActive: boolean;
    isCompleted: boolean;
    completedAt: Date | null;
    user: { id: string; login: string; fullName: string };
  }>;
  visibilityUsers: Array<{
    user: { id: string; login: string; fullName: string };
  }>;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listTasks(
    currentUser: CurrentAuthUser,
    query: ListTasksQueryDto,
  ): Promise<TaskResponseDto[] | TaskListResponseDto> {
    const where = this.buildTaskListWhere(currentUser, query);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortDirection ?? 'desc';
    const isPaginated = query.page !== undefined || query.limit !== undefined;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: this.getTaskInclude(),
        orderBy: [{ [sortBy]: sortDirection }, { id: 'desc' }],
        ...(isPaginated
          ? {
              skip: (page - 1) * limit,
              take: limit,
            }
          : {}),
      }),
      this.prisma.task.count({ where }),
    ]);

    const items = (tasks as TaskView[]).map((task) =>
      this.mapTask(task, currentUser),
    );

    if (!isPaginated) {
      return items;
    }

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTaskById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<TaskResponseDto> {
    const task = (await this.prisma.task.findFirst({
      where: {
        AND: [{ id }, this.buildTaskAccessWhere(currentUser)],
      },
      include: this.getTaskInclude(),
    })) as TaskView | null;

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.mapTask(task, currentUser);
  }

  async createTask(
    currentUser: CurrentAuthUser,
    payload: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    if (!currentUser.isActive) {
      throw new ForbiddenException('Only active users can create tasks');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const assigneeUserIds = Array.from(
      new Set(payload.assigneeUserIds.filter(Boolean)),
    );
    const visibleUserIds = Array.from(
      new Set((payload.visibleUserIds ?? []).filter(Boolean)),
    );

    await this.assertActiveUsers(assigneeUserIds, 'task assignees');
    await this.assertActiveUsers(visibleUserIds, 'task visibility users');

    const [object, order] = await Promise.all([
      payload.objectId ? this.loadTaskObject(payload.objectId) : null,
      payload.oneTimeOrderId
        ? this.loadTaskOneTimeOrder(payload.oneTimeOrderId)
        : null,
    ]);

    if (
      object &&
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Task creation denied for selected object');
    }

    if (
      order &&
      !canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        order,
      })
    ) {
      throw new ForbiddenException(
        'Task creation denied for selected one-time order',
      );
    }

    const visibilityMode = payload.visibilityMode ?? (object ? 'scope' : 'selected');

    if (!object && visibilityMode === 'scope') {
      throw new BadRequestException(
        'Scope visibility requires an object linkage',
      );
    }

    if (object && visibilityMode === 'selected') {
      const objectUserIds = new Set(
        object.assignments.map((assignment) => assignment.userId),
      );
      const invalidVisibleUser = visibleUserIds.find(
        (userId) => !objectUserIds.has(userId),
      );

      if (invalidVisibleUser) {
        throw new BadRequestException(
          'Selected task visibility users must be active object users',
        );
      }
    }

    const task = (await this.prisma.task.create({
      data: {
        title: payload.title,
        description: payload.description ?? null,
        priority: payload.priority,
        status: 'in_progress',
        objectId: payload.objectId ?? null,
        oneTimeOrderId: payload.oneTimeOrderId ?? null,
        createdByUserId: currentUser.id,
        requiresConfirmation: payload.requiresConfirmation ?? true,
        visibilityMode,
        assignees: {
          create: assigneeUserIds.map((userId) => ({
            userId,
          })),
        },
        visibilityUsers: {
          create: visibleUserIds.map((userId) => ({
            userId,
            addedByUserId: currentUser.id,
          })),
        },
        historyEvents: {
          create: {
            actorUserId: currentUser.id,
            eventType: 'task.created',
            payload: {
              objectId: payload.objectId ?? null,
              oneTimeOrderId: payload.oneTimeOrderId ?? null,
              assigneeUserIds,
              visibilityMode,
              visibleUserIds,
            },
          },
        },
      },
      include: this.getTaskInclude(),
    })) as TaskView;

    return this.mapTask(task, currentUser);
  }

  async updateStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    const existing = (await this.prisma.task.findFirst({
      where: { id },
      include: this.getTaskInclude(),
    })) as TaskView | null;

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const wideAccess = hasWideTaskAccess(roleCodes);
    const isCreator = existing.createdByUserId === currentUser.id;
    const isAssignee = existing.assignees.some(
      (assignee) => assignee.userId === currentUser.id && assignee.isActive,
    );

    if (!wideAccess && !isCreator && !isAssignee) {
      throw new ForbiddenException('Access to task status change denied');
    }

    const allowedStatusTransitions = getAllowedTaskStatusTransitions({
      currentStatus: existing.status as TaskStatus,
      isWideAccess: wideAccess,
      isCreator,
      isAssignee,
    });

    if (!allowedStatusTransitions.includes(payload.status as TaskStatus)) {
      throw new ForbiddenException('Task status transition denied');
    }

    const task = (await this.prisma.task.update({
      where: { id },
      data: {
        status: payload.status,
      },
      include: this.getTaskInclude(),
    })) as TaskView;

    return this.mapTask(task, currentUser);
  }

  async submitResult(
    currentUser: CurrentAuthUser,
    id: string,
    payload: SubmitTaskResultDto,
  ): Promise<TaskResponseDto> {
    const existing = (await this.prisma.task.findFirst({
      where: { id },
      include: this.getTaskInclude(),
    })) as TaskView | null;

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const wideAccess = hasWideTaskAccess(roleCodes);
    const isAssignee = existing.assignees.some(
      (assignee) => assignee.userId === currentUser.id && assignee.isActive,
    );

    if (
      !canSubmitTaskResult({
        currentStatus: existing.status as TaskStatus,
        isWideAccess: wideAccess,
        isCreator: existing.createdByUserId === currentUser.id,
        isAssignee,
      })
    ) {
      throw new ForbiddenException('Only assignee or wide role can submit result');
    }

    const submittedAt = new Date();
    const submissionResult = await this.prisma.$transaction(async (tx) => {
      const existingPendingApproval = await tx.approvalRequest.findFirst({
        where: {
          approvalType: TASK_RESULT_CONFIRMATION_TYPE,
          sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: id,
          status: 'pending',
        },
        select: {
          id: true,
        },
      });

      if (existingPendingApproval) {
        throw new ConflictException(
          'Task result already has a pending approval request',
        );
      }

      const updatedTask = (await tx.task.update({
        where: { id },
        data: {
          resultText: payload.resultText,
          submittedByUserId: currentUser.id,
          submittedAt,
          status: 'awaiting_confirmation',
        },
        include: this.getTaskInclude(),
      })) as TaskView;

      const approvalRequest = await tx.approvalRequest.create({
        data: {
          approvalType: TASK_RESULT_CONFIRMATION_TYPE,
          sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: updatedTask.id,
          createdByUserId: currentUser.id,
          payloadSnapshot: {
            summaryTitle: 'Подтверждение результата задачи',
            summarySubtitle: `${updatedTask.title} · ${updatedTask.oneTimeOrder?.title ?? updatedTask.object?.name ?? 'Без привязки'}`,
            taskTitle: updatedTask.title,
            targetType: updatedTask.oneTimeOrder ? 'one_time_order' : 'object',
            targetId: updatedTask.oneTimeOrder?.id ?? updatedTask.object?.id ?? '',
            targetName:
              updatedTask.oneTimeOrder?.title ?? updatedTask.object?.name ?? '—',
            resultText: payload.resultText,
            submittedAt: submittedAt.toISOString(),
            returnStatusOnCancel: existing.status,
          },
        },
      });

      return {
        task: updatedTask,
        approvalRequestId: approvalRequest.id,
      };
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: submissionResult.approvalRequestId,
      actorUserId: currentUser.id,
      action: 'approval.request.created',
      newValues: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: submissionResult.task.id,
      },
    });

    return this.mapTask(submissionResult.task as TaskView, currentUser);
  }

  async applyTaskResultApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      taskId: string;
      nextStatus: TaskStatus;
    },
  ): Promise<void> {
    const existingTask = await tx.task.findUnique({
      where: {
        id: params.taskId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existingTask) {
      throw new NotFoundException('Task not found for approval decision');
    }

    if (existingTask.status !== 'awaiting_confirmation') {
      throw new ConflictException(
        'Task is not waiting for approval decision anymore',
      );
    }

    await tx.task.update({
      where: {
        id: params.taskId,
      },
      data: {
        status: params.nextStatus,
      },
    });
  }

  async listTasksByObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<TaskResponseDto[]> {
    const result = await this.listTasks(currentUser, { objectId });
    return Array.isArray(result) ? result : result.items;
  }

  async listTasksByOneTimeOrder(
    currentUser: CurrentAuthUser,
    oneTimeOrderId: string,
  ): Promise<TaskResponseDto[]> {
    const result = await this.listTasks(currentUser, { oneTimeOrderId });
    return Array.isArray(result) ? result : result.items;
  }

  private getTaskInclude() {
    return {
      object: {
        select: {
          id: true,
          name: true,
          createdByUserId: true,
          assignments: {
            where: {
              isActive: true,
            },
            select: {
              userId: true,
              assignmentRoleCode: true,
              isActive: true,
            },
          },
        },
      },
      oneTimeOrder: {
        select: {
          id: true,
          title: true,
          createdByUserId: true,
          assignments: {
            where: {
              isActive: true,
            },
            select: {
              userId: true,
              assignmentRoleCode: true,
              isActive: true,
            },
          },
        },
      },
      createdBy: true,
      submittedBy: true,
      assignees: {
        include: {
          user: true,
        },
      },
      visibilityUsers: {
        include: {
          user: true,
        },
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
    };
  }

  private buildTaskAccessWhere(
    currentUser: CurrentAuthUser,
  ): Prisma.TaskWhereInput {
    if (hasWideTaskAccess(this.getRoleCodes(currentUser))) {
      return {};
    }

    return {
      OR: [
        { createdByUserId: currentUser.id },
        {
          assignees: {
            some: {
              userId: currentUser.id,
              isActive: true,
            },
          },
        },
        {
          visibilityUsers: {
            some: {
              userId: currentUser.id,
            },
          },
        },
        {
          visibilityMode: 'scope',
          object: {
            assignments: {
              some: {
                userId: currentUser.id,
                isActive: true,
              },
            },
          },
        },
      ],
    };
  }

  private buildTaskListWhere(
    currentUser: CurrentAuthUser,
    query: ListTasksQueryDto,
  ): Prisma.TaskWhereInput {
    const clauses: Prisma.TaskWhereInput[] = [
      this.buildTaskAccessWhere(currentUser),
    ];
    const search = (query.q ?? query.search)?.trim();

    if (query.status) {
      clauses.push({ status: query.status });
    }
    if (query.objectId) {
      clauses.push({ objectId: query.objectId });
    }
    if (query.oneTimeOrderId) {
      clauses.push({ oneTimeOrderId: query.oneTimeOrderId });
    }
    if (query.creatorUserId) {
      clauses.push({ createdByUserId: query.creatorUserId });
    }
    if (query.createdByMe === 'true') {
      clauses.push({ createdByUserId: currentUser.id });
    }
    if (query.assigneeUserId || query.assignedToMe === 'true') {
      clauses.push({
        assignees: {
          some: {
            userId:
              query.assignedToMe === 'true'
                ? currentUser.id
                : query.assigneeUserId,
            isActive: true,
          },
        },
      });
    }
    if (query.myObjects === 'true') {
      clauses.push({
        object: {
          assignments: {
            some: {
              userId: currentUser.id,
              isActive: true,
            },
          },
        },
      });
    }
    if (query.overdue === 'true') {
      clauses.push({
        dueAt: { lt: new Date() },
        status: { notIn: ['completed', 'cancelled', 'closed'] },
      });
    }
    if (search) {
      clauses.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { object: { name: { contains: search, mode: 'insensitive' } } },
          {
            oneTimeOrder: {
              title: { contains: search, mode: 'insensitive' },
            },
          },
          {
            createdBy: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { login: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
          {
            assignees: {
              some: {
                isActive: true,
                user: {
                  OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { login: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    return { AND: clauses };
  }

  private async assertActiveUsers(
    userIds: string[],
    label: string,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const usersCount = await this.prisma.user.count({
      where: {
        id: {
          in: userIds,
        },
        deletedAt: null,
        isActive: true,
      },
    });

    if (usersCount !== userIds.length) {
      throw new NotFoundException(`One or more ${label} not found`);
    }
  }

  private async loadTaskObject(objectId: string) {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
            isActive: true,
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object for task not found');
    }

    return object;
  }

  private async loadTaskOneTimeOrder(oneTimeOrderId: string) {
    const order = await this.prisma.oneTimeOrder.findUnique({
      where: { id: oneTimeOrderId },
      select: {
        id: true,
        title: true,
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
            assignmentRoleCode: true,
            isActive: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('One-time order for task not found');
    }

    return order;
  }

  private mapTask(task: TaskView, currentUser: CurrentAuthUser): TaskResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const isWideAccess = hasWideTaskAccess(roleCodes);
    const isCreator = task.createdBy.id === currentUser.id;
    const myAssignment = task.assignees.find(
      (assignee) => assignee.user.id === currentUser.id && assignee.isActive,
    );
    const isAssignee = Boolean(myAssignment);
    const allowedStatusTransitions = getAllowedTaskStatusTransitions({
      currentStatus: task.status as TaskStatus,
      isWideAccess,
      isCreator,
      isAssignee,
    });

    const targetType: TaskResponseDto['targetType'] =
      task.object && task.oneTimeOrder
        ? 'both'
        : task.object
          ? 'object'
          : task.oneTimeOrder
            ? 'one_time_order'
            : 'none';
    const targetId = task.oneTimeOrder?.id ?? task.object?.id ?? '';
    const targetName = task.oneTimeOrder?.title ?? task.object?.name ?? '—';
    const activeAssignees = task.assignees.filter(
      (assignee) => assignee.isActive,
    );
    const completedCount = activeAssignees.filter(
      (assignee) => assignee.isCompleted,
    ).length;
    const now = Date.now();
    const isTerminal = ['completed', 'cancelled', 'closed'].includes(task.status);
    const isLifecycleManager = isCreator || isWideAccess;
    const canCompleteMyAssignment = Boolean(
      myAssignment &&
        !myAssignment.isCompleted &&
        task.status === 'in_progress',
    );

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      targetType,
      targetId,
      targetName,
      objectId: task.object?.id ?? null,
      objectName: task.object?.name ?? null,
      oneTimeOrderId: task.oneTimeOrder?.id ?? null,
      oneTimeOrderTitle: task.oneTimeOrder?.title ?? null,
      object: task.object
        ? { id: task.object.id, name: task.object.name }
        : null,
      oneTimeOrder: task.oneTimeOrder
        ? { id: task.oneTimeOrder.id, title: task.oneTimeOrder.title }
        : null,
      requiresConfirmation: task.requiresConfirmation,
      completionRequirement: task.completionRequirement,
      dueAt: task.dueAt?.toISOString() ?? null,
      dueTimeSpecified: task.dueTimeSpecified,
      isOverdue: Boolean(
        task.dueAt && task.dueAt.getTime() < now && !isTerminal,
      ),
      autoCloseAt: task.autoCloseAt?.toISOString() ?? null,
      autoCloseRemainingSeconds: task.autoCloseAt
        ? Math.max(0, Math.ceil((task.autoCloseAt.getTime() - now) / 1000))
        : null,
      workCycle: task.workCycle,
      completedAt: task.completedAt?.toISOString() ?? null,
      cancelledAt: task.cancelledAt?.toISOString() ?? null,
      cancellationReason: task.cancellationReason,
      resultText: task.resultText,
      submittedAt: task.submittedAt ? task.submittedAt.toISOString() : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      createdBy: {
        id: task.createdBy.id,
        login: task.createdBy.login,
        fullName: task.createdBy.fullName,
      },
      submittedBy: task.submittedBy
        ? {
            id: task.submittedBy.id,
            login: task.submittedBy.login,
            fullName: task.submittedBy.fullName,
          }
        : null,
      assignees: task.assignees.map((assignee) => ({
        id: assignee.user.id,
        login: assignee.user.login,
        fullName: assignee.user.fullName,
        isActive: assignee.isActive,
        isCompleted: assignee.isCompleted,
        completedAt: assignee.completedAt
          ? assignee.completedAt.toISOString()
          : null,
      })),
      completionProgress: {
        completed: completedCount,
        total: activeAssignees.length,
      },
      visibilityMode: task.visibilityMode,
      visibleUsers: task.visibilityUsers.map(({ user }) => ({
        id: user.id,
        login: user.login,
        fullName: user.fullName,
      })),
      myAssignment: myAssignment
        ? {
            assigneeId: myAssignment.id,
            isCompleted: myAssignment.isCompleted,
            completedAt: myAssignment.completedAt?.toISOString() ?? null,
          }
        : null,
      capabilities: {
        canSubmitResult: canCompleteMyAssignment,
        allowedStatusTransitions,
        canEdit: isCreator && !isTerminal,
        canManageAssignees: isCreator && !isTerminal,
        canCompleteMyAssignment,
        canUndoMyCompletion: Boolean(
          myAssignment?.isCompleted && !isTerminal,
        ),
        canConfirm:
          isLifecycleManager && task.status === 'awaiting_confirmation',
        canCompleteNow:
          isLifecycleManager && task.status === 'pending_auto_close',
        canReturnToWork:
          isLifecycleManager &&
          ['awaiting_confirmation', 'pending_auto_close'].includes(task.status),
        canReopen: isLifecycleManager && task.status === 'completed',
        canCancel:
          isLifecycleManager &&
          ['in_progress', 'awaiting_confirmation', 'pending_auto_close'].includes(
            task.status,
          ),
        canViewHistory: true,
      },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }
}
