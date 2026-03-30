import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskResultDto } from './dto/submit-task-result.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { hasWideTaskAccess } from './utils/task-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(
    currentUser: CurrentAuthUser,
    query: ListTasksQueryDto,
  ): Promise<TaskResponseDto[]> {
    const wideAccess = hasWideTaskAccess([currentUser.roleCode]);

    const tasks = await this.prisma.task.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.objectId ? { objectId: query.objectId } : {}),
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
              ],
            }),
      },
      include: {
        object: true,
        createdBy: true,
        submittedBy: true,
        assignees: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return tasks.map((task) => this.mapTask(task));
  }

  async getTaskById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<TaskResponseDto> {
    const task = await this.prisma.task.findFirst({
      where: { id },
      include: {
        object: true,
        createdBy: true,
        submittedBy: true,
        assignees: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const wideAccess = hasWideTaskAccess([currentUser.roleCode]);
    const isCreator = task.createdByUserId === currentUser.id;
    const isAssignee = task.assignees.some(
      (assignee) => assignee.userId === currentUser.id,
    );

    if (!wideAccess && !isCreator && !isAssignee) {
      throw new ForbiddenException('Access to task denied');
    }

    return this.mapTask(task);
  }

  async createTask(
    currentUser: CurrentAuthUser,
    payload: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    const task = await this.prisma.task.create({
      data: {
        title: payload.title,
        description: payload.description ?? null,
        priority: payload.priority,
        status: 'assigned',
        objectId: payload.objectId,
        createdByUserId: currentUser.id,
        assignees: {
          create: payload.assigneeUserIds.map((userId) => ({
            userId,
          })),
        },
      },
      include: {
        object: true,
        createdBy: true,
        submittedBy: true,
        assignees: {
          include: {
            user: true,
          },
        },
      },
    });

    return this.mapTask(task);
  }

  async updateStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id },
      include: {
        assignees: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const wideAccess = hasWideTaskAccess([currentUser.roleCode]);
    const isCreator = existing.createdByUserId === currentUser.id;
    const isAssignee = existing.assignees.some(
      (assignee) => assignee.userId === currentUser.id,
    );

    if (!wideAccess && !isCreator && !isAssignee) {
      throw new ForbiddenException('Access to task status change denied');
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        status: payload.status,
      },
      include: {
        object: true,
        createdBy: true,
        submittedBy: true,
        assignees: {
          include: {
            user: true,
          },
        },
      },
    });

    return this.mapTask(task);
  }

  async submitResult(
    currentUser: CurrentAuthUser,
    id: string,
    payload: SubmitTaskResultDto,
  ): Promise<TaskResponseDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id },
      include: {
        assignees: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const wideAccess = hasWideTaskAccess([currentUser.roleCode]);
    const isAssignee = existing.assignees.some(
      (assignee) => assignee.userId === currentUser.id,
    );

    if (!wideAccess && !isAssignee) {
      throw new ForbiddenException('Only assignee or wide role can submit result');
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        resultText: payload.resultText,
        submittedByUserId: currentUser.id,
        submittedAt: new Date(),
        status: 'awaiting_confirmation',
      },
      include: {
        object: true,
        createdBy: true,
        submittedBy: true,
        assignees: {
          include: {
            user: true,
          },
        },
      },
    });

    return this.mapTask(task);
  }

  async listTasksByObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<TaskResponseDto[]> {
    return this.listTasks(currentUser, { objectId });
  }

  private mapTask(task: {
    id: string;
    title: string;
    description: string | null;
    priority: string;
    status: string;
    objectId: string;
    resultText: string | null;
    submittedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    object: { name: string };
    createdBy: { id: string; login: string; fullName: string };
    submittedBy: { id: string; login: string; fullName: string } | null;
    assignees: Array<{
      userId: string;
      isCompleted: boolean;
      completedAt: Date | null;
      user: { id: string; login: string; fullName: string };
    }>;
  }): TaskResponseDto {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      objectId: task.objectId,
      objectName: task.object.name,
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
    };
  }
}
