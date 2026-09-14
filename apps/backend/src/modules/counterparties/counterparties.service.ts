import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { canViewObjectBasicProfile } from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';

import {
  CounterpartyCardResponseDto,
  CounterpartyListResponseDto,
  CounterpartyReferenceDto,
} from './dto/counterparty-response.dto';
import {
  CreateCounterpartyDto,
  UpdateCounterpartyDto,
} from './dto/counterparty-mutations.dto';
import {
  ListCounterpartiesQueryDto,
  ListCounterpartyReferencesQueryDto,
} from './dto/list-counterparties-query.dto';
import {
  canLinkCounterpartyObjects,
  canManageCounterparties,
  canViewCounterparties,
} from './utils/counterparty-access.util';

interface CurrentAuthUser {
  id: string;
  roleCode?: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

const objectInclude = {
  assignments: {
    where: { isActive: true },
    select: { userId: true, isActive: true },
  },
} as const;

@Injectable()
export class CounterpartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    currentUser: CurrentAuthUser,
    query: ListCounterpartiesQueryDto,
  ): Promise<CounterpartyListResponseDto> {
    this.assertView(currentUser);
    const q = query.q?.trim();
    const where: Prisma.CounterpartyWhereInput = {
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { legalName: { contains: q, mode: 'insensitive' } },
              { contactName: { contains: q, mode: 'insensitive' } },
              { contactPhone: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { _count: { select: { objects: true } } },
      }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        legalName: item.legalName,
        contactName: item.contactName,
        contactPhone: item.contactPhone,
        status: item.status,
        objectCount: item._count.objects,
        updatedAt: item.updatedAt.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  async listReferences(
    currentUser: CurrentAuthUser,
    query: ListCounterpartyReferencesQueryDto,
  ): Promise<CounterpartyReferenceDto[]> {
    this.assertView(currentUser);
    const q = query.q?.trim();

    const rows = await this.prisma.counterparty.findMany({
      where: {
        ...(query.selectedId || q
          ? {
              OR: [
                ...(query.selectedId ? [{ id: query.selectedId }] : []),
                ...(q
                  ? [
                      {
                        status: 'active',
                        OR: [
                          { name: { contains: q, mode: 'insensitive' as const } },
                          {
                            legalName: {
                              contains: q,
                              mode: 'insensitive' as const,
                            },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }
          : { status: 'active' }),
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        status: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: Math.min(query.limit, 50),
    });

    return rows;
  }

  async getById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertView(currentUser);
    const counterparty = await this.prisma.counterparty.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, login: true, fullName: true },
        },
        objects: {
          where: { deletedAt: null },
          include: objectInclude,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
        _count: { select: { objects: true } },
      },
    });
    if (!counterparty) {
      throw new NotFoundException('Counterparty not found');
    }

    const visibleObjects = counterparty.objects.filter((object) =>
      canViewObjectBasicProfile({
        currentUserId: currentUser.id,
        roleCodes: this.roleCodes(currentUser),
        permissionCodes: this.permissions(currentUser),
        object,
      }),
    );

    return {
      id: counterparty.id,
      name: counterparty.name,
      legalName: counterparty.legalName,
      contactName: counterparty.contactName,
      contactPhone: counterparty.contactPhone,
      notes: counterparty.notes,
      status: counterparty.status,
      objectCount: counterparty._count.objects,
      visibleObjectCount: visibleObjects.length,
      updatedAt: counterparty.updatedAt.toISOString(),
      createdAt: counterparty.createdAt.toISOString(),
      createdBy: counterparty.createdBy,
      objects: visibleObjects.map((object) => ({
        id: object.id,
        name: object.name,
        internalName: object.internalName,
        address: object.address,
        status: object.status,
      })),
      capabilities: {
        canManage: canManageCounterparties(this.permissions(currentUser)),
        canLinkObjects: canLinkCounterpartyObjects(this.permissions(currentUser)),
      },
    };
  }

  async create(
    currentUser: CurrentAuthUser,
    payload: CreateCounterpartyDto,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertManage(currentUser);
    const created = await this.prisma.counterparty.create({
      data: {
        name: payload.name,
        legalName: payload.legalName || null,
        contactName: payload.contactName || null,
        contactPhone: payload.contactPhone || null,
        notes: payload.notes || null,
        createdByUserId: currentUser.id,
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'counterparty',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'counterparty.created',
      newValues: this.snapshot(created),
    });

    return this.getById(currentUser, created.id);
  }

  async update(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateCounterpartyDto,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertManage(currentUser);
    const existing = await this.prisma.counterparty.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Counterparty not found');
    }

    const updated = await this.prisma.counterparty.update({
      where: { id },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.legalName !== undefined
          ? { legalName: payload.legalName || null }
          : {}),
        ...(payload.contactName !== undefined
          ? { contactName: payload.contactName || null }
          : {}),
        ...(payload.contactPhone !== undefined
          ? { contactPhone: payload.contactPhone || null }
          : {}),
        ...(payload.notes !== undefined
          ? { notes: payload.notes || null }
          : {}),
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'counterparty',
      entityId: id,
      actorUserId: currentUser.id,
      action: 'counterparty.updated',
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
    });

    return this.getById(currentUser, id);
  }

  async setArchived(
    currentUser: CurrentAuthUser,
    id: string,
    archived: boolean,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertManage(currentUser);
    const existing = await this.prisma.counterparty.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Counterparty not found');
    }
    const nextStatus = archived ? 'archived' : 'active';
    if (existing.status !== nextStatus) {
      await this.prisma.counterparty.update({
        where: { id },
        data: { status: nextStatus },
      });
      await this.auditService.writeAuditEvent({
        entityType: 'counterparty',
        entityId: id,
        actorUserId: currentUser.id,
        action: archived ? 'counterparty.archived' : 'counterparty.restored',
        oldValues: { status: existing.status },
        newValues: { status: nextStatus },
      });
    }
    return this.getById(currentUser, id);
  }

  async linkObject(
    currentUser: CurrentAuthUser,
    id: string,
    objectId: string,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertLink(currentUser);
    const counterparty = await this.prisma.counterparty.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!counterparty) {
      throw new NotFoundException('Counterparty not found');
    }
    if (counterparty.status !== 'active') {
      throw new BadRequestException('Archived counterparty cannot accept new objects');
    }

    const object = await this.loadLinkableObject(currentUser, objectId);
    const previousCounterpartyId = object.counterpartyId;
    if (previousCounterpartyId === id) {
      return this.getById(currentUser, id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.object.update({
        where: { id: objectId },
        data: { counterpartyId: id },
      });
      await this.auditService.writeAuditEvent(
        {
          entityType: 'counterparty',
          entityId: id,
          actorUserId: currentUser.id,
          action: 'counterparty.object_linked',
          oldValues: previousCounterpartyId
            ? { previousCounterpartyId }
            : null,
          newValues: { objectId },
        },
        tx,
      );
      if (previousCounterpartyId) {
        await this.auditService.writeAuditEvent(
          {
            entityType: 'counterparty',
            entityId: previousCounterpartyId,
            actorUserId: currentUser.id,
            action: 'counterparty.object_unlinked_by_relink',
            oldValues: { objectId },
            newValues: { newCounterpartyId: id },
          },
          tx,
        );
      }
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.counterparty_changed',
      payload: {
        oldCounterpartyId: previousCounterpartyId,
        newCounterpartyId: id,
      } as Prisma.InputJsonObject,
    });

    return this.getById(currentUser, id);
  }

  async unlinkObject(
    currentUser: CurrentAuthUser,
    id: string,
    objectId: string,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertLink(currentUser);
    const object = await this.loadLinkableObject(currentUser, objectId);
    if (object.counterpartyId !== id) {
      throw new BadRequestException('Object is not linked to this counterparty');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.object.update({
        where: { id: objectId },
        data: { counterpartyId: null },
      });
      await this.auditService.writeAuditEvent(
        {
          entityType: 'counterparty',
          entityId: id,
          actorUserId: currentUser.id,
          action: 'counterparty.object_unlinked',
          oldValues: { objectId },
          newValues: { objectId: null },
        },
        tx,
      );
    });

    await this.auditService.writeObjectAuditLog({
      objectId,
      actorUserId: currentUser.id,
      actionCode: 'object.counterparty_changed',
      payload: {
        oldCounterpartyId: id,
        newCounterpartyId: null,
      } as Prisma.InputJsonObject,
    });

    return this.getById(currentUser, id);
  }

  async history(currentUser: CurrentAuthUser, id: string) {
    this.assertView(currentUser);
    await this.assertExists(id);
    const events = await this.auditService.listAuditEvents('counterparty', id);
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      actor: event.actor,
      oldValues:
        event.oldValues && typeof event.oldValues === 'object'
          ? event.oldValues
          : null,
      newValues:
        event.newValues && typeof event.newValues === 'object'
          ? event.newValues
          : null,
    }));
  }

  private async loadLinkableObject(
    currentUser: CurrentAuthUser,
    objectId: string,
  ) {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        counterpartyId: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    if (
      !object ||
      !canViewObjectBasicProfile({
        currentUserId: currentUser.id,
        roleCodes: this.roleCodes(currentUser),
        permissionCodes: this.permissions(currentUser),
        object,
      })
    ) {
      throw new NotFoundException('Object not found');
    }
    return object;
  }

  private async assertExists(id: string): Promise<void> {
    if (!(await this.prisma.counterparty.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException('Counterparty not found');
    }
  }

  private snapshot(counterparty: {
    name: string;
    legalName: string | null;
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
    status: string;
  }) {
    return {
      name: counterparty.name,
      legalName: counterparty.legalName,
      contactName: counterparty.contactName,
      contactPhone: counterparty.contactPhone,
      notes: counterparty.notes,
      status: counterparty.status,
    };
  }

  private permissions(user: CurrentAuthUser): string[] {
    return user.permissionCodes ?? [];
  }

  private roleCodes(user: CurrentAuthUser): string[] {
    return user.roleCodes ?? (user.roleCode ? [user.roleCode] : []);
  }

  private assertView(user: CurrentAuthUser): void {
    if (!canViewCounterparties(this.permissions(user))) {
      throw new ForbiddenException('Counterparty access denied');
    }
  }

  private assertManage(user: CurrentAuthUser): void {
    if (!canManageCounterparties(this.permissions(user))) {
      throw new ForbiddenException('Counterparty management denied');
    }
  }

  private assertLink(user: CurrentAuthUser): void {
    if (!canLinkCounterpartyObjects(this.permissions(user))) {
      throw new ForbiddenException('Counterparty object linking denied');
    }
  }
}
