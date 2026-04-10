import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { CreateObjectDto } from './dto/create-object.dto';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import {
  canAssignObjectResponsible,
  canBeObjectManager,
  canBeObjectResponsible,
  canCreateObject,
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectManagers,
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
    fullName: string;
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
  assignments: ObjectAssignmentView[];
}

@Injectable()
export class ObjectsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return objects.map((item) => this.mapObject(item));
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

    return this.mapObject(object);
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
              deletedAt: null,
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

    for (const user of managerUsers) {
      const candidateRoleCodes = user.roles.map((item) => item.role.code);

      if (!canBeObjectManager(candidateRoleCodes)) {
        throw new ForbiddenException(
          `User ${user.fullName} cannot be assigned as object manager`,
        );
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

    return this.mapObject(created as ObjectView);
  }

  async updateObject(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateObjectDto,
  ): Promise<ObjectResponseDto> {
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

    const isAssignedManager = existing.assignments.some(
      (assignment) => assignment.user.id === currentUser.id,
    );

    const allowedToEdit =
      canEditObject(roleCodes) ||
      (isAssignedManager && existing.status !== 'frozen') ||
      (existing.status === 'frozen' && canOverrideFrozenObject(roleCodes));

    if (!allowedToEdit) {
      throw new ForbiddenException('Object editing denied');
    }

    const oldDailyRate = existing.dailyRate;
    const newDailyRate =
      typeof payload.dailyRate === 'number' ? payload.dailyRate : oldDailyRate;

    if (
      typeof payload.dailyRate === 'number' &&
      !canEditObjectDailyRate(roleCodes)
    ) {
      throw new ForbiddenException('Daily rate editing denied');
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

    if (newDailyRate !== oldDailyRate) {
      await this.syncDailyRateToTimesheets(id, newDailyRate);
    }

    return this.mapObject(updated);
  }

  async changeStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ChangeObjectStatusDto,
  ): Promise<ObjectResponseDto> {
    return this.updateObject(currentUser, id, {
      status: payload.status,
    });
  }

  async assignResponsible(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canAssignObjectResponsible(roleCodes)) {
      throw new ForbiddenException(
        'Only leadership circle can assign responsibles',
      );
    }

    const object = await this.getObjectEntityForAssignment(objectId);

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
      throw new NotFoundException('User not found');
    }

    const candidateRoleCodes = user.roles.map((item) => item.role.code);

    if (!canBeObjectResponsible(candidateRoleCodes)) {
      throw new ForbiddenException(
        'Selected user cannot be assigned as object responsible',
      );
    }

    await this.prisma.objectAssignment.upsert({
      where: {
        objectId_userId_assignmentRoleCode: {
          objectId: object.id,
          userId,
          assignmentRoleCode: 'responsible',
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId: object.id,
        userId,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
    });

    return this.getObjectById(currentUser, object.id);
  }

  async removeResponsible(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canAssignObjectResponsible(roleCodes)) {
      throw new ForbiddenException(
        'Only leadership circle can remove responsibles',
      );
    }

    const object = await this.getObjectEntityForAssignment(objectId);

    const activeResponsibles = await this.prisma.objectAssignment.findMany({
      where: {
        objectId: object.id,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
    });

    const target = activeResponsibles.find((item) => item.userId === userId);

    if (!target) {
      throw new NotFoundException('Responsible assignment not found');
    }

    if (activeResponsibles.length <= 1) {
      throw new ForbiddenException(
        'Object must have at least one active responsible',
      );
    }

    await this.prisma.objectAssignment.update({
      where: {
        id: target.id,
      },
      data: {
        isActive: false,
      },
    });

    return this.getObjectById(currentUser, object.id);
  }

  async assignManager(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectEntityForAssignment(objectId);

    await this.assertCanManageManagers(currentUser, object.id);

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
      throw new NotFoundException('User not found');
    }

    const candidateRoleCodes = user.roles.map((item) => item.role.code);

    if (!canBeObjectManager(candidateRoleCodes)) {
      throw new ForbiddenException(
        'Selected user cannot be assigned as object manager',
      );
    }

    await this.prisma.objectAssignment.upsert({
      where: {
        objectId_userId_assignmentRoleCode: {
          objectId: object.id,
          userId,
          assignmentRoleCode: 'manager',
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId: object.id,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    });

    return this.getObjectById(currentUser, object.id);
  }

  async removeManager(
    currentUser: CurrentAuthUser,
    objectId: string,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectEntityForAssignment(objectId);

    await this.assertCanManageManagers(currentUser, object.id);

    const managerAssignment = await this.prisma.objectAssignment.findFirst({
      where: {
        objectId: object.id,
        userId,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    });

    if (!managerAssignment) {
      throw new NotFoundException('Manager assignment not found');
    }

    await this.prisma.objectAssignment.update({
      where: {
        id: managerAssignment.id,
      },
      data: {
        isActive: false,
      },
    });

    return this.getObjectById(currentUser, object.id);
  }

  private async assertCanManageManagers(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<void> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (canManageObjectManagers(roleCodes)) {
      return;
    }

    const responsibleAssignment = await this.prisma.objectAssignment.findFirst({
      where: {
        objectId,
        userId: currentUser.id,
        assignmentRoleCode: 'responsible',
        isActive: true,
      },
    });

    if (!responsibleAssignment) {
      throw new ForbiddenException(
        'Only object responsible or leadership circle can manage managers',
      );
    }
  }

  private async getObjectEntityForAssignment(objectId: string): Promise<{ id: string }> {
    const object = await this.prisma.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return object;
  }

  private async syncDailyRateToTimesheets(
    objectId: string,
    dailyRate: number,
  ): Promise<void> {
    const months = await this.prisma.timesheetMonth.findMany({
      where: {
        objectId,
      },
      include: {
        rows: true,
      },
    });

    for (const month of months) {
      for (const row of month.rows) {
        await this.prisma.timesheetDayEntry.updateMany({
          where: {
            rowId: row.id,
            isChangedManually: false,
          },
          data: {
            dayValue: dailyRate,
          },
        });
      }
    }
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

  private mapObject(item: ObjectView): ObjectResponseDto {
    const mappedAssignments = item.assignments.map((assignment) => ({
      userId: assignment.user.id,
      fullName: assignment.user.fullName,
      roleCode: assignment.assignmentRoleCode,
    }));

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
    };
  }
}
