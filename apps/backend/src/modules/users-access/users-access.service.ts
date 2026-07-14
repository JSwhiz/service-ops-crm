import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  canBeObjectManager,
  canCreateObject,
  canManageObjectResponsibles,
  canViewObjectByScope,
} from '../objects/utils/object-access.util';
import {
  canBeOneTimeOrderManager,
  canManageOneTimeOrderManagers,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';

import { ListSystemUsersQueryDto } from './dto/list-system-users-query.dto';
import { SystemUserOptionDto } from './dto/system-user-option.dto';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
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
        return this.listTaskAssigneeCandidates(
          currentUser,
          query.objectId,
          query.oneTimeOrderId,
        );
      case 'task_visibility':
        return this.listTaskVisibilityCandidates(
          currentUser,
          query.objectId,
          query.oneTimeOrderId,
        );
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

    return users.map((user) => this.mapUser(user));
  }

  private async listTaskAssigneeCandidates(
    currentUser: CurrentAuthUser,
    objectId?: string,
    oneTimeOrderId?: string,
  ): Promise<SystemUserOptionDto[]> {
    await this.assertTaskTargetAccess(currentUser, objectId, oneTimeOrderId);

    return (await this.getActiveUsersWithRoles()).map((user) =>
      this.mapUser(user),
    );
  }

  private async listTaskVisibilityCandidates(
    currentUser: CurrentAuthUser,
    objectId?: string,
    oneTimeOrderId?: string,
  ): Promise<SystemUserOptionDto[]> {
    const object = await this.assertTaskTargetAccess(
      currentUser,
      objectId,
      oneTimeOrderId,
    );

    if (!object) {
      return (await this.getActiveUsersWithRoles()).map((user) =>
        this.mapUser(user),
      );
    }

    const candidates = new Map<string, UserOptionSource>();

    for (const assignment of object.assignments) {
      if (assignment.user.isActive) {
        candidates.set(assignment.user.id, assignment.user);
      }
    }

    return Array.from(candidates.values())
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
      .map((user) => this.mapUser(user));
  }

  private async listOneTimeOrderManagerCandidates(
    currentUser: CurrentAuthUser,
    oneTimeOrderId?: string,
  ): Promise<SystemUserOptionDto[]> {
    const order = oneTimeOrderId
      ? await this.getOneTimeOrderWithAssignments(oneTimeOrderId)
      : null;
    const isCreator = order?.createdByUserId === currentUser.id;

    if (
      !isCreator &&
      !canManageOneTimeOrderManagers(
        this.getRoleCodes(currentUser),
        this.getPermissionCodes(currentUser),
      )
    ) {
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
    return this.listTaskAssigneeCandidates(
      currentUser,
      undefined,
      oneTimeOrderId,
    );
  }

  private async assertTaskTargetAccess(
    currentUser: CurrentAuthUser,
    objectId?: string,
    oneTimeOrderId?: string,
  ) {
    if (!currentUser.isActive) {
      throw new ForbiddenException('Task candidate access denied');
    }

    const roleCodes = this.getRoleCodes(currentUser);
    const object = objectId
      ? await this.getObjectWithAssignments(objectId)
      : null;
    const order = oneTimeOrderId
      ? await this.getOneTimeOrderWithAssignments(oneTimeOrderId)
      : null;

    if (
      object &&
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Task candidate access denied');
    }

    if (
      order &&
      !canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: this.getPermissionCodes(currentUser),
        order,
      })
    ) {
      throw new ForbiddenException('Task candidate access denied');
    }

    return object;
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
            user: {
              isActive: true,
              deletedAt: null,
            },
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
            user: {
              isActive: true,
              deletedAt: null,
            },
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

  private getPermissionCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.permissionCodes ?? [];
  }
}
