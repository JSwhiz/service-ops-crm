import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { decideAccess } from '../users-access/utils/access-policy.util';
import { taskPolicyWhere, taskVisibilityWhere } from './utils/task-policy.util';
import { isUUID } from 'class-validator';
import { resourceAccessTarget } from '../../common/access/resource-access-context';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { projectCommittedWrite, type SavedWithoutAccess } from '../../common/access/project-committed-write';
import { loadAccessSubject } from '../../common/access/notification-access';
import { resolveObjectDelegationGrants } from '../user-substitutions/resolve-object-delegation-grants.util';

import { AuditService } from '../audit/audit.service';
import {
  TASK_APPROVAL_SOURCE_ENTITY_TYPE,
  TASK_RESULT_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import {
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { canViewObjectByScope } from '../objects/utils/object-access.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  hasDelegatedTaskAction,
  hasDelegatedObjectAction,
  usedObjectDelegations,
  objectDelegationContext,
  type ObjectDelegationGrant,
} from '../user-substitutions/object-delegation.context';
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
import { TaskListResponseDto, TaskResponseDto } from './dto/task-response.dto';
import type { TaskMutationResponse } from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  buildTaskAccessWhere,
  hasWideTaskAccess,
  TASK_LEADERSHIP_ROLE_CODES,
} from './utils/task-access.util';
import { parseTaskDeadline } from './utils/task-deadline.util';
import { normalizeTaskUserIds } from './utils/task-user-ids.util';

interface CurrentAuthUser extends AccessSubject {
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
  scopeType: string;
  dueAt: Date | null;
  dueTimeSpecified: boolean;
  requiresConfirmation: boolean;
  completionRequirement: string;
  autoCloseAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  workCycle: number;
  visibilityType: string;
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

type TaskVisibilityType =
  | 'all_users'
  | 'selected_users'
  | 'target_participants'
  | 'private';

function resolveTaskScopeType(
  objectId: string | null | undefined,
  oneTimeOrderId: string | null | undefined,
  visibilityType: TaskVisibilityType,
): 'general' | 'personal' | 'object' | 'one_time_order' {
  if (oneTimeOrderId) return 'one_time_order';
  if (objectId) return 'object';
  return visibilityType === 'all_users' ? 'general' : 'personal';
}

function resolveTaskVisibilityType(params: {
  requested?: TaskVisibilityType;
  legacyMode?: 'scope' | 'selected';
  hasTarget: boolean;
  visibleUserIds: string[];
}): TaskVisibilityType {
  if (params.requested) return params.requested;
  if (params.legacyMode === 'scope' && params.hasTarget) {
    return 'target_participants';
  }
  if (params.legacyMode === 'selected' && params.visibleUserIds.length > 0) {
    return 'selected_users';
  }
  return 'private';
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
    private readonly notificationsService: NotificationsService,
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

    const items = await this.mapTasksWithDraftCapability(tasks as TaskView[], currentUser);

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

    const [item] = await this.mapTasksWithDraftCapability([task], currentUser);
    return this.attachCompletionFiles(item, currentUser);
  }

