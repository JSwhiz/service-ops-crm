import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  canBeObjectManager,
  canBeObjectResponsible,
  canCreateObject,
  canManageObjectResponsibles,
} from '../objects/utils/object-access.util';
import {
  canBeOneTimeOrderManager,
  canCreateTaskOnOneTimeOrder,
  canManageOneTimeOrderManagers,
} from '../one-time-orders/utils/one-time-order-access.util';
import {
  canAssignTaskToUserOnObject,
  canCreateTaskOnObject,
  hasWideTaskAccess,
} from '../tasks/utils/task-access.util';

import { ListSystemUsersQueryDto } from './dto/list-system-users-query.dto';
import { SystemUserOptionDto } from './dto/system-user-option.dto';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

interface UserOptionSource {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{
    role: {
      code: string;
    };
  }>;
}

@Injectable()
export class UsersAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    currentUser: CurrentAuthUser,
    query: ListSystemUsersQueryDto,
  ): Promise<SystemUserOptionDto[]> {
    switch (query.purpose) {
      case 'object_manager':
        return this.listObjectManagerCandidates(currentUser, query.objectId);
      case 'object_responsible':
        return this.listObjectResponsibleCandidates(currentUser, query.objectId);
      case 'task_assignee':
        return this.listTaskAssigneeCandidates(currentUser, query.objectId);
      case 'one_time_order_manager':
        return this.listOneTimeOrderManagerCandidates(
          currentUser,
          query.oneTimeOrderId,
        );
      case 'one_time_order_task_assignee':
        return this.listOneTimeOrderTaskAssigneeCandidates(
          currentUser,
          query.oneTimeOrderId,
        );
      case 'chat_participant':
        return this.listChatParticipantCandidates(currentUser);
      default:
        throw new ForbiddenException('Scoped user listing purpose is required');
    }
  }

  private async listObjectManagerCandidates(
    currentUser: CurrentAuthUser,
    objectId?: string,
  ): Promise<SystemUserOptionDto[]> {
    if (objectId) {
      const object = await this.getObjectWithAssignments(objectId);
      const roleCodes = this.getRoleCodes(currentUser);
      const isResponsible = object.assignments.some(
        (assignment) =>
          assignment.userId === currentUser.id &&
          assignment.assignmentRoleCode === 'responsible',
      );

      if (!canManageObjectResponsibles(roleCodes) && !isResponsible) {
        throw new ForbiddenException('Manager candidate access denied');
      }
    } else if (!canCreateObject(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Manager candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users
      .filter((user) =>
        canBeObjectManager(user.roles.map((item) => item.role.code)),
      )
      .map((user) => this.mapUser(user));
  }

  private async listObjectResponsibleCandidates(
    currentUser: CurrentAuthUser,
    objectId?: string,
  ): Promise<SystemUserOptionDto[]> {
    if (objectId) {
      await this.getObjectWithAssignments(objectId);
    }

    if (!canManageObjectResponsibles(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Responsible candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users
      .filter((user) =>
        canBeObjectResponsible(user.roles.map((item) => item.role.code)),
      )
      .map((user) => this.mapUser(user));
  }

  private async listTaskAssigneeCandidates(
    currentUser: CurrentAuthUser,
    objectId?: string,
  ): Promise<SystemUserOptionDto[]> {
    if (!objectId) {
      throw new ForbiddenException('Task assignee candidates require object id');
    }

    const object = await this.getObjectWithAssignments(objectId);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      !canCreateTaskOnObject({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Task assignee candidate access denied');
    }

    const objectUsers = object.assignments
      .filter((assignment) =>
        canAssignTaskToUserOnObject({
          userId: assignment.user.id,
          roleCodes: assignment.user.roles.map((item) => item.role.code),
          object,
        }),
      )
      .map((assignment) => assignment.user);

    const wideUsers = await this.getActiveUsersWithRoles();
    const candidateMap = new Map<string, UserOptionSource>();

    for (const user of objectUsers) {
      candidateMap.set(user.id, user);
    }

    for (const user of wideUsers) {
      const userRoleCodes = user.roles.map((item) => item.role.code);

      if (hasWideTaskAccess(userRoleCodes)) {
        candidateMap.set(user.id, user);
      }
    }

    return Array.from(candidateMap.values())
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
      .map((user) => this.mapUser(user));
  }

  private async listOneTimeOrderManagerCandidates(
    currentUser: CurrentAuthUser,
    oneTimeOrderId?: string,
  ): Promise<SystemUserOptionDto[]> {
    if (oneTimeOrderId) {
      await this.getOneTimeOrderWithAssignments(oneTimeOrderId);
    }

    if (!canManageOneTimeOrderManagers(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('One-time order manager candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users
      .filter((user) =>
        canBeOneTimeOrderManager(user.roles.map((item) => item.role.code)),
      )
      .map((user) => this.mapUser(user));
  }

  private async listOneTimeOrderTaskAssigneeCandidates(
    currentUser: CurrentAuthUser,
    oneTimeOrderId?: string,
  ): Promise<SystemUserOptionDto[]> {
    if (!oneTimeOrderId) {
      throw new ForbiddenException(
        'One-time order task assignee candidates require order id',
      );
    }

    const order = await this.getOneTimeOrderWithAssignments(oneTimeOrderId);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      !canCreateTaskOnOneTimeOrder({
        currentUserId: currentUser.id,
        roleCodes,
        order,
      })
    ) {
      throw new ForbiddenException(
        'One-time order task assignee candidate access denied',
      );
    }

    const candidateMap = new Map<string, UserOptionSource>();

    for (const assignment of order.assignments) {
      const userRoleCodes = assignment.user.roles.map((item) => item.role.code);

      if (
        assignment.assignmentRoleCode === 'one_time_manager' &&
        canBeOneTimeOrderManager(userRoleCodes)
      ) {
        candidateMap.set(assignment.user.id, assignment.user);
      }
    }

    const wideUsers = await this.getActiveUsersWithRoles();

    for (const user of wideUsers) {
      if (hasWideTaskAccess(user.roles.map((item) => item.role.code))) {
        candidateMap.set(user.id, user);
      }
    }

    return Array.from(candidateMap.values())
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
      .map((user) => this.mapUser(user));
  }

  private async listChatParticipantCandidates(
    currentUser: CurrentAuthUser,
  ): Promise<SystemUserOptionDto[]> {
    if (!currentUser.isActive) {
      throw new ForbiddenException('Chat participant candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users.map((user) => this.mapUser(user));
  }

  private async getActiveUsersWithRoles(): Promise<UserOptionSource[]> {
    return this.prisma.user.findMany({
      where: {
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
      orderBy: {
        fullName: 'asc',
      },
    });
  }

  private async getObjectWithAssignments(objectId: string) {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
            assignmentRoleCode: true,
            user: {
              select: {
                id: true,
                login: true,
                fullName: true,
                isActive: true,
                roles: {
                  select: {
                    role: {
                      select: {
                        code: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return object;
  }

  private async getOneTimeOrderWithAssignments(oneTimeOrderId: string) {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: {
        id: oneTimeOrderId,
      },
      select: {
        createdByUserId: true,
        assignments: {
          where: {
            isActive: true,
          },
          select: {
            userId: true,
            assignmentRoleCode: true,
            isActive: true,
            user: {
              select: {
                id: true,
                login: true,
                fullName: true,
                isActive: true,
                roles: {
                  select: {
                    role: {
                      select: {
                        code: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    return order;
  }

  private mapUser(user: UserOptionSource): SystemUserOptionDto {
    const roleCodes = user.roles.map((item) => item.role.code);

    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCode: roleCodes[0] ?? 'unknown',
      roleCodes,
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }
}
