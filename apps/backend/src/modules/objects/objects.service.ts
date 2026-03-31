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
  canEditObject,
  canEditObjectDailyRate,
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
    const roleCodes = this.getRoleCodes(currentUser);

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

    return objects.map((item: ObjectView) => this.mapObject(item, roleCodes));
  }

  async getObjectById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

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

    return this.mapObject(object, roleCodes);
  }

  async createObject(
    currentUser: CurrentAuthUser,
    payload: CreateObjectDto,
  ): Promise<ObjectResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);

    const created = (await this.prisma.object.create({
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
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
      },
    })) as ObjectView;

    return this.mapObject(created, roleCodes);
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
      (assignment: ObjectAssignmentView) =>
        assignment.user.id === currentUser.id,
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

    return this.mapObject(updated, roleCodes);
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

  private mapObject(
    item: ObjectView,
    _roleCodes: string[],
  ): ObjectResponseDto {
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
      managers: item.assignments.map((assignment: ObjectAssignmentView) => ({
        userId: assignment.user.id,
        fullName: assignment.user.fullName,
        roleCode: assignment.assignmentRoleCode,
      })),
    };
  }
}
