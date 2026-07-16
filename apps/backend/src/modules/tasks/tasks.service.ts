import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { AuditService } from '../audit/audit.service';
import {
  TASK_APPROVAL_SOURCE_ENTITY_TYPE,
  TASK_RESULT_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import {
  buildOneTimeOrderAccessWhere,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { canViewObjectByScope } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { mapSafeFileResponse } from '../files/utils/safe-file-response.mapper';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTaskCompletionsQueryDto } from './dto/list-task-completions-query.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import {
  AddTaskAssigneesDto,
  CompleteTaskAssignmentDto,
  TaskReasonDto,
} from './dto/task-lifecycle.dto';
import { TaskHistoryEventResponseDto } from './dto/task-history-response.dto';
import {
  TaskCompletionAttachmentDto,
  TaskCompletionListResponseDto,
} from './dto/task-completion-response.dto';
import {
  TaskListResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  buildTaskAccessWhere,
  hasWideTaskAccess,
} from './utils/task-access.util';
import { parseTaskDeadline } from './utils/task-deadline.util';
import { normalizeTaskUserIds } from './utils/task-user-ids.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
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
    completions: Array<{
      id: string;
      workCycle: number;
      completionText: string | null;
      status: string;
      submittedAt: Date;
    }>;
  }>;
  visibilityUsers: Array<{
    user: { id: string; login: string; fullName: string };
  }>;
}

interface TaskLifecycleView {
  id: string;
  title: string;
  status: string;
  createdByUserId: string;
  objectId: string | null;
  oneTimeOrderId: string | null;
  requiresConfirmation: boolean;
  completionRequirement: string;
  workCycle: number;
  object: { id: string; name: string } | null;
  oneTimeOrder: { id: string; title: string } | null;
  assignees: Array<{
    id: string;
    userId: string;
    isActive: boolean;
    isCompleted: boolean;
    completions: Array<{
      id: string;
      workCycle: number;
      attemptNumber: number;
      status: string;
    }>;
  }>;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
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

