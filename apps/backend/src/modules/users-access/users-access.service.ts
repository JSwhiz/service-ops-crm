import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { hasDelegatedObjectAction } from '../user-substitutions/object-delegation.context';
import {
  canBeObjectManager,
  canCreateObject,
  canManageObjectResponsibles,
  canViewObjectByScope,
  buildObjectBasicProfileAccessWhere,
} from '../objects/utils/object-access.util';
import {
  canBeOneTimeOrderManager,
  canManageOneTimeOrderManagers,
  ONE_TIME_ORDER_MANAGER_ROLE_CODES,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';

import { ListSystemUsersQueryDto } from './dto/list-system-users-query.dto';
import { SystemUserOptionDto } from './dto/system-user-option.dto';
import { AccessRule, decideAccess, hasModuleDeny } from './utils/access-policy.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  accessRules?: AccessRule[];
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
          query.q,
          query.selectedId,
          query.limit,
        );
      case 'one_time_order_task_assignee':
        return this.listOneTimeOrderTaskAssigneeCandidates(
          currentUser,
          query.oneTimeOrderId,
        );
      case 'one_time_order_payment_recipient':
        return this.listOneTimeOrderPaymentRecipientCandidates(
          currentUser,
          query.oneTimeOrderId,
          query.q,
          query.selectedId,
          query.limit,
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
      await this.assertObjectTeamCandidateAccess(currentUser, objectId, 'objects.managers.manage');
    } else if (!this.canListNewObjectCandidates(currentUser, 'objects.managers.manage')) {
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
      await this.assertObjectTeamCandidateAccess(currentUser, objectId, 'objects.responsibles.manage');
    } else if (!this.canListNewObjectCandidates(currentUser, 'objects.responsibles.manage')) {
      throw new ForbiddenException('Responsible candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users.map((user) => this.mapUser(user));
  }

  private async assertObjectTeamCandidateAccess(currentUser: CurrentAuthUser, objectId: string, action: 'objects.managers.manage' | 'objects.responsibles.manage'): Promise<void> {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: { createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } } },
    });
    if (!object) throw new ForbiddenException('Object team candidate access denied');
    const context = { resourceType: 'object', resourceId: objectId, ownerUserId: object.createdByUserId, assignedUserIds: object.assignments.map(assignment => assignment.userId) };
    const legacy = canManageObjectResponsibles(this.getRoleCodes(currentUser));
    if (!decideAccess(currentUser, action, legacy, context) &&
        !decideAccess(currentUser, action, hasDelegatedObjectAction(currentUser.id, objectId, 'assign', true, action, context), context)) {
      throw new ForbiddenException('Object team candidate access denied');
    }
    const visible = await this.prisma.object.findFirst({ where: { id: objectId, ...buildObjectBasicProfileAccessWhere({
      subject: currentUser, roleCodes: this.getRoleCodes(currentUser), permissionCodes: this.getPermissionCodes(currentUser),
    }) }, select: { id: true } });
    if (!visible) throw new NotFoundException('Object not found');
  }

  private canListNewObjectCandidates(currentUser: CurrentAuthUser, action: 'objects.managers.manage' | 'objects.responsibles.manage'): boolean {
    const context = { resourceType: 'object' as const, ownerUserId: currentUser.id };
    return decideAccess(currentUser, 'objects.create', canCreateObject(this.getRoleCodes(currentUser))) &&
      decideAccess(currentUser, 'objects.read', true, context) &&
      decideAccess(currentUser, action, true, context);
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
    search?: string,
    selectedId?: string,
    limit = 20,
  ): Promise<SystemUserOptionDto[]> {
    const order = oneTimeOrderId
      ? await this.getOneTimeOrderWithAssignments(oneTimeOrderId)
      : null;
    const isCreator = order?.createdByUserId === currentUser.id;
    const orderContext = order ? { resourceType: 'one_time_order', resourceId: order.id, ownerUserId: order.createdByUserId,
      assignedUserIds: order.assignments.filter(assignment => assignment.assignmentRoleCode === 'one_time_manager').map(assignment => assignment.userId) } : {};
    const legacy = isCreator || canManageOneTimeOrderManagers(this.getRoleCodes(currentUser), this.getPermissionCodes(currentUser));
    if (order) {
      if (!decideAccess(currentUser, 'one_time_orders.read', true, orderContext) ||
          !decideAccess(currentUser, 'one_time_orders.managers.manage', legacy, orderContext)) {
        throw new ForbiddenException('One-time order manager candidate access denied');
      }
      if (!canViewOneTimeOrderByScope({ subject: currentUser, currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser), permissionCodes: this.getPermissionCodes(currentUser), order })) {
        throw new NotFoundException('One-time order not found');
      }
    } else if (hasModuleDeny(currentUser, 'one_time_orders.read') || !legacy) {
      // New-order/copy picker has its own existing role baseline and no ID.
      throw new ForbiddenException('One-time order manager candidate access denied');
    }

    const query = search?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        roles: {
          some: {
            role: {
              code: {
                in: [...ONE_TIME_ORDER_MANAGER_ROLE_CODES],
              },
            },
          },
        },
        ...(selectedId || query
          ? {
              OR: [
                ...(selectedId ? [{ id: selectedId }] : []),
                ...(query
                  ? [
                      {
                        OR: [
                          {
                            fullName: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                          {
                            login: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }
          : {}),
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: Math.min(limit, 50),
    });

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

  private async listOneTimeOrderPaymentRecipientCandidates(
    currentUser: CurrentAuthUser,
    oneTimeOrderId?: string,
    search?: string,
    selectedId?: string,
    limit = 20,
  ): Promise<SystemUserOptionDto[]> {
    if (!oneTimeOrderId) {
      throw new ForbiddenException('One-time order payment recipient scope is required');
    }

    const order = await this.getOneTimeOrderWithAssignments(oneTimeOrderId);
    if (
      !canViewOneTimeOrderByScope({
        subject: currentUser,
        currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: this.getPermissionCodes(currentUser),
        order,
      })
    ) {
      throw new ForbiddenException('Payment recipient candidate access denied');
    }

    const query = search?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(selectedId || query
          ? {
              OR: [
                ...(selectedId ? [{ id: selectedId }] : []),
                ...(query
                  ? [
                      {
                        OR: [
                          {
                            fullName: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                          {
                            login: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }
          : {}),
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: Math.min(limit, 50),
    });

    return users.map((user) => this.mapUser(user));
  }

  private async assertTaskTargetAccess(
    currentUser: CurrentAuthUser,
    objectId?: string,
    oneTimeOrderId?: string,
  ) {
    if (!currentUser.isActive || hasModuleDeny(currentUser, 'tasks.access')) {
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
        subject: currentUser,
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
        subject: currentUser,
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
    if (!currentUser.isActive || hasModuleDeny(currentUser, 'chat.access')) {
      throw new ForbiddenException('Chat participant candidate access denied');
    }

    const users = await this.getActiveUsersWithRoles();

    return users.map((user) => this.mapUser(user));
  }

  private async getActiveUsersWithRoles(params?: {
    search?: string;
    selectedId?: string;
    limit?: number;
  }): Promise<UserOptionSource[]> {
    const query = params?.search?.trim();
    const selectedId = params?.selectedId;
    const shouldBound = params !== undefined;

    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(selectedId || query
          ? {
              OR: [
                ...(selectedId ? [{ id: selectedId }] : []),
                ...(query
                  ? [
                      {
                        OR: [
                          {
                            fullName: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                          {
                            login: {
                              contains: query,
                              mode: 'insensitive' as const,
                            },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }
          : {}),
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      ...(shouldBound ? { take: Math.min(params?.limit ?? 20, 50) } : {}),
    });
  }

  private async getObjectWithAssignments(objectId: string) {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
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
        id: true,
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
