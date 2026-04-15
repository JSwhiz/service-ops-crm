import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canCreateTaskOnObject } from '../tasks/utils/task-access.util';

import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { CreateObjectDto } from './dto/create-object.dto';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectAuditLogResponseDto } from './dto/object-audit-log-response.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import {
  canBeObjectManager,
  canBeObjectResponsible,
  canCreateObject,
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  canOverrideFrozenObject,
  hasWideObjectAccess,
} from './utils/object-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

interface ObjectAssignmentView {
  assignmentRoleCode: string;
  user: {
    id: string;
    login: string;
    fullName: string;
    roles?: Array<{
      role: {
        code: string;
      };
    }>;
  };
}

interface ObjectView {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string;
  dailyRate: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  assignments: ObjectAssignmentView[];
}

type AuditPrimitive = string | number | boolean | null;

type ObjectUpdateChangeSet = Record<
  string,
  {
    oldValue: AuditPrimitive;
    newValue: AuditPrimitive;
  }
>;

@Injectable()
export class ObjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listObjects(
    currentUser: CurrentAuthUser,
    query?: ListObjectsQueryDto,
  ): Promise<ObjectResponseDto[]> {
    const objects = (await this.prisma.object.findMany({
      where: {
        ...(await this.buildVisibilityWhere(currentUser)),
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                {
                  internalName: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
                { address: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })) as ObjectView[];

    return objects.map((item) => this.mapObject(item, currentUser));
  }

  async getObjectById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectResponseDto> {
    const object = (await this.prisma.object.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
    })) as ObjectView | null;

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return this.mapObject(object, currentUser);
  }

  async listObjectAuditLogs(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectAuditLogResponseDto[]> {
    await this.getObjectById(currentUser, id);

    const items = await this.auditService.listObjectAuditLogs(id);

    return items.map((item) => ({
      id: item.id,
      objectId: item.objectId,
      actionCode: item.actionCode,
      createdAt: item.createdAt.toISOString(),
      actor: {
        id: item.actor.id,
        login: item.actor.login,
        fullName: item.actor.fullName,
      },
      payload:
        item.payload && typeof item.payload === 'object'
          ? (item.payload as Record<string, unknown>)
          : null,
    }));
  }

  async createObject(
    currentUser: CurrentAuthUser,
    payload: CreateObjectDto,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canCreateObject(roleCodes)) {
      throw new ForbiddenException('Object creation denied');
    }

    const managerUserIds = Array.from(
      new Set((payload.managerUserIds ?? []).filter(Boolean)),
    ).filter((userId) => userId !== currentUser.id);

    const managerUsers =
      managerUserIds.length > 0
        ? await this.prisma.user.findMany({
            where: {
              id: { in: managerUserIds },
              isActive: true,
            },
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          })
        : [];

    if (managerUsers.length !== managerUserIds.length) {
      throw new NotFoundException(
        'One or more selected managers were not found',
      );
    }

    for (const manager of managerUsers) {
      const roleCodesOfManager = manager.roles.map((item) => item.role.code);

      if (!canBeObjectManager(roleCodesOfManager)) {
        throw new ForbiddenException('Selected user cannot be object manager');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const object = await tx.object.create({
        data: {
          name: payload.name,
          internalName: payload.internalName ?? null,
          address: payload.address,
          status: payload.status ?? 'active',
          seasonMode: payload.seasonMode ?? 'summer',
          dailyRate: payload.dailyRate ?? 0,
          notes: payload.notes ?? null,
          createdByUserId: currentUser.id,
        },
      });

      await tx.objectAssignment.create({
        data: {
          objectId: object.id,
          userId: currentUser.id,
          assignmentRoleCode: 'responsible',
          isActive: true,
        },
      });

      for (const manager of managerUsers) {
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId: object.id,
              userId: manager.id,
              assignmentRoleCode: 'manager',
            },
          },
          update: {
            isActive: true,
          },
          create: {
            objectId: object.id,
            userId: manager.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        });
      }

      return tx.object.findUniqueOrThrow({
        where: { id: object.id },
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              user: true,
            },
          },
        },
      });
    });

    await this.auditService.writeObjectAuditLog({
      objectId: created.id,
      actorUserId: currentUser.id,
      actionCode: 'object.created',
      payload: {
        name: created.name,
        internalName: created.internalName,
        address: created.address,
        status: created.status,
        seasonMode: created.seasonMode,
        dailyRate: created.dailyRate,
        managerUserIds,
        responsibleUserId: currentUser.id,
      } as Prisma.InputJsonObject,
    });

    return this.mapObject(created as ObjectView, currentUser);
  }

  async updateObject(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateObjectDto,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    const existing = await this.getEditableObject(currentUser, id);

    if (
      typeof payload.dailyRate === 'number' &&
      !canEditObjectDailyRate(roleCodes)
    ) {
      throw new ForbiddenException('Daily rate editing denied');
    }

    const changes: ObjectUpdateChangeSet = {};

    if (payload.name !== undefined && payload.name !== existing.name) {
      changes.name = {
        oldValue: existing.name,
        newValue: payload.name,
      };
    }

    if (
      payload.internalName !== undefined &&
      payload.internalName !== existing.internalName
    ) {
      changes.internalName = {
        oldValue: existing.internalName,
        newValue: payload.internalName,
      };
    }

    if (payload.address !== undefined && payload.address !== existing.address) {
      changes.address = {
        oldValue: existing.address,
        newValue: payload.address,
      };
    }

    if (
      payload.seasonMode !== undefined &&
      payload.seasonMode !== existing.seasonMode
    ) {
      changes.seasonMode = {
        oldValue: existing.seasonMode,
        newValue: payload.seasonMode,
      };
    }

    if (payload.notes !== undefined && payload.notes !== existing.notes) {
      changes.notes = {
        oldValue: existing.notes,
        newValue: payload.notes,
      };
    }

    if (
      payload.dailyRate !== undefined &&
      payload.dailyRate !== existing.dailyRate
    ) {
      changes.dailyRate = {
        oldValue: existing.dailyRate,
        newValue: payload.dailyRate,
      };
    }

    const updated = (await this.prisma.object.update({
      where: { id },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.internalName !== undefined
          ? { internalName: payload.internalName }
          : {}),
        ...(payload.address !== undefined ? { address: payload.address } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.seasonMode !== undefined
          ? { seasonMode: payload.seasonMode }
          : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.dailyRate !== undefined
          ? { dailyRate: payload.dailyRate }
          : {}),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
    })) as ObjectView;

    if (Object.keys(changes).length > 0) {
      await this.auditService.writeObjectAuditLog({
        objectId: id,
        actorUserId: currentUser.id,
        actionCode: 'object.updated',
        payload: this.buildObjectUpdateAuditPayload(changes),
      });
    }

    return this.mapObject(updated, currentUser);
  }

  async changeStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ChangeObjectStatusDto,
  ): Promise<ObjectResponseDto> {
    const existing = await this.getObjectById(currentUser, id);

    if (!canManageObjectResponsibles(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Object status changing denied');
    }

    const updated = await this.updateObject(currentUser, id, {
      status: payload.status,
    });

    if (existing.status !== payload.status) {
      await this.auditService.writeObjectAuditLog({
        objectId: id,
        actorUserId: currentUser.id,
        actionCode: 'object.status_changed',
        payload: {
          oldStatus: existing.status,
          newStatus: payload.status,
        } as Prisma.InputJsonObject,
      });
    }

    return updated;
  }

  async addResponsibleToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canManageObjectResponsibles(roleCodes)) {
      throw new ForbiddenException('Responsible management denied');
    }

    await this.getObjectById(currentUser, objectId);

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Selected user not found');
    }

    const targetRoleCodes = user.roles.map((item) => item.role.code);

    if (!canBeObjectResponsible(targetRoleCodes)) {
      throw new ForbiddenException('Selected user cannot be object responsible');
    }

    await this.prisma.objectAssignment.upsert({
      where: {
        objectId_userId_assignmentRoleCode: {
          objectId,
          userId,
          assignmentRoleCode: 'responsible',
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId,
        userId,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.responsible_added',
      payload: {
        userId: user.id,
        login: user.login,
        fullName: user.fullName,
      } as Prisma.InputJsonObject,
    });

    return this.getObjectById(currentUser, objectId);
  }

  async removeResponsibleFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canManageObjectResponsibles(roleCodes)) {
      throw new ForbiddenException('Responsible management denied');
    }

    const object = await this.getObjectById(currentUser, objectId);
    const activeResponsibles = object.responsibles;

    if (activeResponsibles.length <= 1) {
      throw new ForbiddenException(
        'At least one responsible must remain assigned to object',
      );
    }

    await this.prisma.objectAssignment.updateMany({
      where: {
        objectId,
        userId,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.responsible_removed',
      payload: {
        userId,
      } as Prisma.InputJsonObject,
    });

    return this.getObjectById(currentUser, objectId);
  }

  async addManagerToObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectById(currentUser, objectId);
    const roleCodes = this.getRoleCodes(currentUser);

    const isResponsible = object.responsibles.some(
      (responsible) => responsible.userId === currentUser.id,
    );

    if (!canManageObjectResponsibles(roleCodes) && !isResponsible) {
      throw new ForbiddenException('Manager management denied');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Selected user not found');
    }

    const targetRoleCodes = user.roles.map((item) => item.role.code);

    if (!canBeObjectManager(targetRoleCodes)) {
      throw new ForbiddenException('Selected user cannot be object manager');
    }

    await this.prisma.objectAssignment.upsert({
      where: {
        objectId_userId_assignmentRoleCode: {
          objectId,
          userId,
          assignmentRoleCode: 'manager',
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.manager_added',
      payload: {
        userId: user.id,
        login: user.login,
        fullName: user.fullName,
      } as Prisma.InputJsonObject,
    });

    return this.getObjectById(currentUser, objectId);
  }

  async removeManagerFromObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectById(currentUser, objectId);
    const roleCodes = this.getRoleCodes(currentUser);

    const isResponsible = object.responsibles.some(
      (responsible) => responsible.userId === currentUser.id,
    );

    if (!canManageObjectResponsibles(roleCodes) && !isResponsible) {
      throw new ForbiddenException('Manager management denied');
    }

    await this.prisma.objectAssignment.updateMany({
      where: {
        objectId,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.manager_removed',
      payload: {
        userId,
      } as Prisma.InputJsonObject,
    });

    return this.getObjectById(currentUser, objectId);
  }

  private buildObjectUpdateAuditPayload(
    changes: ObjectUpdateChangeSet,
  ): Prisma.InputJsonObject {
    const normalizedChanges = Object.fromEntries(
      Object.entries(changes).map(([field, value]) => [
        field,
        {
          oldValue: value.oldValue,
          newValue: value.newValue,
        },
      ]),
    );

    return {
      changes: normalizedChanges,
    } as Prisma.InputJsonObject;
  }

  private async getEditableObject(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectView> {
    const roleCodes = this.getRoleCodes(currentUser);

    const existing = (await this.prisma.object.findFirst({
      where: {
        id,
        ...(await this.buildVisibilityWhere(currentUser)),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
    })) as ObjectView | null;

    if (!existing) {
      throw new NotFoundException('Object not found');
    }

    const isAssignedResponsible = existing.assignments.some(
      (assignment) =>
        assignment.user.id === currentUser.id &&
        assignment.assignmentRoleCode === 'responsible',
    );

    const allowedToEdit =
      canEditObject(roleCodes) ||
      (isAssignedResponsible && existing.status !== 'frozen') ||
      (existing.status === 'frozen' && canOverrideFrozenObject(roleCodes));

    if (!allowedToEdit) {
      throw new ForbiddenException('Object editing denied');
    }

    return existing;
  }

  private async buildVisibilityWhere(currentUser: CurrentAuthUser) {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideObjectAccess(roleCodes)) {
      return {
        deletedAt: null,
      };
    }

    return {
      deletedAt: null,
      OR: [
        {
          createdByUserId: currentUser.id,
        },
        {
          assignments: {
            some: {
              userId: currentUser.id,
              isActive: true,
            },
          },
        },
      ],
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private mapObject(
    item: ObjectView,
    currentUser: CurrentAuthUser,
  ): ObjectResponseDto {
    const mappedAssignments = item.assignments.map((assignment) => ({
      userId: assignment.user.id,
      fullName: assignment.user.fullName,
      roleCode: assignment.assignmentRoleCode,
    }));
    const roleCodes = this.getRoleCodes(currentUser);
    const isAssignedResponsible = mappedAssignments.some(
      (assignment) =>
        assignment.userId === currentUser.id &&
        assignment.roleCode === 'responsible',
    );
    const isAssignedManager = mappedAssignments.some(
      (assignment) =>
        assignment.userId === currentUser.id && assignment.roleCode === 'manager',
    );
    const canManageResponsibles = canManageObjectResponsibles(roleCodes);
    const canEdit =
      canEditObject(roleCodes) ||
      (isAssignedResponsible && item.status !== 'frozen') ||
      (item.status === 'frozen' && canOverrideFrozenObject(roleCodes));

    return {
      id: item.id,
      name: item.name,
      internalName: item.internalName,
      address: item.address,
      status: item.status,
      seasonMode: item.seasonMode,
      dailyRate: item.dailyRate,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      managers: mappedAssignments.filter(
        (assignment) => assignment.roleCode === 'manager',
      ),
      responsibles: mappedAssignments.filter(
        (assignment) => assignment.roleCode === 'responsible',
      ),
      capabilities: {
        canEdit,
        canEditDailyRate: canEdit && canEditObjectDailyRate(roleCodes),
        canChangeStatus: canManageResponsibles,
        canManageResponsibles,
        canManageManagers: canManageResponsibles || isAssignedResponsible,
        canCreateTask: canCreateTaskOnObject({
          currentUserId: currentUser.id,
          roleCodes,
          object: {
            createdByUserId: item.createdByUserId,
            assignments: mappedAssignments.map((assignment) => ({
              userId: assignment.userId,
              assignmentRoleCode: assignment.roleCode,
            })),
          },
        }) || isAssignedManager,
      },
    };
  }
}