  async createTask(
    currentUser: CurrentAuthUser,
    payload: CreateTaskDto,
  ): Promise<TaskMutationResponse> {
    if (!decideAccess(currentUser, 'tasks.create', currentUser.isActive)) {
      throw new ForbiddenException('Task creation denied');
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

    if (object && !canViewObjectByScope({ currentUserId: currentUser.id, roleCodes, object, ownScopeOnly: true }) && !hasDelegatedObjectAction(currentUser.id, object.id, 'view', true, 'tasks.create')) throw new ForbiddenException('Source task creation permission denied');

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

    const visibilityType = resolveTaskVisibilityType({
      requested: payload.visibilityType,
      legacyMode: payload.visibilityMode,
      hasTarget: Boolean(object || order),
      visibleUserIds,
    });
    const scopeType = resolveTaskScopeType(
      object?.id,
      order?.id,
      visibilityType,
    );
    const visibilityMode =
      visibilityType === 'target_participants' ? 'scope' : 'selected';
    const deadline = parseTaskDeadline({
      dueDate: payload.dueDate,
      dueTime: payload.dueTime,
      timeZone: this.getAppTimeZone(),
    });

    if (!deadline.dueAt) {
      throw new BadRequestException('Task deadline is required');
    }

    if (visibilityType === 'target_participants' && !object && !order) {
      throw new BadRequestException(
        'Target participant visibility requires an object or order linkage',
      );
    }

    this.assertVisibilitySelection(object, order, visibilityType, visibleUserIds);

    const task = await this.runTaskSourceWrite(currentUser, null, payload.objectId ?? null, async (tx) => {
      const [currentObject, currentOrder] = await Promise.all([
        payload.objectId ? this.loadTaskObject(payload.objectId, tx) : null,
        payload.oneTimeOrderId ? this.loadTaskOneTimeOrder(payload.oneTimeOrderId, tx) : null,
      ]);
      if (currentObject && !canViewObjectByScope({ subject: currentUser, currentUserId: currentUser.id, roleCodes, object: currentObject })) {
        throw new ForbiddenException('Task creation denied for selected object');
      }
      if (currentObject && !canViewObjectByScope({ currentUserId: currentUser.id, roleCodes, object: currentObject, ownScopeOnly: true }) &&
        !hasDelegatedObjectAction(currentUser.id, currentObject.id, 'view', true, 'tasks.create')) {
        throw new ForbiddenException('Source task creation permission denied');
      }
      if (currentOrder && !canViewOneTimeOrderByScope({ subject: currentUser, currentUserId: currentUser.id, roleCodes, permissionCodes: currentUser.permissionCodes, order: currentOrder })) {
        throw new ForbiddenException('Task creation denied for selected one-time order');
      }
      await this.assertActiveUsers(assigneeUserIds, 'task assignees', tx);
      await this.assertActiveUsers(visibleUserIds, 'task visibility users', tx);
      const created = (await tx.task.create({
        data: {
          title: payload.title,
          description: payload.description ?? null,
          priority: payload.priority,
          status: 'in_progress',
          objectId: payload.objectId ?? null,
          oneTimeOrderId: payload.oneTimeOrderId ?? null,
          scopeType,
          createdByUserId: currentUser.id,
          requiresConfirmation: payload.requiresConfirmation ?? true,
          completionRequirement:
            payload.completionRequirement ?? 'comment_or_file',
          visibilityType,
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
        },
        include: this.getTaskInclude(),
      })) as TaskView;

      // Evaluate the same SQL visibility as GET against the real new id and its
      // staged memberships. Nothing in this graph commits on an unreadable task.
      const readable = await tx.task.findFirst({
        where: { AND: [{ id: created.id }, this.buildTaskAccessWhere(currentUser)] },
        select: { id: true },
      });
      if (!readable) throw new ForbiddenException('Task creation would produce an unreadable task');

      await tx.taskHistoryEvent.create({
        data: {
          taskId: created.id,
          actorUserId: currentUser.id,
          eventType: 'task.created',
          payload: {
            delegations: usedObjectDelegations(),
            objectId: payload.objectId ?? null,
            oneTimeOrderId: payload.oneTimeOrderId ?? null,
            assigneeUserIds,
            scopeType,
            visibilityType,
            visibilityMode,
            visibleUserIds,
          },
        },
      });

      await this.notificationsService.createForRecipients(
        {
          recipientUserIds: assigneeUserIds.filter(
            (userId) => userId !== currentUser.id,
          ),
          type: 'task.assigned',
          title: 'Назначена новая задача',
          body: created.title,
          entityType: 'task',
          entityId: created.id,
          targetUrl: `/tasks?taskId=${encodeURIComponent(created.id)}`,
          dedupeKey: `task:${created.id}:created`,
        },
        tx,
      );

      return created;
    }, { objectIds: [payload.objectId ?? null], orderIds: [payload.oneTimeOrderId ?? null] });

    return this.taskMutationResponse(currentUser, task.id);
  }

  async updateTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: UpdateTaskDto,
  ): Promise<TaskMutationResponse> {
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
    await this.assertTaskAction(this.prisma, currentUser, taskId, 'tasks.update');
    this.assertTaskCreator(currentUser, existing);
    if (
      existing.createdByUserId !== currentUser.id &&
      ((payload.objectId !== undefined &&
        payload.objectId !== existing.objectId) ||
        (payload.oneTimeOrderId !== undefined &&
          payload.oneTimeOrderId !== existing.oneTimeOrderId))
    ) {
      throw new ForbiddenException(
        'Delegated task cannot be moved outside its original context',
      );
    }
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
        subject: currentUser,
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
        subject: currentUser,
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: currentUser.permissionCodes,
        order,
      })
    ) {
      throw new ForbiddenException('Task update denied for selected order');
    }

    await this.runTaskSourceWrite(currentUser, taskId, existing.oneTimeOrderId ? null : existing.objectId, async (tx) => {
      await this.lockTaskActorAccess(tx, currentUser);
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.update');
      this.assertTaskCreator(currentUser, task);
      this.assertTaskMutable(task.status);
      if (task.objectId !== existing.objectId || task.oneTimeOrderId !== existing.oneTimeOrderId) {
        throw new ConflictException('Task target changed; reload before editing');
      }
      const [currentObject, currentOrder] = await Promise.all([
        objectId ? this.loadTaskObject(objectId, tx) : null,
        oneTimeOrderId ? this.loadTaskOneTimeOrder(oneTimeOrderId, tx) : null,
      ]);
      if (currentObject && !canViewObjectByScope({ subject: currentUser, currentUserId: currentUser.id, roleCodes, object: currentObject })) {
        throw new ForbiddenException('Task update denied for selected object');
      }
      if (currentOrder && !canViewOneTimeOrderByScope({ subject: currentUser, currentUserId: currentUser.id, roleCodes, permissionCodes: currentUser.permissionCodes, order: currentOrder })) {
        throw new ForbiddenException('Task update denied for selected order');
      }
      const lockedSnapshot = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { assignees: true, visibilityUsers: true } });
      const requestedVisibleUserIds = Array.from(
        new Set(
          payload.visibleUserIds ??
            lockedSnapshot.visibilityUsers.map((item) => item.userId),
        ),
      );
      let visibilityType = resolveTaskVisibilityType({
        requested: payload.visibilityType ??
          (!payload.visibilityMode ? lockedSnapshot.visibilityType as TaskVisibilityType : undefined),
        legacyMode: payload.visibilityMode,
        hasTarget: Boolean(currentObject || currentOrder),
        visibleUserIds: requestedVisibleUserIds,
      });
      if (visibilityType === 'target_participants' && !currentObject && !currentOrder) {
        // Removing the last target must not leave a task accidentally public or
        // make a legacy target-scoped task impossible to update.
        visibilityType = 'private';
      }
      const visibleUserIds =
        payload.visibleUserIds === undefined &&
        visibilityType !== lockedSnapshot.visibilityType
          ? []
          : requestedVisibleUserIds;
      await this.assertActiveUsers(visibleUserIds, 'task visibility users', tx);
      const scopeType = resolveTaskScopeType(currentObject?.id, currentOrder?.id, visibilityType);
      const visibilityMode =
        visibilityType === 'target_participants' ? 'scope' : 'selected';
      this.assertVisibilitySelection(currentObject, currentOrder, visibilityType, visibleUserIds);
  
      const deadline =
        payload.dueDate !== undefined || payload.dueTime !== undefined
          ? parseTaskDeadline({
              dueDate: payload.dueDate,
              dueTime: payload.dueTime,
              timeZone: this.getAppTimeZone(),
            })
          : {
              dueAt: lockedSnapshot.dueAt,
              dueTimeSpecified: lockedSnapshot.dueTimeSpecified,
            };
      if (
        !deadline.dueAt &&
        (payload.dueDate !== undefined || payload.dueTime !== undefined)
      ) {
        throw new BadRequestException('Task deadline cannot be cleared');
      }
      const nextValues = {
        title: payload.title ?? lockedSnapshot.title,
        description:
          payload.description !== undefined
            ? payload.description?.trim() || null
            : lockedSnapshot.description,
        priority: payload.priority ?? lockedSnapshot.priority,
        objectId,
        oneTimeOrderId,
        scopeType,
        requiresConfirmation:
          payload.requiresConfirmation ?? lockedSnapshot.requiresConfirmation,
        completionRequirement:
          payload.completionRequirement ?? lockedSnapshot.completionRequirement,
        visibilityType,
        dueAt: deadline.dueAt,
        dueTimeSpecified: deadline.dueTimeSpecified,
        visibilityMode,
      };
      const significantChange =
        nextValues.title !== lockedSnapshot.title ||
        nextValues.description !== lockedSnapshot.description ||
        nextValues.objectId !== lockedSnapshot.objectId ||
        nextValues.oneTimeOrderId !== lockedSnapshot.oneTimeOrderId ||
        nextValues.requiresConfirmation !== lockedSnapshot.requiresConfirmation ||
        nextValues.completionRequirement !== lockedSnapshot.completionRequirement ||
        nextValues.dueAt?.getTime() !== lockedSnapshot.dueAt?.getTime();
      const requiresReset =
        significantChange &&
        (lockedSnapshot.assignees.some(
          (assignment) => assignment.isActive && assignment.isCompleted,
        ) ||
          ['awaiting_confirmation', 'pending_auto_close'].includes(
            lockedSnapshot.status,
          ));
  
      const lockedRequiresReset = requiresReset;

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

      if (
        payload.visibleUserIds !== undefined ||
        payload.visibilityMode ||
        payload.visibilityType
      ) {
        await tx.taskVisibilityUser.deleteMany({ where: { taskId } });
        if (visibilityType === 'selected_users' && visibleUserIds.length > 0) {
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
          { scopeType, visibilityType, visibilityMode, visibleUserIds },
        );
      }

      if (!lockedRequiresReset) {
        await this.writeTaskHistory(
          tx,
          taskId,
          currentUser.id,
          'task.updated',
          {
            significantChange,
            resetCompletions: false,
          },
        );
      }

      const deadlineChanged =
        nextValues.dueAt?.getTime() !== lockedSnapshot.dueAt?.getTime();
      if (deadlineChanged) {
        await this.notificationsService.createForRecipients(
          {
            recipientUserIds: [
              ...lockedSnapshot.assignees
                .filter((assignee) => assignee.isActive)
                .map((assignee) => assignee.userId),
              lockedSnapshot.createdByUserId,
            ].filter((userId) => userId !== currentUser.id),
            type: 'task.deadline_changed',
            title: 'Изменён срок задачи',
            body: nextValues.title,
            entityType: 'task',
            entityId: taskId,
            targetUrl: `/tasks?taskId=${encodeURIComponent(taskId)}`,
            dedupeKey: `task:${taskId}:deadline:${nextValues.dueAt?.toISOString() ?? 'none'}`,
          },
          tx,
        );
      }
    }, { objectIds: [existing.objectId, objectId], orderIds: [existing.oneTimeOrderId, oneTimeOrderId] });

    return this.taskMutationResponse(currentUser, taskId);
  }

  async updateStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    await this.assertTaskAction(this.prisma, currentUser, id, 'tasks.status');
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
  ): Promise<TaskMutationResponse> {
    await this.assertTaskAction(this.prisma, currentUser, id, 'tasks.result.submit');
    return this.completeMyAssignment(currentUser, id, {
      completionText: payload.resultText,
    }, 'tasks.result.submit');
  }

  async createCompletionDraft(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<{ id: string; workCycle: number } | SavedWithoutAccess> {
    const saved = await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.read');
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.completion.draft');
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
    return this.projectCommittedTask(currentUser, async (actor) => {
      await this.assertTaskAction(this.prisma, actor, taskId, 'tasks.completion.draft');
      const current = await this.prisma.taskAssigneeCompletion.findFirst({
        where: {
          id: saved.id, status: 'draft', workCycle: saved.workCycle,
          taskAssignee: {
            taskId, userId: actor.id, isActive: true, isCompleted: false,
            task: { status: 'in_progress', workCycle: saved.workCycle },
          },
        },
        select: { id: true },
      });
      if (!current) throw new ForbiddenException('Доступ к черновику изменился');
      return saved;
    });
  }

  async completeMyAssignment(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: CompleteTaskAssignmentDto,
    compatibilityAction?: 'tasks.result.submit',
  ): Promise<TaskMutationResponse> {
    const result = await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.read');
      // /result is an internal adapter, not permission to skip either leaf.
      if (compatibilityAction) await this.assertTaskAction(tx, currentUser, taskId, compatibilityAction);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.completion.submit');
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
      await this.writeTaskHistory(
        tx,
        task.id,
        currentUser.id,
        'task.assignee_completed',
        {
          userId: currentUser.id,
          completionId: completion.id,
          workCycle: task.workCycle,
        },
      );

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
          await this.notifyTaskConfirmation(tx, task, currentUser.id);
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
            {
              workCycle: task.workCycle,
              autoCloseAt: autoCloseAt.toISOString(),
            },
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

    return this.taskMutationResponse(currentUser, taskId);
  }

  async undoMyCompletion(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskMutationResponse> {
    await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.completion.undo');
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

    return this.taskMutationResponse(currentUser, taskId);
  }

  async confirmTask(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskMutationResponse> {
    await this.completeTaskByActor(
      currentUser,
      taskId,
      'awaiting_confirmation',
      'task.confirmed',
    );
    return this.taskMutationResponse(currentUser, taskId);
  }

  async completeTaskNow(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskMutationResponse> {
    await this.completeTaskByActor(
      currentUser,
      taskId,
      'pending_auto_close',
      'task.completed_manually',
    );
    return this.taskMutationResponse(currentUser, taskId);
  }

  async returnTaskToWork(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskMutationResponse> {
    await this.resetTaskByActor(
      currentUser,
      taskId,
      ['awaiting_confirmation', 'pending_auto_close'],
      payload.reason,
      'task.returned_to_work',
    );
    return this.taskMutationResponse(currentUser, taskId);
  }

  async reopenTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskMutationResponse> {
    await this.resetTaskByActor(
      currentUser,
      taskId,
      ['completed'],
      payload.reason,
      'task.reopened',
    );
    return this.taskMutationResponse(currentUser, taskId);
  }

  async cancelTask(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: TaskReasonDto,
  ): Promise<TaskMutationResponse> {
    const reason = this.normalizeReason(payload.reason);

    await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.cancel');
      this.assertLifecycleManager(currentUser, task, 'tasks.cancel');
      if (
        ![
          'in_progress',
          'awaiting_confirmation',
          'pending_auto_close',
        ].includes(task.status)
      ) {
        throw new ConflictException(
          'Task cannot be cancelled from this status',
        );
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
      await this.writeTaskHistory(
        tx,
        task.id,
        currentUser.id,
        'task.cancelled',
        {
          reason,
          workCycle: task.workCycle,
        },
      );
    });

    return this.taskMutationResponse(currentUser, taskId);
  }

  async addAssignees(
    currentUser: CurrentAuthUser,
    taskId: string,
    payload: AddTaskAssigneesDto,
  ): Promise<TaskMutationResponse> {
    const userIds = this.normalizeRequiredAssigneeUserIds(payload.userIds);
    await this.assertActiveUsers(userIds, 'task assignees');

    await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTaskActorAccess(tx, currentUser);
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.assignees.manage');
      this.assertTaskCreator(currentUser, task, 'tasks.assignees.manage');
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

        await this.writeTaskHistory(
          tx,
          task.id,
          currentUser.id,
          'task.assignee_added',
          {
            userId,
            workCycle: task.workCycle,
          },
        );
      }

      await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', autoCloseAt: null },
      });
      await this.cancelPendingTaskApproval(tx, task.id, currentUser.id);
    });

    return this.taskMutationResponse(currentUser, taskId);
  }

  async removeAssignee(
    currentUser: CurrentAuthUser,
    taskId: string,
    userId: string,
  ): Promise<TaskMutationResponse> {
    const result = await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTaskActorAccess(tx, currentUser);
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.assignees.manage');
      this.assertTaskCreator(currentUser, task, 'tasks.assignees.manage');
      this.assertTaskMutable(task.status);
      const activeAssignees = task.assignees.filter((item) => item.isActive);
      const assignment = activeAssignees.find((item) => item.userId === userId);

      if (!assignment) {
        throw new NotFoundException('Active task assignee not found');
      }
      if (activeAssignees.length <= 1) {
        throw new ConflictException(
          'Last active task assignee cannot be removed',
        );
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
      await this.writeTaskHistory(
        tx,
        task.id,
        currentUser.id,
        'task.assignee_removed',
        {
          userId,
          workCycle: task.workCycle,
        },
      );

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

    return this.taskMutationResponse(currentUser, taskId);
  }

  async listTaskHistory(
    currentUser: CurrentAuthUser,
    taskId: string,
  ): Promise<TaskHistoryEventResponseDto[]> {
    await this.getTaskById(currentUser, taskId);
    await this.assertTaskAction(this.prisma, currentUser, taskId, 'tasks.history');
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
    await this.assertTaskAction(this.prisma, currentUser, taskId, 'tasks.history');

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
    const attachmentsByCompletion = await this.loadCompletionFiles(currentUser, taskId, completionIds);

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
    await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.read');
      this.assertLifecycleManager(currentUser, task, expectedStatus === 'awaiting_confirmation' ? 'tasks.confirm' : 'tasks.complete_now');
      await this.assertTaskAction(tx, currentUser, taskId, expectedStatus === 'awaiting_confirmation' ? 'tasks.confirm' : 'tasks.complete_now');
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

    await this.runExistingTaskWrite(currentUser, taskId, async (tx) => {
      await this.lockTask(tx, taskId);
      const task = await this.loadTaskForLifecycle(tx, taskId);
      await this.assertTaskAction(tx, currentUser, taskId, 'tasks.read');
      const actionCode = eventType === 'task.reopened' ? 'tasks.reopen' : 'tasks.return';
      this.assertLifecycleManager(currentUser, task, actionCode);
      await this.assertTaskAction(tx, currentUser, taskId, actionCode);
      if (!allowedStatuses.includes(task.status)) {
        throw new ConflictException(
          'Task cannot return to work from this status',
        );
      }

      await this.resetTaskCycle(tx, task, currentUser.id, reason, eventType);
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
      await this.cancelPendingTaskApproval(tx, task.id, actorUserId, reason);
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
      await this.notifyTaskConfirmation(tx, task, actorUserId);
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

  private async notifyTaskConfirmation(
    tx: Prisma.TransactionClient,
    task: TaskLifecycleView,
    actorUserId: string,
  ): Promise<void> {
    const leadershipUserIds =
      await this.notificationsService.listActiveUserIdsByRoles(
        [...TASK_LEADERSHIP_ROLE_CODES],
        tx,
      );
    await this.notificationsService.createForRecipients(
      {
        recipientUserIds: leadershipUserIds.filter(
          (userId) => userId !== actorUserId,
        ),
        type: 'task.awaiting_confirmation',
        title: 'Задача ожидает подтверждения',
        body: task.title,
        entityType: 'task',
        entityId: task.id,
        targetUrl: `/tasks?taskId=${encodeURIComponent(task.id)}`,
        dedupeKey: `task:${task.id}:confirmation:${task.workCycle}`,
      },
      tx,
    );
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

  private taskActionWhere(user: CurrentAuthUser, code: string): Prisma.TaskWhereInput {
    return { AND: [this.buildTaskAccessWhere(user, code), taskPolicyWhere(user, {}, code)] };
  }

  private async assertTaskAction(client: Pick<PrismaService, 'task'>, user: CurrentAuthUser, taskId: string, code: string): Promise<void> {
    const actionWhere = this.taskActionWhere(user, code);
    // A leaf grant never supplies task read. Check the current read predicate
    // on the caller's client (including its transaction), before any mutation.
    const where = code === 'tasks.read' ? actionWhere : { AND: [this.buildTaskAccessWhere(user), actionWhere] };
    const row = await client.task.findFirst({ where: { AND: [{ id: taskId }, where] }, select: { id: true } });
    if (!row) throw new ForbiddenException('Task action denied for this resource');
  }

  private async lockTask(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${taskId} FOR UPDATE`;
  }

  private lockTaskActorAccess(tx: Prisma.TransactionClient, user: CurrentAuthUser): Promise<void> {
    return lockActorAccessRevision(tx, user);
  }

  private async runExistingTaskWrite<T>(
    user: CurrentAuthUser,
    taskId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const source = await this.prisma.task.findUnique({ where: { id: taskId }, select: { objectId: true, oneTimeOrderId: true } });
    if (!source) throw new NotFoundException('Task not found');
    return this.runTaskSourceWrite(user, taskId, source.oneTimeOrderId ? null : source.objectId, async (tx) => {
      const current = await tx.task.findUnique({ where: { id: taskId }, select: { objectId: true, oneTimeOrderId: true } });
      if (!current || current.objectId !== source.objectId || current.oneTimeOrderId !== source.oneTimeOrderId) {
        throw new ConflictException('Task target changed; reload before editing');
      }
      return write(tx);
    }, { objectIds: [source.objectId], orderIds: [source.oneTimeOrderId] });
  }

  private async runTaskSourceWrite<T>(
    user: CurrentAuthUser,
    taskId: string | null,
    objectId: string | null,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
    targets?: { objectIds: Array<string | null>; orderIds: Array<string | null> },
  ): Promise<T> {
    const outer = objectDelegationContext.getStore();
    const original = outer?.actorUserId === user.id && objectId
      ? outer.grants.filter((grant) => grant.objectId === objectId) : [];
    const sourceIds = [...new Set(original.map((grant) => grant.substitutionId))].sort();
    const principalIds = [...new Set(original.map((grant) => grant.principalUserId))].sort();
    const used = new Map<string, ObjectDelegationGrant>();
    const saved = await this.prisma.$transaction(async (tx) => {
      const parentKeys = [...new Set([
        ...[objectId, ...(targets?.objectIds ?? [])].filter((id): id is string => Boolean(id)).map((id) => `object:${id}`),
        ...(targets?.orderIds ?? []).filter((id): id is string => Boolean(id)).map((id) => `order:${id}`),
      ])].sort();
      for (const key of parentKeys) {
        const [kind, id] = key.split(':');
        if (kind === 'object') await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${id} FOR SHARE`;
        else await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${id} FOR SHARE`;
      }
      if (taskId) await this.lockTask(tx, taskId);
      await this.lockTaskActorAccess(tx, user);
      if (principalIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" IN (${Prisma.join(principalIds)}) ORDER BY "id" FOR SHARE`);
      if (sourceIds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitutions" WHERE "id" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitution_objects" WHERE "objectId" = ${objectId} AND "substitutionId" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
        await tx.$queryRaw`SELECT "id" FROM "object_assignments" WHERE "objectId" = ${objectId} AND "isActive" = true ORDER BY "id" FOR SHARE`;
      }
      const grants = sourceIds.length
        ? (await resolveObjectDelegationGrants(tx, user.id)).filter((grant) => grant.objectId === objectId && sourceIds.includes(grant.substitutionId)) : [];
      return objectDelegationContext.run({ actorUserId: user.id, grants, used }, () => write(tx));
    });
    if (outer?.actorUserId === user.id && objectId) {
      for (const [key, grant] of outer.used) if (grant.objectId === objectId) outer.used.delete(key);
      for (const [key, grant] of used) outer.used.set(key, grant);
    }
    return saved;
  }

  private taskMutationResponse(user: CurrentAuthUser, id: string): Promise<TaskMutationResponse> {
    return this.projectCommittedTask(user, (actor) => this.getTaskById(actor, id));
  }

  private projectCommittedTask<T>(
    user: CurrentAuthUser,
    project: (actor: CurrentAuthUser) => Promise<T>,
  ): Promise<T | SavedWithoutAccess> {
    return projectCommittedWrite(this.prisma, user, async () => {
      const subject = await loadAccessSubject(this.prisma, user.id);
      if (!subject?.isActive) throw new ForbiddenException('Доступ к задаче изменился');
      const actor: CurrentAuthUser = {
        ...user, ...subject, isActive: true, roleCode: subject.roleCodes?.[0] ?? '',
        roleCodes: [...(subject.roleCodes ?? [])], permissionCodes: [...(subject.permissionCodes ?? [])],
      };
      const grants = await resolveObjectDelegationGrants(this.prisma, actor.id);
      return objectDelegationContext.run({ actorUserId: actor.id, grants, used: new Map() }, () => project(actor));
    });
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

  private assertTaskCreator(currentUser: CurrentAuthUser, task: { id: string; createdByUserId: string; objectId: string | null; oneTimeOrderId: string | null; assignees?: Array<{ userId: string; isActive: boolean }> }, code = 'tasks.update'): void {
    const legacy = task.createdByUserId === currentUser.id || hasDelegatedTaskAction(currentUser.id, task, 'creator', true, code);
    if (!decideAccess(currentUser, code, legacy, { resourceType: 'task', resourceId: task.id, ownerUserId: task.createdByUserId, assignedUserIds: task.assignees?.filter(a => a.isActive).map(a => a.userId) })) throw new ForbiddenException('Task author action denied');
  }

  private assertLifecycleManager(currentUser: CurrentAuthUser, task: { id: string; createdByUserId: string; objectId: string | null; oneTimeOrderId: string | null; assignees?: Array<{ userId: string; isActive: boolean }> }, code: string): void {
    const legacy = task.createdByUserId === currentUser.id || hasWideTaskAccess(this.getRoleCodes(currentUser)) || hasDelegatedTaskAction(currentUser.id, task, 'lifecycle', true, code);
    if (!decideAccess(currentUser, code, legacy, { resourceType: 'task', resourceId: task.id, ownerUserId: task.createdByUserId, assignedUserIds: task.assignees?.filter(a => a.isActive).map(a => a.userId) })) throw new ForbiddenException('Task lifecycle action denied');
  }

  private assertTaskMutable(status: string): void {
    if (['completed', 'cancelled', 'closed'].includes(status)) {
      throw new ConflictException('Task must be reopened before editing');
    }
  }

  private assertVisibilitySelection(
    object: { assignments: Array<{ userId: string }> } | null,
    order: { assignments: Array<{ userId: string }> } | null,
    visibilityType: TaskVisibilityType,
    visibleUserIds: string[],
  ): void {
    if (
      visibilityType === 'target_participants' &&
      !object &&
      !order
    ) {
      throw new BadRequestException(
        'Target participant visibility requires an object or order linkage',
      );
    }
    if (visibilityType === 'selected_users') {
      if (!visibleUserIds.length) {
        throw new BadRequestException(
          'Selected task visibility requires at least one user',
        );
      }
      const allowedUserIds = new Set([
        ...(object?.assignments.map((assignment) => assignment.userId) ?? []),
        ...(order?.assignments.map((assignment) => assignment.userId) ?? []),
      ]);
      if (
        (object || order) &&
        visibleUserIds.some((userId) => !allowedUserIds.has(userId))
      ) {
        throw new BadRequestException(
          'Selected visibility users must participate in the linked target',
        );
      }
    } else if (visibleUserIds.length) {
      throw new BadRequestException(
        'Visible users can only be set for selected_users visibility',
      );
    }
  }

  private normalizeReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length < 3) {
      throw new BadRequestException(
        'Reason must contain at least 3 characters',
      );
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
      data: {
        taskId,
        actorUserId,
        eventType,
        payload: {
          ...(payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload
            : {}),
          delegations: usedObjectDelegations(),
        },
      },
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
            orderBy: [
              { workCycle: 'desc' as const },
              { attemptNumber: 'desc' as const },
            ],
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
    policyActionCode = 'tasks.read',
  ): Prisma.TaskWhereInput {
    return taskVisibilityWhere(currentUser, buildTaskAccessWhere({
      policyActionCode,
      currentUserId: currentUser.id,
      roleCodes: this.getRoleCodes(currentUser),
    }), policyActionCode);
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
    database: Pick<Prisma.TransactionClient, 'user'> = this.prisma,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const usersCount = await database.user.count({
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

  private async loadTaskObject(objectId: string, db: Pick<PrismaService, 'object'> = this.prisma) {
    const object = await db.object.findFirst({
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

  private async loadTaskOneTimeOrder(oneTimeOrderId: string, db: Pick<PrismaService, 'oneTimeOrder'> = this.prisma) {
    const order = await db.oneTimeOrder.findUnique({
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

  private async mapTasksWithDraftCapability(tasks: TaskView[], currentUser: CurrentAuthUser): Promise<TaskResponseDto[]> {
    const eligibleIds = tasks.filter(task => task.status === 'in_progress' &&
      task.assignees.some(assignee => assignee.user.id === currentUser.id && assignee.isActive && !assignee.isCompleted))
      .map(task => task.id);
    // Reuse the draft endpoint's full visibility/action predicate, including
    // real parent scope, and its assignment/lifecycle checks. Batch, not N+1.
    const allowed = eligibleIds.length ? await this.prisma.task.findMany({
      where: { AND: [
        { id: { in: eligibleIds }, status: 'in_progress', assignees: { some: { userId: currentUser.id, isActive: true, isCompleted: false } } },
        this.taskActionWhere(currentUser, 'tasks.completion.draft'),
      ] },
      select: { id: true },
    }) : [];
    const allowedIds = new Set(allowed.map(task => task.id));
    return tasks.map(task => this.mapTask(task, currentUser, allowedIds.has(task.id)));
  }

  private mapTask(
    task: TaskView,
    currentUser: CurrentAuthUser,
    canCreateCompletionDraft = false,
  ): TaskResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const isWideAccess = hasWideTaskAccess(roleCodes);
    const creatorFor = (code: string) => task.createdBy.id === currentUser.id || hasDelegatedTaskAction(currentUser.id, task, 'creator', false, code);
    const managerFor = (code: string) => task.createdBy.id === currentUser.id || isWideAccess || hasDelegatedTaskAction(currentUser.id, task, 'lifecycle', false, code);
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
    const isTerminal = ['completed', 'cancelled', 'closed'].includes(
      task.status,
    );

    const canCompleteMyAssignment = Boolean(
      myAssignment &&
      !myAssignment.isCompleted &&
      task.status === 'in_progress',
    );
    const responseStatus = task.status === 'closed' ? 'completed' : task.status;

    const action = (code: string, legacy: boolean) => decideAccess(currentUser, code, legacy, { resourceType: 'task', resourceId: task.id, ownerUserId: task.createdBy.id, assignedUserIds: activeAssignees.map(a => a.user.id) });
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
      scopeType: task.scopeType as TaskResponseDto['scopeType'],
      visibilityType:
        task.visibilityType as TaskResponseDto['visibilityType'],
      visibilityMode:
        task.visibilityType === 'target_participants' ? 'scope' : 'selected',
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
        canSubmitResult: canCompleteMyAssignment && action('tasks.result.submit', true),
        allowedStatusTransitions,
        canEdit: !isTerminal && action('tasks.update', creatorFor('tasks.update')),
        canManageAssignees: !isTerminal && action('tasks.assignees.manage', creatorFor('tasks.assignees.manage')),
        canCompleteMyAssignment: canCompleteMyAssignment && action('tasks.completion.submit', true),
        canCreateCompletionDraft: canCompleteMyAssignment && canCreateCompletionDraft,
        canUndoMyCompletion: Boolean(myAssignment?.isCompleted && !isTerminal) && action('tasks.completion.undo', true),
        canConfirm:
          action('tasks.confirm', managerFor('tasks.confirm')) && task.status === 'awaiting_confirmation',
        canCompleteNow:
          action('tasks.complete_now', managerFor('tasks.complete_now')) && task.status === 'pending_auto_close',
        canReturnToWork:
          action('tasks.return', managerFor('tasks.return')) &&
          ['awaiting_confirmation', 'pending_auto_close'].includes(task.status),
        canReopen: task.status === 'completed' && action('tasks.reopen', managerFor('tasks.reopen')),
        canCancel:
          action('tasks.cancel', managerFor('tasks.cancel')) &&
          [
            'in_progress',
            'awaiting_confirmation',
            'pending_auto_close',
          ].includes(task.status),
        canViewHistory: action('tasks.history', true),
      },
    };
  }

  private async loadCompletionFiles(
    currentUser: CurrentAuthUser,
    taskId: string,
    completionIds: string[],
  ): Promise<Map<string, TaskCompletionAttachmentDto[]>> {
    const filesByCompletion = new Map<string, TaskCompletionAttachmentDto[]>();
    if (completionIds.length === 0) return filesByCompletion;
    // All ids were selected from this task's assignees/page. Canonical nested
    // completion resolution leads to the same task target; resolve it once per
    // batch, not once per completion/file, retaining real parent assignments.
    const [attachments, target] = await Promise.all([this.prisma.fileAttachment.findMany({
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
            uploadedByUserId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }), resourceAccessTarget(this.prisma, 'task', taskId)]);
    if (!target) return filesByCompletion;

    for (const attachment of attachments) {
      if (!decideAccess(currentUser, 'files.read', true, {
        resourceType: 'file', resourceId: attachment.file.id,
        ownerUserId: attachment.file.uploadedByUserId ?? undefined,
        assignedUserIds: target.context.assignedUserIds,
        parents: [target],
      })) continue;
      const files = filesByCompletion.get(attachment.entityId) ?? [];
      files.push(mapSafeFileResponse(attachment.file));
      filesByCompletion.set(attachment.entityId, files);
    }
    return filesByCompletion;
  }

  private async attachCompletionFiles(
    task: TaskResponseDto,
    currentUser: CurrentAuthUser,
  ): Promise<TaskResponseDto> {
    const completionIds = task.assignees
      .map((assignee) => assignee.currentCompletion?.id)
      .filter((id): id is string => Boolean(id));
    if (completionIds.length === 0) return task;
    const filesByCompletion = await this.loadCompletionFiles(currentUser, task.id, completionIds);

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
    if (
      Array.isArray(currentUser.roleCodes) &&
      currentUser.roleCodes.length > 0
    ) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }
}
