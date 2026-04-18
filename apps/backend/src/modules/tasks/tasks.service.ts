import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  canAssignTaskToUserOnOneTimeOrder,
  canCreateTaskOnOneTimeOrder,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TaskStatus } from './types/task-status.type';
import {
  OBJECT_TASK_ASSIGNMENT_ROLE_CODES,
  canAssignTaskToUserOnObject,
  canCreateTaskOnObject,
  hasWideTaskAccess,
} from './utils/task-access.util';
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
    userId: string;
    isCompleted: boolean;
    completedAt: Date | null;
    user: { id: string; login: string; fullName: string };
  }>;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(
    currentUser: CurrentAuthUser,
    query: ListTasksQueryDto,
  ): Promise<TaskResponseDto[]> {
    const wideAccess = hasWideTaskAccess(this.getRoleCodes(currentUser));

    const tasks = (await this.prisma.task.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.objectId ? { objectId: query.objectId } : {}),
        ...(query.oneTimeOrderId
          ? { oneTimeOrderId: query.oneTimeOrderId }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.assignedToMe === 'true'
          ? {
              assignees: {
                some: {
                  userId: currentUser.id,
                },
              },
            }
          : {}),
        ...(wideAccess
          ? {}
          : {
              OR: [
                { createdByUserId: currentUser.id },
                {
                  assignees: {
                    some: {
                      userId: currentUser.id,
                    },
                  },
                },
                {
                  object: {
                    assignments: {
                      some: {
                        userId: currentUser.id,
                        isActive: true,
                        assignmentRoleCode: {
                          in: [...OBJECT_TASK_ASSIGNMENT_ROLE_CODES],
                        },
                      },
                    },
                  },
                },
                {
                  oneTimeOrder: {
                    assignments: {
                      some: {
                        userId: currentUser.id,
                        isActive: true,
                        assignmentRoleCode: 'one_time_manager',
                      },
                    },
                  },
                },
              ],
            }),
      },
      include: this.getTaskInclude(),
      orderBy: {
        createdAt: 'desc',
      },
    })) as TaskView[];

    return tasks.map((task) => this.mapTask(task, currentUser));
  }

  async getTaskById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<TaskResponseDto> {
    const task = (await this.prisma.task.findFirst({
      where: { id },
      include: this.getTaskInclude(),
    })) as TaskView | null;

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (!this.canViewTask(currentUser, task)) {
      throw new ForbiddenException('Access to task denied');
    }

    return this.mapTask(task, currentUser);
  }

  async createTask(
    currentUser: CurrentAuthUser,
    payload: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    this.assertSingleTarget(payload);

    const roleCodes = this.getRoleCodes(currentUser);
    const assigneeUserIds = Array.from(
      new Set(payload.assigneeUserIds.filter(Boolean)),
    );
    const users = await this.loadAssigneeUsers(assigneeUserIds);

    if (payload.objectId) {
      const object = await this.prisma.object.findFirst({
        where: {
          id: payload.objectId,
          deletedAt: null,
        },
        include: {
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

      if (!object) {
        throw new NotFoundException('Object for task not found');
      }

      if (
        !canCreateTaskOnObject({
          currentUserId: currentUser.id,
          roleCodes,
          object,
        })
      ) {
        throw new ForbiddenException('Task creation denied for selected object');
      }

      for (const user of users) {
        const assigneeRoleCodes = user.roles.map((item) => item.role.code);

        if (
          !canAssignTaskToUserOnObject({
            userId: user.id,
            roleCodes: assigneeRoleCodes,
            object,
          })
        ) {
          throw new ForbiddenException(
            'One or more selected assignees are not allowed for this object',
          );
        }
      }

      const task = (await this.prisma.task.create({
        data: {
          title: payload.title,
          description: payload.description ?? null,
          priority: payload.priority,
          status: 'assigned',
          objectId: payload.objectId,
          createdByUserId: currentUser.id,
          assignees: {
            create: assigneeUserIds.map((userId) => ({
              userId,
            })),
          },
        },
        include: this.getTaskInclude(),
      })) as TaskView;

      return this.mapTask(task, currentUser);
    }

    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        id: payload.oneTimeOrderId,
      },
      include: {
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

    if (
      !canCreateTaskOnOneTimeOrder({
        currentUserId: currentUser.id,
        roleCodes,
        order,
      })
    ) {
      throw new ForbiddenException(
        'Task creation denied for selected one-time order',
      );
    }

    for (const user of users) {
      const assigneeRoleCodes = user.roles.map((item) => item.role.code);

      if (
        !canAssignTaskToUserOnOneTimeOrder({
          userId: user.id,
          roleCodes: assigneeRoleCodes,
          order,
        })
      ) {
        throw new ForbiddenException(
          'One or more selected assignees are not allowed for this one-time order',
        );
      }
    }

    const task = (await this.prisma.task.create({
      data: {
        title: payload.title,
        description: payload.description ?? null,
        priority: payload.priority,
        status: 'assigned',
        oneTimeOrderId: payload.oneTimeOrderId,
        createdByUserId: currentUser.id,
        assignees: {
          create: assigneeUserIds.map((userId) => ({
            userId,
          })),
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
      (assignee) => assignee.userId === currentUser.id,
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
      (assignee) => assignee.userId === currentUser.id,
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

    const task = (await this.prisma.task.update({
      where: { id },
      data: {
        resultText: payload.resultText,
        submittedByUserId: currentUser.id,
        submittedAt: new Date(),
        status: 'awaiting_confirmation',
      },
      include: this.getTaskInclude(),
    })) as TaskView;

    return this.mapTask(task, currentUser);
  }

  async listTasksByObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<TaskResponseDto[]> {
    return this.listTasks(currentUser, { objectId });
  }

  async listTasksByOneTimeOrder(
    currentUser: CurrentAuthUser,
    oneTimeOrderId: string,
  ): Promise<TaskResponseDto[]> {
    return this.listTasks(currentUser, { oneTimeOrderId });
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
    };
  }

  private canViewTask(currentUser: CurrentAuthUser, task: TaskView): boolean {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideTaskAccess(roleCodes)) {
      return true;
    }

    if (task.createdByUserId === currentUser.id) {
      return true;
    }

    if (task.assignees.some((assignee) => assignee.userId === currentUser.id)) {
      return true;
    }

    if (
      task.object &&
      (task.object.createdByUserId === currentUser.id ||
        task.object.assignments.some(
          (assignment) => assignment.userId === currentUser.id,
        ))
    ) {
      return true;
    }

    if (
      task.oneTimeOrder &&
      canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        order: task.oneTimeOrder,
      })
    ) {
      return true;
    }

    return false;
  }

  private async loadAssigneeUsers(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
        deletedAt: null,
        isActive: true,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('One or more task assignees not found');
    }

    return users;
  }

  private assertSingleTarget(payload: CreateTaskDto): void {
    const targetCount = Number(Boolean(payload.objectId)) + Number(Boolean(payload.oneTimeOrderId));

    if (targetCount !== 1) {
      throw new BadRequestException(
        'Task must be linked to exactly one target: object or one-time order',
      );
    }
  }

  private mapTask(task: TaskView, currentUser: CurrentAuthUser): TaskResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const isWideAccess = hasWideTaskAccess(roleCodes);
    const isCreator = task.createdBy.id === currentUser.id;
    const isAssignee = task.assignees.some(
      (assignee) => assignee.user.id === currentUser.id,
    );
    const allowedStatusTransitions = getAllowedTaskStatusTransitions({
      currentStatus: task.status as TaskStatus,
      isWideAccess,
      isCreator,
      isAssignee,
    });

    const targetType = task.oneTimeOrder ? 'one_time_order' : 'object';
    const targetId = task.oneTimeOrder?.id ?? task.object?.id ?? '';
    const targetName = task.oneTimeOrder?.title ?? task.object?.name ?? '—';

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
        isCompleted: assignee.isCompleted,
        completedAt: assignee.completedAt
          ? assignee.completedAt.toISOString()
          : null,
      })),
      capabilities: {
        canSubmitResult: canSubmitTaskResult({
          currentStatus: task.status as TaskStatus,
          isWideAccess,
          isCreator,
          isAssignee,
        }),
        allowedStatusTransitions,
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
