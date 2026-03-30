import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateObjectDto } from './dto/create-object.dto';
import { ChangeObjectStatusDto } from './dto/change-object-status.dto';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ObjectResponseDto } from './dto/object-response.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import { hasWideObjectAccess } from './utils/object-visibility.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

@Injectable()
export class ObjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async listObjects(
    currentUser: CurrentAuthUser,
    query: ListObjectsQueryDto,
  ): Promise<ObjectResponseDto[]> {
    const roleCodes = [currentUser.roleCode];
    const wideAccess = hasWideObjectAccess(roleCodes);

    const objects = await this.prisma.object.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { internalName: { contains: query.search, mode: 'insensitive' } },
                { address: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(wideAccess
          ? {}
          : {
              assignments: {
                some: {
                  userId: currentUser.id,
                  isActive: true,
                },
              },
            }),
      },
      include: {
        assignments: {
          where: {
            isActive: true,
          },
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return objects.map((item) => this.mapObject(item));
  }

  async getObjectById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.prisma.object.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        assignments: {
          where: {
            isActive: true,
          },
          include: {
            user: true,
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    const roleCodes = [currentUser.roleCode];
    const wideAccess = hasWideObjectAccess(roleCodes);
    const isAssigned = object.assignments.some(
      (assignment) => assignment.userId === currentUser.id,
    );

    if (!wideAccess && !isAssigned) {
      throw new ForbiddenException('Access to object denied');
    }

    return this.mapObject(object);
  }

  async createObject(
    currentUser: CurrentAuthUser,
    payload: CreateObjectDto,
  ): Promise<ObjectResponseDto> {
    if (!hasWideObjectAccess([currentUser.roleCode])) {
      throw new ForbiddenException('Only wide-access roles can create objects');
    }

    const object = await this.prisma.object.create({
      data: {
        name: payload.name,
        internalName: payload.internalName ?? null,
        address: payload.address,
        status: 'active',
        seasonMode: payload.seasonMode ?? 'summer',
        notes: payload.notes ?? null,
        createdByUserId: currentUser.id,
        assignments: {
          create: [
            ...((payload.managerUserIds ?? []).map((userId) => ({
              userId,
              assignmentRoleCode: 'manager',
              isActive: true,
            }))),
            ...((payload.responsibleUserIds ?? []).map((userId) => ({
              userId,
              assignmentRoleCode: 'responsible',
              isActive: true,
            }))),
          ],
        },
      },
      include: {
        assignments: {
          where: {
            isActive: true,
          },
          include: {
            user: true,
          },
        },
      },
    });

    return this.mapObject(object);
  }

  async updateObject(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateObjectDto,
  ): Promise<ObjectResponseDto> {
    if (!hasWideObjectAccess([currentUser.roleCode])) {
      throw new ForbiddenException('Only wide-access roles can update objects');
    }

    const existing = await this.prisma.object.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundException('Object not found');
    }

    const object = await this.prisma.$transaction(async (tx) => {
      await tx.object.update({
        where: { id },
        data: {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.internalName !== undefined
            ? { internalName: payload.internalName || null }
            : {}),
          ...(payload.address !== undefined ? { address: payload.address } : {}),
          ...(payload.seasonMode !== undefined
            ? { seasonMode: payload.seasonMode }
            : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes || null } : {}),
        },
      });

      if (
        payload.managerUserIds !== undefined ||
        payload.responsibleUserIds !== undefined
      ) {
        await tx.objectAssignment.deleteMany({
          where: {
            objectId: id,
            assignmentRoleCode: {
              in: ['manager', 'responsible'],
            },
          },
        });

        const assignmentsToCreate = [
          ...((payload.managerUserIds ?? []).map((userId) => ({
            objectId: id,
            userId,
            assignmentRoleCode: 'manager',
            isActive: true,
          }))),
          ...((payload.responsibleUserIds ?? []).map((userId) => ({
            objectId: id,
            userId,
            assignmentRoleCode: 'responsible',
            isActive: true,
          }))),
        ];

        if (assignmentsToCreate.length > 0) {
          await tx.objectAssignment.createMany({
            data: assignmentsToCreate,
          });
        }
      }

      return tx.object.findFirstOrThrow({
        where: { id },
        include: {
          assignments: {
            where: {
              isActive: true,
            },
            include: {
              user: true,
            },
          },
        },
      });
    });

    return this.mapObject(object);
  }

  async changeStatus(
    currentUser: CurrentAuthUser,
    id: string,
    payload: ChangeObjectStatusDto,
  ): Promise<ObjectResponseDto> {
    if (!hasWideObjectAccess([currentUser.roleCode])) {
      throw new ForbiddenException('Only wide-access roles can change status');
    }

    const existing = await this.prisma.object.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundException('Object not found');
    }

    const object = await this.prisma.object.update({
      where: { id },
      data: {
        status: payload.status,
      },
      include: {
        assignments: {
          where: {
            isActive: true,
          },
          include: {
            user: true,
          },
        },
      },
    });

    return this.mapObject(object);
  }

  private mapObject(object: {
    id: string;
    name: string;
    internalName: string | null;
    address: string;
    status: string;
    seasonMode: string;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    assignments: Array<{
      assignmentRoleCode: string;
      user: {
        id: string;
        fullName: string;
        login: string;
      };
    }>;
  }): ObjectResponseDto {
    return {
      id: object.id,
      name: object.name,
      internalName: object.internalName,
      address: object.address,
      status: object.status,
      seasonMode: object.seasonMode,
      notes: object.notes,
      createdAt: object.createdAt.toISOString(),
      updatedAt: object.updatedAt.toISOString(),
      managers: object.assignments
        .filter((assignment) => assignment.assignmentRoleCode === 'manager')
        .map((assignment) => ({
          id: assignment.user.id,
          fullName: assignment.user.fullName,
          login: assignment.user.login,
        })),
      responsibles: object.assignments
        .filter((assignment) => assignment.assignmentRoleCode === 'responsible')
        .map((assignment) => ({
          id: assignment.user.id,
          fullName: assignment.user.fullName,
          login: assignment.user.login,
        })),
    };
  }
}