    return this.attachCompletionFiles(this.mapTask(task, currentUser));
  }

  async createTask(
    currentUser: CurrentAuthUser,
    payload: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    if (!currentUser.isActive) {
      throw new ForbiddenException('Only active users can create tasks');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const assigneeUserIds = this.normalizeRequiredAssigneeUserIds(
      payload.assigneeUserIds,
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
        permissionCodes: currentUser.permissionCodes,
        order,
      })
    ) {
      throw new ForbiddenException(
        'Task creation denied for selected one-time order',
      );
    }

    const visibilityMode = payload.visibilityMode ?? (object ? 'scope' : 'selected');
    const deadline = parseTaskDeadline({
      dueDate: payload.dueDate,
      dueTime: payload.dueTime,
      timeZone: this.getAppTimeZone(),
    });

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
        completionRequirement:
          payload.completionRequirement ?? 'comment_or_file',
        dueAt: deadline.dueAt,
        dueTimeSpecified: deadline.dueTimeSpecified,
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

  async updateTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    const existing = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: true,
        visibilityUsers: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }
    this.assertTaskCreator(currentUser, existing.createdByUserId);
    this.assertTaskMutable(existing.status);

    const objectId =
      payload.objectId !== undefined ? payload.objectId : existing.objectId;
    const oneTimeOrderId =
      payload.oneTimeOrderId !== undefined
        ? payload.oneTimeOrderId
        : existing.oneTimeOrderId;
    const [object, order] = await Promise.all([
      objectId ? this.loadTaskObject(objectId) : null,
      oneTimeOrderId ? this.loadTaskOneTimeOrder(oneTimeOrderId) : null,
    ]);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      object &&
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Task update denied for selected object');
    }
    if (
      order &&
      !canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: currentUser.permissionCodes,
        order,
      })
    ) {
      throw new ForbiddenException('Task update denied for selected order');
    }

    const visibleUserIds = Array.from(
      new Set(
        payload.visibleUserIds ??
          existing.visibilityUsers.map((item) => item.userId),
      ),
    );
    await this.assertActiveUsers(visibleUserIds, 'task visibility users');
    const visibilityMode =
      payload.visibilityMode ?? existing.visibilityMode;
    this.assertVisibilitySelection(object, visibilityMode, visibleUserIds);

    const deadline =
      payload.dueDate !== undefined || payload.dueTime !== undefined
        ? parseTaskDeadline({
            dueDate: payload.dueDate,
            dueTime: payload.dueTime,
            timeZone: this.getAppTimeZone(),
          })
        : {
            dueAt: existing.dueAt,
            dueTimeSpecified: existing.dueTimeSpecified,
          };
    const nextValues = {
      title: payload.title ?? existing.title,
      description:
        payload.description !== undefined
          ? payload.description?.trim() || null
          : existing.description,
      priority: payload.priority ?? existing.priority,
      objectId,
      oneTimeOrderId,
      requiresConfirmation:
        payload.requiresConfirmation ?? existing.requiresConfirmation,
      completionRequirement:
        payload.completionRequirement ?? existing.completionRequirement,
      dueAt: deadline.dueAt,
      dueTimeSpecified: deadline.dueTimeSpecified,
      visibilityMode,
    };
    const significantChange =
      nextValues.title !== existing.title ||
      nextValues.description !== existing.description ||
      nextValues.objectId !== existing.objectId ||
      nextValues.oneTimeOrderId !== existing.oneTimeOrderId ||
      nextValues.requiresConfirmation !== existing.requiresConfirmation ||
      nextValues.completionRequirement !== existing.completionRequirement ||
      nextValues.dueAt?.getTime() !== existing.dueAt?.getTime();
    const requiresReset =
      significantChange &&
      (existing.assignees.some(
        (assignment) => assignment.isActive && assignment.isCompleted,
      ) ||
        ['awaiting_confirmation', 'pending_auto_close'].includes(
          existing.status,
        ));

    if (requiresReset && !payload.resetCompletions) {
      throw new ConflictException(
        'Task update requires resetCompletions=true',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertTaskCreator(currentUser, task.createdByUserId);
      this.assertTaskMutable(task.status);
      const lockedRequiresReset =
        significantChange &&
        (task.assignees.some(
          (assignment) => assignment.isActive && assignment.isCompleted,
        ) ||
          ['awaiting_confirmation', 'pending_auto_close'].includes(task.status));

      if (lockedRequiresReset && !payload.resetCompletions) {
        throw new ConflictException(
          'Task update requires resetCompletions=true',
        );
      }

      if (lockedRequiresReset) {
        await this.resetTaskCycle(
          tx,
          task,
          currentUser.id,
          'Task content updated',
          'task.updated',
        );
      }

      await tx.task.update({
        where: { id: taskId },
        data: nextValues,
      });

      if (payload.visibleUserIds !== undefined || payload.visibilityMode) {
        await tx.taskVisibilityUser.deleteMany({ where: { taskId } });
        if (visibleUserIds.length > 0) {
          await tx.taskVisibilityUser.createMany({
            data: visibleUserIds.map((userId) => ({
              taskId,
              userId,
              addedByUserId: currentUser.id,
            })),
          });
        }
        await this.writeTaskHistory(
          tx,
          taskId,
          currentUser.id,
          'task.visibility_changed',
          { visibilityMode, visibleUserIds },
        );
      }

      if (!lockedRequiresReset) {
        await this.writeTaskHistory(tx, taskId, currentUser.id, 'task.updated', {
          significantChange,
          resetCompletions: false,
        });
      }
    });

    return this.getTaskById(currentUser, taskId);
  }

  async updateStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    if (payload.status !== 'in_progress') {
      throw new ForbiddenException(
        'Use the dedicated task lifecycle endpoint for this transition',
      );
    }

    return this.getTaskById(currentUser, id);
  }

  async submitResult(
    currentUser: CurrentAuthUser,
    id: string,
    payload: SubmitTaskResultDto,
  ): Promise<TaskResponseDto> {
    return this.completeMyAssignment(currentUser, id, {
      completionText: payload.resultText,
    });
  }

  async createCompletionDraft(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<{ id: string; workCycle: number }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      const assignment = this.getCurrentAssignment(task, currentUser.id);

      this.assertTaskInProgress(task.status);
      if (assignment.isCompleted) {
        throw new ConflictException('Task assignment is already completed');
      }

      const existingDraft = assignment.completions.find(
        (completion) =>
          completion.workCycle === task.workCycle &&
          completion.status === 'draft',
      );
      if (existingDraft) {
        return { id: existingDraft.id, workCycle: task.workCycle };
      }

      const completion = await tx.taskAssigneeCompletion.create({
        data: {
          taskAssigneeId: assignment.id,
          workCycle: task.workCycle,
          attemptNumber: this.getNextAttemptNumber(
            assignment.completions,
            task.workCycle,
          ),
          status: 'draft',
        },
      });

      return { id: completion.id, workCycle: task.workCycle };
    });
  }

  async completeMyAssignment(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: CompleteTaskAssignmentDto,
  ): Promise<TaskResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      const assignment = this.getCurrentAssignment(task, currentUser.id);

      this.assertTaskInProgress(task.status);
      if (assignment.isCompleted) {
        throw new ConflictException('Task assignment is already completed');
      }

      const completion = payload.completionId
        ? assignment.completions.find(
            (item) =>
              item.id === payload.completionId &&
              item.workCycle === task.workCycle &&
              item.status === 'draft',
          )
        : await tx.taskAssigneeCompletion.create({
            data: {
              taskAssigneeId: assignment.id,
              workCycle: task.workCycle,
              attemptNumber: this.getNextAttemptNumber(
                assignment.completions,
                task.workCycle,
              ),
              status: 'draft',
            },
          });

      if (!completion) {
        throw new BadRequestException('Completion draft is not available');
      }

      const completionText = payload.completionText?.trim() || null;
      const attachmentCount = await tx.fileAttachment.count({
        where: {
          entityType: 'task_assignee_completion',
          entityId: completion.id,
        },
      });
      this.assertCompletionRequirement(
        task.completionRequirement,
        completionText,
        attachmentCount,
      );

      const submittedAt = new Date();
      await tx.taskAssigneeCompletion.update({
        where: { id: completion.id },
        data: {
          completionText,
          status: 'submitted',
          submittedAt,
        },
      });
      await tx.taskAssignee.update({
        where: { id: assignment.id },
        data: {
          isCompleted: true,
          completedAt: submittedAt,
        },
      });
      await this.writeTaskHistory(tx, task.id, currentUser.id, 'task.assignee_completed', {
        userId: currentUser.id,
        completionId: completion.id,
        workCycle: task.workCycle,
      });

      const allCompleted = task.assignees
        .filter((item) => item.isActive && item.id !== assignment.id)
        .every((item) => item.isCompleted);
      let approvalRequestId: string | null = null;

      if (allCompleted) {
        if (task.requiresConfirmation) {
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: 'awaiting_confirmation',
              autoCloseAt: null,
              resultText: completionText,
              submittedByUserId: currentUser.id,
              submittedAt,
            },
          });
          approvalRequestId = await this.createPendingTaskApproval(
            tx,
            task,
            currentUser.id,
            submittedAt,
          );
          await this.writeTaskHistory(
            tx,
            task.id,
            currentUser.id,
            'task.awaiting_confirmation',
            { workCycle: task.workCycle, approvalRequestId },
          );
        } else {
          const autoCloseAt = new Date(submittedAt.getTime() + 15 * 60 * 1000);
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: 'pending_auto_close',
              autoCloseAt,
            },
          });
          await this.writeTaskHistory(
            tx,
            task.id,
            currentUser.id,
            'task.auto_close_scheduled',
            { workCycle: task.workCycle, autoCloseAt: autoCloseAt.toISOString() },
          );
        }
      }

      return { approvalRequestId };
    });

    if (result.approvalRequestId) {
      await this.auditApprovalCreated(
        result.approvalRequestId,
        taskId,
        currentUser.id,
      );
    }

    return this.getTaskById(currentUser, taskId);
  }

  async undoMyCompletion(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskResponseDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      const assignment = this.getCurrentAssignment(task, currentUser.id);

      if (['completed', 'cancelled'].includes(task.status)) {
        throw new ConflictException('Completed task cannot be changed');
      }
      if (!assignment.isCompleted) {
        throw new ConflictException('Task assignment is not completed');
      }

      const completion = assignment.completions.find(
        (item) =>
          item.workCycle === task.workCycle && item.status === 'submitted',
      );
      if (!completion) {
        throw new ConflictException('Current completion was not found');
      }

      const now = new Date();
      await tx.taskAssigneeCompletion.update({
        where: { id: completion.id },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledByUserId: currentUser.id,
          cancellationReason: 'Cancelled by assignee',
        },
      });
      await tx.taskAssignee.update({
        where: { id: assignment.id },
        data: { isCompleted: false, completedAt: null },
      });
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', autoCloseAt: null },
      });
      await this.cancelPendingTaskApproval(tx, task.id, currentUser.id);
      await this.writeTaskHistory(
        tx,
        task.id,
        currentUser.id,
        'task.assignee_completion_cancelled',
        { completionId: completion.id, workCycle: task.workCycle },
      );
    });

    return this.getTaskById(currentUser, taskId);
  }

  async confirmTask(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskResponseDto> {
    await this.completeTaskByActor(currentUser, taskId, 'awaiting_confirmation', 'task.confirmed');
    return this.getTaskById(currentUser, taskId);
  }

  async completeTaskNow(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskResponseDto> {
    await this.completeTaskByActor(currentUser, taskId, 'pending_auto_close', 'task.completed_manually');
    return this.getTaskById(currentUser, taskId);
  }

  async returnTaskToWork(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    await this.resetTaskByActor(
      currentUser,
      taskId,
      ['awaiting_confirmation', 'pending_auto_close'],
      payload.reason,
      'task.returned_to_work',
    );
    return this.getTaskById(currentUser, taskId);
  }

  async reopenTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    await this.resetTaskByActor(
      currentUser,
      taskId,
      ['completed'],
      payload.reason,
      'task.reopened',
    );
    return this.getTaskById(currentUser, taskId);
  }

  async cancelTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskResponseDto> {
    const reason = this.normalizeReason(payload.reason);

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertLifecycleManager(currentUser, task.createdByUserId);
      if (
        !['in_progress', 'awaiting_confirmation', 'pending_auto_close'].includes(
          task.status,
        )
      ) {
        throw new ConflictException('Task cannot be cancelled from this status');
      }

      const now = new Date();
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledByUserId: currentUser.id,
          cancellationReason: reason,
          autoCloseAt: null,
        },
      });
      await this.cancelPendingTaskApproval(tx, task.id, currentUser.id, reason);
      await this.writeTaskHistory(tx, task.id, currentUser.id, 'task.cancelled', {
        reason,
        workCycle: task.workCycle,
      });
    });

    return this.getTaskById(currentUser, taskId);
  }

  async addAssignees(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: AddTaskAssigneesDto,
  ): Promise<TaskResponseDto> {
    const userIds = this.normalizeRequiredAssigneeUserIds(payload.userIds);
    await this.assertActiveUsers(userIds, 'task assignees');

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertTaskCreator(currentUser, task.createdByUserId);
      this.assertTaskMutable(task.status);

      for (const userId of userIds) {
        const existing = task.assignees.find((item) => item.userId === userId);
        if (existing?.isActive) {
          throw new ConflictException('User is already assigned to task');
        }

        if (existing) {
          await tx.taskAssigneeCompletion.updateMany({
            where: {
              taskAssigneeId: existing.id,
              workCycle: task.workCycle,
              status: { in: ['draft', 'submitted'] },
            },
            data: {
              status: 'invalidated',
              cancelledAt: new Date(),
              cancelledByUserId: currentUser.id,
              cancellationReason: 'Assignee added again',
            },
          });
          await tx.taskAssignee.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              removedAt: null,
              removedByUserId: null,
              isCompleted: false,
              completedAt: null,
            },
          });
        } else {
          await tx.taskAssignee.create({
            data: { taskId: task.id, userId },
          });
        }

        await this.writeTaskHistory(tx, task.id, currentUser.id, 'task.assignee_added', {
          userId,
          workCycle: task.workCycle,
        });
      }

      await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', autoCloseAt: null },
      });
      await this.cancelPendingTaskApproval(tx, task.id, currentUser.id);
    });

    return this.getTaskById(currentUser, taskId);
  }

  async removeAssignee(
    currentUser: CurrentAuthUser,
    taskId: string,
    userId: string,
  ): Promise<TaskResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertTaskCreator(currentUser, task.createdByUserId);
      this.assertTaskMutable(task.status);
      const activeAssignees = task.assignees.filter((item) => item.isActive);
      const assignment = activeAssignees.find((item) => item.userId === userId);

      if (!assignment) {
        throw new NotFoundException('Active task assignee not found');
      }
      if (activeAssignees.length <= 1) {
        throw new ConflictException('Last active task assignee cannot be removed');
      }

      await tx.taskAssignee.update({
        where: { id: assignment.id },
        data: {
          isActive: false,
          removedAt: new Date(),
          removedByUserId: currentUser.id,
        },
      });
      await this.cancelPendingTaskApproval(tx, task.id, currentUser.id);
      await this.writeTaskHistory(tx, task.id, currentUser.id, 'task.assignee_removed', {
        userId,
        workCycle: task.workCycle,
      });

      return this.recalculateTaskAfterAssigneeChange(
        tx,
        task,
        assignment.id,
        currentUser.id,
      );
    });

    if (result.approvalRequestId) {
      await this.auditApprovalCreated(
        result.approvalRequestId,
        taskId,
        currentUser.id,
      );
    }

    return this.getTaskById(currentUser, taskId);
  }

  async listTaskHistory(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskHistoryEventResponseDto[]> {
    await this.getTaskById(currentUser, taskId);
    const events = await this.prisma.taskHistoryEvent.findMany({
      where: { taskId },
      include: { actor: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
      actor: event.actor
        ? {
            id: event.actor.id,
            login: event.actor.login,
            fullName: event.actor.fullName,
          }
        : null,
    }));
  }

  async listTaskCompletions(
    currentUser: CurrentAuthUser,
    taskId: string,
    query: ListTaskCompletionsQueryDto,
  ): Promise<TaskCompletionListResponseDto> {
    const readableTask = await this.prisma.task.findFirst({
      where: {
        AND: [{ id: taskId }, this.buildTaskAccessWhere(currentUser)],
      },
      select: { id: true },
    });

    if (!readableTask) {
      throw new NotFoundException('Task not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.TaskAssigneeCompletionWhereInput = {
      status: { not: 'draft' },
      taskAssignee: {
        taskId,
        ...(query.assigneeUserId ? { userId: query.assigneeUserId } : {}),
      },
      ...(query.workCycle ? { workCycle: query.workCycle } : {}),
    };
    const [completions, total] = await this.prisma.$transaction([
      this.prisma.taskAssigneeCompletion.findMany({
        where,
        select: {
          id: true,
          workCycle: true,
          attemptNumber: true,
          status: true,
          completionText: true,
          submittedAt: true,
          cancelledAt: true,
          cancellationReason: true,
          taskAssignee: {
            select: {
              user: {
                select: {
                  id: true,
                  login: true,
                  fullName: true,
                },
              },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.taskAssigneeCompletion.count({ where }),
    ]);
    const completionIds = completions.map((completion) => completion.id);
    const attachmentRows = completionIds.length
      ? await this.prisma.fileAttachment.findMany({
          where: {
            entityType: 'task_assignee_completion',
            entityId: { in: completionIds },
            file: { deletedAt: null },
          },
          select: {
            entityId: true,
            file: {
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const attachmentsByCompletion = new Map<
      string,
      TaskCompletionAttachmentDto[]
    >();

    for (const row of attachmentRows) {
      const attachments = attachmentsByCompletion.get(row.entityId) ?? [];
      attachments.push(mapSafeFileResponse(row.file));
      attachmentsByCompletion.set(row.entityId, attachments);
    }

    return {
      items: completions.map((completion) => ({
        id: completion.id,
        workCycle: completion.workCycle,
        attemptNumber: completion.attemptNumber,
        status: completion.status,
        completionText: completion.completionText,
        submittedAt: completion.submittedAt.toISOString(),
        cancelledAt: completion.cancelledAt?.toISOString() ?? null,
        cancellationReason: completion.cancellationReason,
        assignee: completion.taskAssignee.user,
        attachments: attachmentsByCompletion.get(completion.id) ?? [],
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async applyTaskResultApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      taskId: string;
      decision: 'approve' | 'reject' | 'cancel';
      actorUserId: string | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await this.lockTask(tx, params.taskId);
    const task = await this.loadTaskForLifecycle(tx, params.taskId);
    if (task.status !== 'awaiting_confirmation') {
      throw new ConflictException('Task is not awaiting confirmation');
    }

    if (params.decision === 'approve') {
      await this.markTaskCompleted(
        tx,
        task,
        params.actorUserId,
        params.actorUserId ? 'leadership' : 'system',
        'task.confirmed',
      );
      return;
    }

    await this.resetTaskCycle(
      tx,
      task,
      params.actorUserId,
      this.normalizeReason(params.reason ?? 'Approval was cancelled'),
      'task.returned_to_work',
      false,
    );
  }

  private async completeTaskByActor(
    currentUser: CurrentAuthUser,
    taskId: string,
    expectedStatus: 'awaiting_confirmation' | 'pending_auto_close',
    eventType: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertLifecycleManager(currentUser, task.createdByUserId);
      if (task.status !== expectedStatus) {
        throw new ConflictException('Task is not ready for completion');
      }
      this.assertAllActiveAssigneesCompleted(task);

      await this.markTaskCompleted(
        tx,
        task,
        currentUser.id,
        task.createdByUserId === currentUser.id ? 'creator' : 'leadership',
        eventType,
      );

      if (expectedStatus === 'awaiting_confirmation') {
        const pendingApprovals = await tx.approvalRequest.findMany({
          where: {
            approvalType: TASK_RESULT_CONFIRMATION_TYPE,
            sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
            sourceEntityId: task.id,
            status: 'pending',
          },
          select: { id: true },
        });
        await tx.approvalRequest.updateMany({
          where: {
            approvalType: TASK_RESULT_CONFIRMATION_TYPE,
            sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
            sourceEntityId: task.id,
            status: 'pending',
          },
          data: {
            status: 'approved',
            resolvedByUserId: currentUser.id,
            resolvedAt: new Date(),
          },
        });
        for (const approval of pendingApprovals) {
          await tx.auditEvent.create({
            data: {
              entityType: 'approval_request',
              entityId: approval.id,
              actorUserId: currentUser.id,
              action: 'approval.request.approved',
              newValues: {
                approvalType: TASK_RESULT_CONFIRMATION_TYPE,
                sourceEntityId: task.id,
              },
            },
          });
        }
      }
    });
  }

  private async resetTaskByActor(
    currentUser: CurrentAuthUser,
    taskId: string,
    allowedStatuses: string[],
    rawReason: string,
    eventType: string,
  ): Promise<void> {
    const reason = this.normalizeReason(rawReason);

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      this.assertLifecycleManager(currentUser, task.createdByUserId);
      if (!allowedStatuses.includes(task.status)) {
        throw new ConflictException('Task cannot return to work from this status');
      }

      await this.resetTaskCycle(
        tx,
        task,
        currentUser.id,
        reason,
        eventType,
      );
    });
  }

  private async markTaskCompleted(
    tx: Prisma.TransactionClient,
    task: TaskLifecycleView,
    actorUserId: string | null,
    completedByKind: string,
    eventType: string,
  ): Promise<void> {
    const completedAt = new Date();
    await tx.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt,
        completedByUserId: actorUserId,
        completedByKind,
        autoCloseAt: null,
      },
    });
    await this.writeTaskHistory(tx, task.id, actorUserId, eventType, {
      workCycle: task.workCycle,
      completedByKind,
      completedAt: completedAt.toISOString(),
    });
  }

  private async resetTaskCycle(
    tx: Prisma.TransactionClient,
    task: TaskLifecycleView,
    actorUserId: string | null,
    reason: string,
    eventType: string,
    cancelApproval = true,
  ): Promise<void> {
    const now = new Date();
    const assignmentIds = task.assignees
      .filter((assignment) => assignment.isActive)
      .map((assignment) => assignment.id);

    await tx.taskAssigneeCompletion.updateMany({
      where: {
        taskAssigneeId: { in: assignmentIds },
        workCycle: task.workCycle,
        status: { in: ['draft', 'submitted'] },
      },
      data: {
        status: 'invalidated',
        cancelledAt: now,
        cancelledByUserId: actorUserId,
        cancellationReason: reason,
      },
    });
    await tx.taskAssignee.updateMany({
      where: { taskId: task.id, isActive: true },
      data: { isCompleted: false, completedAt: null },
    });
    await tx.task.update({
      where: { id: task.id },
      data: {
        status: 'in_progress',
        workCycle: { increment: 1 },
        autoCloseAt: null,
        completedAt: null,
        completedByUserId: null,
        completedByKind: null,
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      },
    });
    if (cancelApproval) {
      await this.cancelPendingTaskApproval(
        tx,
        task.id,
        actorUserId,
        reason,
      );
    }
    await this.writeTaskHistory(tx, task.id, actorUserId, eventType, {
      reason,
      oldWorkCycle: task.workCycle,
      newWorkCycle: task.workCycle + 1,
    });
  }

  private async recalculateTaskAfterAssigneeChange(
    tx: Prisma.TransactionClient,
    task: TaskLifecycleView,
    removedAssignmentId: string,
    actorUserId: string,
  ): Promise<{ approvalRequestId: string | null }> {
    const remaining = task.assignees.filter(
      (assignment) =>
        assignment.isActive && assignment.id !== removedAssignmentId,
    );
    const allCompleted = remaining.every(
      (assignment) => assignment.isCompleted,
    );

    if (!allCompleted) {
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', autoCloseAt: null },
      });
      return { approvalRequestId: null };
    }

    if (task.requiresConfirmation) {
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'awaiting_confirmation', autoCloseAt: null },
      });
      const approvalRequestId = await this.createPendingTaskApproval(
        tx,
        task,
        actorUserId,
        new Date(),
      );
      await this.writeTaskHistory(
        tx,
        task.id,
        actorUserId,
        'task.awaiting_confirmation',
        { workCycle: task.workCycle, approvalRequestId },
      );
      return { approvalRequestId };
    }

    const autoCloseAt = new Date(Date.now() + 15 * 60 * 1000);
    await tx.task.update({
      where: { id: task.id },
      data: { status: 'pending_auto_close', autoCloseAt },
    });
    await this.writeTaskHistory(
      tx,
      task.id,
      actorUserId,
      'task.auto_close_scheduled',
      { workCycle: task.workCycle, autoCloseAt: autoCloseAt.toISOString() },
    );
    return { approvalRequestId: null };
  }

  private async createPendingTaskApproval(
    tx: Prisma.TransactionClient,
    task: TaskLifecycleView,
    createdByUserId: string,
    submittedAt: Date,
  ): Promise<string> {
    const existing = await tx.approvalRequest.findFirst({
      where: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: task.id,
        status: 'pending',
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const request = await tx.approvalRequest.create({
      data: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: task.id,
        createdByUserId,
        payloadSnapshot: {
          summaryTitle: 'Подтверждение результата задачи',
          summarySubtitle: `${task.title} · ${task.object?.name ?? task.oneTimeOrder?.title ?? 'Без привязки'}`,
          taskTitle: task.title,
          objectId: task.objectId,
          oneTimeOrderId: task.oneTimeOrderId,
          workCycle: task.workCycle,
          submittedAt: submittedAt.toISOString(),
        },
      },
    });

    return request.id;
  }

  private async cancelPendingTaskApproval(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorUserId: string | null,
    reason?: string,
  ): Promise<void> {
    const pendingApprovals = await tx.approvalRequest.findMany({
      where: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: taskId,
        status: 'pending',
      },
      select: { id: true },
    });
    await tx.approvalRequest.updateMany({
      where: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: taskId,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByUserId: actorUserId,
        decisionComment: reason ?? null,
      },
    });
    for (const approval of pendingApprovals) {
      await tx.auditEvent.create({
        data: {
          entityType: 'approval_request',
          entityId: approval.id,
          actorUserId,
          action: 'approval.request.cancelled',
          newValues: {
            approvalType: TASK_RESULT_CONFIRMATION_TYPE,
            sourceEntityId: taskId,
            reason: reason ?? null,
          },
        },
      });
    }
  }

  private async auditApprovalCreated(
    approvalRequestId: string,
    taskId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: approvalRequestId,
      actorUserId,
      action: 'approval.request.created',
      newValues: {
        approvalType: TASK_RESULT_CONFIRMATION_TYPE,
        sourceEntityType: TASK_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: taskId,
      },
    });
  }

  private async lockTask(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${taskId} FOR UPDATE`;
  }

  private async loadTaskForLifecycle(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<TaskLifecycleView> {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        createdByUserId: true,
        objectId: true,
        oneTimeOrderId: true,
        requiresConfirmation: true,
        completionRequirement: true,
        workCycle: true,
        object: { select: { id: true, name: true } },
        oneTimeOrder: { select: { id: true, title: true } },
        assignees: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            userId: true,
            isActive: true,
            isCompleted: true,
            completions: {
              orderBy: { attemptNumber: 'desc' },
              select: {
                id: true,
                workCycle: true,
                attemptNumber: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  private getCurrentAssignment(
    task: TaskLifecycleView,
    userId: string,
  ): TaskLifecycleView['assignees'][number] {
    const assignment = task.assignees.find(
      (item) => item.userId === userId && item.isActive,
    );

    if (!assignment) {
      throw new ForbiddenException('Only an active assignee can complete task');
    }

    return assignment;
  }

  private getNextAttemptNumber(
    completions: TaskLifecycleView['assignees'][number]['completions'],
    workCycle: number,
  ): number {
    return (
      Math.max(
        0,
        ...completions
          .filter((completion) => completion.workCycle === workCycle)
          .map((completion) => completion.attemptNumber),
      ) + 1
    );
  }

  private assertCompletionRequirement(
    requirement: string,
    completionText: string | null,
    attachmentCount: number,
  ): void {
    const hasText = Boolean(completionText);
    const hasFile = attachmentCount > 0;

    if (requirement === 'comment_required' && !hasText) {
      throw new BadRequestException('Completion comment is required');
    }
    if (requirement === 'file_required' && !hasFile) {
      throw new BadRequestException('Completion file is required');
    }
    if (requirement === 'comment_or_file' && !hasText && !hasFile) {
      throw new BadRequestException('Completion comment or file is required');
    }
  }

  private assertAllActiveAssigneesCompleted(task: TaskLifecycleView): void {
    const activeAssignees = task.assignees.filter((item) => item.isActive);
    if (
      activeAssignees.length === 0 ||
      activeAssignees.some((item) => !item.isCompleted)
    ) {
      throw new ConflictException('Not all active assignees completed task');
    }
  }

  private assertTaskInProgress(status: string): void {
    if (status !== 'in_progress') {
      throw new ConflictException('Task is not in progress');
    }
  }

  private assertTaskCreator(
    currentUser: CurrentAuthUser,
    createdByUserId: string,
  ): void {
    if (createdByUserId !== currentUser.id) {
      throw new ForbiddenException('Only task creator can change task body');
    }
  }

  private assertLifecycleManager(
    currentUser: CurrentAuthUser,
    createdByUserId: string,
  ): void {
    if (
      createdByUserId !== currentUser.id &&
      !hasWideTaskAccess(this.getRoleCodes(currentUser))
    ) {
      throw new ForbiddenException('Task lifecycle action denied');
    }
  }

  private assertTaskMutable(status: string): void {
    if (['completed', 'cancelled', 'closed'].includes(status)) {
      throw new ConflictException('Task must be reopened before editing');
    }
  }

  private assertVisibilitySelection(
    object: { assignments: Array<{ userId: string }> } | null,
    visibilityMode: string,
    visibleUserIds: string[],
  ): void {
    if (!object && visibilityMode === 'scope') {
      throw new BadRequestException('Scope visibility requires an object linkage');
    }
    if (object && visibilityMode === 'selected') {
      const allowedUserIds = new Set(
        object.assignments.map((assignment) => assignment.userId),
      );
      if (visibleUserIds.some((userId) => !allowedUserIds.has(userId))) {
        throw new BadRequestException(
          'Selected task visibility users must be active object users',
        );
      }
    }
  }

  private normalizeReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length < 3) {
      throw new BadRequestException('Reason must contain at least 3 characters');
    }
    return normalized;
  }

  private async writeTaskHistory(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorUserId: string | null,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.taskHistoryEvent.create({
      data: { taskId, actorUserId, eventType, payload },
    });
  }

  private getAppTimeZone(): string {
    return this.configService.get<string>('APP_TIMEZONE') ?? 'Europe/Moscow';
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
          completions: {
            orderBy: [{ workCycle: 'desc' as const }, { attemptNumber: 'desc' as const }],
          },
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
    return {
      AND: [
        buildTaskAccessWhere({
          currentUserId: currentUser.id,
          roleCodes: this.getRoleCodes(currentUser),
        }),
        {
          OR: [
            { oneTimeOrderId: null },
            {
              oneTimeOrder: buildOneTimeOrderAccessWhere({
                currentUserId: currentUser.id,
                roleCodes: this.getRoleCodes(currentUser),
                permissionCodes: currentUser.permissionCodes,
              }),
            },
          ],
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

  private normalizeRequiredAssigneeUserIds(values: unknown[]): string[] {
    const userIds = normalizeTaskUserIds(Array.isArray(values) ? values : []);

    if (userIds.length === 0) {
      throw new BadRequestException('At least one task assignee is required');
    }

    if (userIds.some((userId) => !isUUID(userId, '4'))) {
      throw new BadRequestException('Task assignee IDs must be valid UUIDs');
    }

    return userIds;
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
    const allowedStatusTransitions: string[] = [];

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
    const responseStatus = task.status === 'closed' ? 'completed' : task.status;

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: responseStatus,
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
      assignees: task.assignees.map((assignee) => {
        const currentCompletion = assignee.completions.find(
          (completion) =>
            completion.workCycle === task.workCycle &&
            completion.status === 'submitted',
        );

        return {
          id: assignee.user.id,
          login: assignee.user.login,
          fullName: assignee.user.fullName,
          isActive: assignee.isActive,
          isCompleted: assignee.isCompleted,
          completedAt: assignee.completedAt
            ? assignee.completedAt.toISOString()
            : null,
          currentCompletion: currentCompletion
            ? {
                id: currentCompletion.id,
                completionText: currentCompletion.completionText,
                status: currentCompletion.status,
                submittedAt: currentCompletion.submittedAt.toISOString(),
                attachments: [],
              }
            : null,
          completionHistoryCount: assignee.completions.filter(
            (completion) => completion.status !== 'draft',
          ).length,
        };
      }),
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
        ? (() => {
            const currentCompletion = myAssignment.completions.find(
              (completion) =>
                completion.workCycle === task.workCycle &&
                completion.status === 'submitted',
            );

            return {
            assigneeId: myAssignment.id,
            isCompleted: myAssignment.isCompleted,
            completedAt: myAssignment.completedAt?.toISOString() ?? null,
              currentCompletion: currentCompletion
                ? {
                    id: currentCompletion.id,
                    completionText: currentCompletion.completionText,
                    status: currentCompletion.status,
                    submittedAt: currentCompletion.submittedAt.toISOString(),
                    attachments: [],
                  }
                : null,
            };
          })()
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

  private async attachCompletionFiles(
    task: TaskResponseDto,
  ): Promise<TaskResponseDto> {
    const completionIds = task.assignees
      .map((assignee) => assignee.currentCompletion?.id)
      .filter((id): id is string => Boolean(id));

    if (completionIds.length === 0) {
      return task;
    }

    const attachments = await this.prisma.fileAttachment.findMany({
      where: {
        entityType: 'task_assignee_completion',
        entityId: { in: completionIds },
        file: { deletedAt: null },
      },
      select: {
        entityId: true,
        file: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const filesByCompletion = new Map<
      string,
      TaskCompletionAttachmentDto[]
    >();

    for (const attachment of attachments) {
      const files = filesByCompletion.get(attachment.entityId) ?? [];
      files.push(mapSafeFileResponse(attachment.file));
      filesByCompletion.set(attachment.entityId, files);
    }

    for (const assignee of task.assignees) {
      if (assignee.currentCompletion) {
        assignee.currentCompletion.attachments =
          filesByCompletion.get(assignee.currentCompletion.id) ?? [];
      }
    }
    if (task.myAssignment?.currentCompletion) {
      task.myAssignment.currentCompletion.attachments =
        filesByCompletion.get(task.myAssignment.currentCompletion.id) ?? [];
    }

    return task;
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }
}
