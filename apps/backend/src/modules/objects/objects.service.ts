import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';
import {
  OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
  OBJECT_CHANGE_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import { AuditService } from '../audit/audit.service';
import { ChatsService } from '../chats/chats.service';
import { PrismaService } from '../prisma/prisma.service';

import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { CreateObjectDto } from './dto/create-object.dto';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectAuditLogResponseDto } from './dto/object-audit-log-response.dto';
import { ObjectListResponseDto } from './dto/object-list-response.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import {
  canBeObjectManager,
  canCreateObject,
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  canOverrideFrozenObject,
  hasHrObjectView,
  hasWideObjectAccess,
} from './utils/object-access.util';
import { buildObjectCapabilities } from './utils/object-capabilities.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
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
  seasonMode: string | null;
  dailyRate: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  assignments: ObjectAssignmentView[];
  employeeAssignments?: Array<{
    employee: {
      id: string;
      fullName: string;
      position: string | null;
      baseDailyRate: number | null;
      workScheduleCode: string | null;
      workScheduleCustom: string | null;
      workTimeText: string | null;
    };
  }>;
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
    private readonly chatsService: ChatsService,
  ) {}

  async listObjects(
    currentUser: CurrentAuthUser,
    query?: ListObjectsQueryDto,
  ): Promise<ObjectResponseDto[] | ObjectListResponseDto> {
    const search = (query?.q ?? query?.search ?? '').trim();
    const filters: Prisma.ObjectWhereInput[] = [
      await this.buildVisibilityWhere(currentUser),
    ];

    if (query?.status) {
      filters.push({ status: query.status });
    }

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          {
            internalName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          { address: { contains: search, mode: 'insensitive' } },
          {
            assignments: {
              some: {
                isActive: true,
                assignmentRoleCode: { in: ['responsible', 'manager'] },
                user: {
                  isActive: true,
                  deletedAt: null,
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

    const where: Prisma.ObjectWhereInput = { AND: filters };
    const shouldPaginate =
      query?.q !== undefined ||
      query?.page !== undefined ||
      query?.limit !== undefined ||
      query?.sortBy !== undefined ||
      query?.sortDirection !== undefined;

    if (!shouldPaginate) {
      const objects = (await this.prisma.object.findMany({
        where,
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
          employeeAssignments: this.getEmployeeAssignmentsInclude(),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })) as ObjectView[];

      return objects.map((item) => this.mapObject(item, currentUser));
    }

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const sortBy = query?.sortBy ?? 'updatedAt';
    const sortDirection = query?.sortDirection ?? 'desc';
    const orderBy = [
      { [sortBy]: sortDirection },
      { id: 'asc' },
    ] as Prisma.ObjectOrderByWithRelationInput[];
    const [total, objects] = await this.prisma.$transaction([
      this.prisma.object.count({ where }),
      this.prisma.object.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
          employeeAssignments: this.getEmployeeAssignmentsInclude(),
        },
      }),
    ]);

    return {
      items: (objects as ObjectView[]).map((item) =>
        this.mapObject(item, currentUser),
      ),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
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
        employeeAssignments: this.getEmployeeAssignmentsInclude(),
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
    const visibleOperationalObject = await this.prisma.object.findFirst({
      where: {
        id,
        ...this.buildOperationalVisibilityWhere(currentUser),
      },
      select: { id: true },
    });
    if (!visibleOperationalObject) {
      throw new NotFoundException('Object not found');
    }

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

    const responsibleUser = await this.getAssignableResponsibleUser(
      payload.responsibleUserId,
    );

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
          seasonMode: payload.seasonMode ?? null,
          dailyRate: payload.dailyRate ?? 0,
          notes: payload.notes ?? null,
          createdByUserId: currentUser.id,
        },
      });

      await tx.objectAssignment.create({
        data: {
          objectId: object.id,
          userId: responsibleUser.id,
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
        responsibleUserId: responsibleUser.id,
      } as Prisma.InputJsonObject,
    });

    await this.chatsService.createSystemMessage(
      'objects',
      `Создан объект: ${created.name}`,
      {
        objectId: created.id,
        status: created.status,
      },
      currentUser.id,
    );
    await this.chatsService.createSystemMessage(
      'leadership',
      `Создан объект: ${created.name}`,
      {
        objectId: created.id,
        status: created.status,
      },
      currentUser.id,
    );

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

    if (
      payload.status !== undefined &&
      payload.status !== existing.status
    ) {
      throw new BadRequestException(
        'Object status change must go through approval request flow',
      );
    }

    const currentResponsible = existing.assignments.find(
      (assignment) => assignment.assignmentRoleCode === 'responsible',
    );
    const selectedResponsible = payload.responsibleUserId
      ? await this.getAssignableResponsibleUser(payload.responsibleUserId)
      : null;

    if (!selectedResponsible && !currentResponsible) {
      throw new BadRequestException('Object responsible is required');
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

    if (
      selectedResponsible &&
      selectedResponsible.id !== currentResponsible?.user.id
    ) {
      changes.responsibleUserId = {
        oldValue: currentResponsible?.user.id ?? null,
        newValue: selectedResponsible.id,
      };
    }

    const updated = (await this.prisma.$transaction(async (tx) => {
      await tx.object.update({
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
      });

      if (selectedResponsible) {
        await tx.objectAssignment.updateMany({
          where: {
            objectId: id,
            assignmentRoleCode: 'responsible',
            isActive: true,
            userId: { not: selectedResponsible.id },
          },
          data: { isActive: false },
        });
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId: id,
              userId: selectedResponsible.id,
              assignmentRoleCode: 'responsible',
            },
          },
          update: { isActive: true },
          create: {
            objectId: id,
            userId: selectedResponsible.id,
            assignmentRoleCode: 'responsible',
            isActive: true,
          },
        });
      }

      return tx.object.findUniqueOrThrow({
        where: { id },
        include: {
          assignments: {
            where: { isActive: true },
            include: { user: true },
          },
        },
      });
    }).catch((error: unknown) =>
      this.rethrowResponsibleAssignmentError(error),
    )) as ObjectView;

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
  ): Promise<ApprovalRequestResponseDto> {
    const existing = await this.getObjectById(currentUser, id);

    if (!canManageObjectResponsibles(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Object status changing denied');
    }

    if (existing.status === payload.status) {
      throw new BadRequestException('Object already has requested status');
    }

    const pendingRequest = await this.prisma.approvalRequest.findFirst({
      where: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
        status: 'pending',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        cancelledBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    if (pendingRequest) {
      throw new ConflictException(
        'Object status change approval request is already pending',
      );
    }

    const createdRequest = await this.prisma.approvalRequest.create({
      data: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
        createdByUserId: currentUser.id,
        payloadSnapshot: {
          summaryTitle: 'Изменение объекта',
          summarySubtitle: `${existing.name} · ${existing.status} → ${payload.status}`,
          objectId: id,
          objectName: existing.name,
          currentStatus: existing.status,
          requestedStatus: payload.status,
        },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        cancelledBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    await this.auditService.writeObjectAuditLog({
      objectId: id,
      actorUserId: currentUser.id,
      actionCode: 'object.status_change_requested',
      payload: {
        oldStatus: existing.status,
        newStatus: payload.status,
        approvalRequestId: createdRequest.id,
      } as Prisma.InputJsonObject,
    });

    await this.auditService.writeAuditEvent({
      entityType: 'approval_request',
      entityId: createdRequest.id,
      actorUserId: currentUser.id,
      action: 'approval.request.created',
      newValues: {
        approvalType: OBJECT_CHANGE_CONFIRMATION_TYPE,
        sourceEntityType: OBJECT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: id,
      },
    });

    return this.mapApprovalRequest(createdRequest, currentUser.id);
  }

  async applyObjectStatusChangeApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      objectId: string;
      actorUserId: string;
      expectedCurrentStatus: string;
      nextStatus: string;
    },
  ): Promise<void> {
    const object = await tx.object.findFirst({
      where: {
        id: params.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    if (object.status !== params.expectedCurrentStatus) {
      throw new ConflictException(
        'Object status changed after approval request was created',
      );
    }

    await tx.object.update({
      where: {
        id: params.objectId,
      },
      data: {
        status: params.nextStatus,
      },
    });
  }

  async assertObjectStatusChangeApprovalStillValid(
    tx: Prisma.TransactionClient,
    params: {
      objectId: string;
    },
  ): Promise<void> {
    const object = await tx.object.findFirst({
      where: {
        id: params.objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }
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

    const user = await this.getAssignableResponsibleUser(userId);

    await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "objects"
          WHERE "id" = ${objectId}
          FOR UPDATE
        `;

        await tx.objectAssignment.updateMany({
          where: {
            objectId,
            assignmentRoleCode: 'responsible',
            isActive: true,
            userId: { not: user.id },
          },
          data: { isActive: false },
        });
        await tx.objectAssignment.upsert({
          where: {
            objectId_userId_assignmentRoleCode: {
              objectId,
              userId: user.id,
              assignmentRoleCode: 'responsible',
            },
          },
          update: {
            isActive: true,
          },
          create: {
            objectId,
            userId: user.id,
            assignmentRoleCode: 'responsible',
            isActive: true,
          },
        });
      })
      .catch((error: unknown) =>
        this.rethrowResponsibleAssignmentError(error),
      );

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
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canManageObjectResponsibles(roleCodes)) {
      throw new ForbiddenException('Manager management denied');
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
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canManageObjectResponsibles(roleCodes)) {
      throw new ForbiddenException('Manager management denied');
    }

    await this.getObjectById(currentUser, objectId);

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

  private async getAssignableResponsibleUser(userId: string): Promise<{
    id: string;
    login: string;
    fullName: string;
  }> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Selected responsible is not available');
    }

    return user;
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

    const allowedToEdit =
      canEditObject(roleCodes) ||
      (existing.status === 'frozen' && canOverrideFrozenObject(roleCodes));

    if (!allowedToEdit) {
      throw new ForbiddenException('Object editing denied');
    }

    return existing;
  }

  private async buildVisibilityWhere(currentUser: CurrentAuthUser) {
    if (hasHrObjectView(currentUser.permissionCodes)) {
      return {
        deletedAt: null,
      };
    }

    return this.buildOperationalVisibilityWhere(currentUser);
  }

  private buildOperationalVisibilityWhere(
    currentUser: CurrentAuthUser,
  ): Prisma.ObjectWhereInput {
    const roleCodes = this.getRoleCodes(currentUser);

    if (hasWideObjectAccess(roleCodes)) {
      return { deletedAt: null };
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

  private getEmployeeAssignmentsInclude() {
    return {
      where: {
        isActive: true,
        employee: { deletedAt: null },
      },
      select: {
        employee: {
          select: {
            id: true,
            fullName: true,
            position: true,
            baseDailyRate: true,
            workScheduleCode: true,
            workScheduleCustom: true,
            workTimeText: true,
          },
        },
      },
      orderBy: { employee: { fullName: 'asc' as const } },
    };
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (currentUser.roleCodes && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private mapApprovalRequest(
    request: {
      id: string;
      approvalType: string;
      sourceEntityType: string;
      sourceEntityId: string;
      status: string;
      decisionComment: string | null;
      payloadSnapshot: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
      resolvedAt: Date | null;
      cancelledAt: Date | null;
      createdBy: {
        id: string;
        login: string;
        fullName: string;
      };
      resolvedBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
      cancelledBy: {
        id: string;
        login: string;
        fullName: string;
      } | null;
    },
    currentUserId: string,
  ): ApprovalRequestResponseDto {
    const payloadSnapshot =
      request.payloadSnapshot &&
      typeof request.payloadSnapshot === 'object' &&
      !Array.isArray(request.payloadSnapshot)
        ? (request.payloadSnapshot as Prisma.JsonObject as Record<string, unknown>)
        : {};

    const summaryTitle =
      typeof payloadSnapshot.summaryTitle === 'string' &&
      payloadSnapshot.summaryTitle.trim()
        ? payloadSnapshot.summaryTitle
        : request.approvalType;
    const summarySubtitle =
      typeof payloadSnapshot.summarySubtitle === 'string' &&
      payloadSnapshot.summarySubtitle.trim()
        ? payloadSnapshot.summarySubtitle
        : null;

    return {
      id: request.id,
      approvalType: request.approvalType,
      sourceEntityType: request.sourceEntityType,
      sourceEntityId: request.sourceEntityId,
      status: request.status,
      decisionComment: request.decisionComment,
      payloadSnapshot,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      createdBy: request.createdBy,
      resolvedBy: request.resolvedBy,
      cancelledBy: request.cancelledBy,
      summary: {
        title: summaryTitle,
        subtitle: summarySubtitle,
      },
      capabilities: {
        canApprove: false,
        canReject: false,
        canCancel:
          request.status === 'pending' && request.createdBy.id === currentUserId,
      },
    };
  }

  private mapObject(
    item: ObjectView,
    currentUser: CurrentAuthUser,
  ): ObjectResponseDto {
    const mappedAssignments = item.assignments.map((assignment) => ({
      userId: assignment.user.id,
      login: assignment.user.login,
      fullName: assignment.user.fullName,
      roleCode: assignment.assignmentRoleCode,
    }));
    const roleCodes = this.getRoleCodes(currentUser);
    const responsible = mappedAssignments.find(
      (assignment) => assignment.roleCode === 'responsible',
    );

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
      responsible: responsible
        ? {
            id: responsible.userId,
            login: responsible.login,
            fullName: responsible.fullName,
          }
        : null,
      employees: (item.employeeAssignments ?? []).map(
        (assignment) => assignment.employee,
      ),
      capabilities: buildObjectCapabilities({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: currentUser.permissionCodes ?? [],
        objectStatus: item.status,
        createdByUserId: item.createdByUserId,
        assignments: mappedAssignments,
      }),
    };
  }

  private rethrowResponsibleAssignmentError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Object already has another active responsible; reload and retry',
      );
    }

    throw error;
  }
}
