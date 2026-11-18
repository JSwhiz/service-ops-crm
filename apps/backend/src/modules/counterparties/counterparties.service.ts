import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessSubject, buildAccessWhere, decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';

import { lockActorAccessRevision } from "../../common/access/lock-actor-access-revision";
import {
  projectCommittedWrite,
  type SavedWithoutAccess,
} from "../../common/access/project-committed-write";
import { AuditHistoryEvent, AuditService } from '../audit/audit.service';
import { ListAuditHistoryQueryDto } from '../audit/dto/list-audit-history-query.dto';
import { InventoryService } from '../inventory/inventory.service';
import { buildObjectBasicProfileAccessWhere, canViewObjectBasicProfile } from '../objects/utils/object-access.util';
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
  ListCounterpartyMovementsQueryDto,
  ListCounterpartyReferencesQueryDto,
} from './dto/list-counterparties-query.dto';
import {
  canLinkCounterpartyObjects,
  canManageCounterparties,
  canViewCounterparties,
} from './utils/counterparty-access.util';

interface CurrentAuthUser extends AccessSubject {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
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
    private readonly inventoryService: InventoryService,
  ) {}

  async list(
    currentUser: CurrentAuthUser,
    query: ListCounterpartiesQueryDto,
  ): Promise<CounterpartyListResponseDto> {
    this.assertView(currentUser);
    const q = query.q?.trim();
    const where: Prisma.CounterpartyWhereInput = {
      AND: [this.accessWhere(currentUser)],
      ...(query.status === "all" ? {} : { status: query.status }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { legalName: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { contactPhone: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: {
            select: {
              objects: { where: this.objectVisibilityWhere(currentUser) },
            },
          },
        },
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
    const selected = query.selectedId
      ? await this.prisma.counterparty.findFirst({
          where: { id: query.selectedId, AND: [this.accessWhere(currentUser)] },
          select: {
            id: true,
            name: true,
            legalName: true,
            status: true,
          },
        })
      : null;

    const rows = await this.prisma.counterparty.findMany({
      where: {
        AND: [this.accessWhere(currentUser)],
        status: 'active',
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { legalName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(selected ? { id: { not: selected.id } } : {}),
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

    return selected ? [selected, ...rows].slice(0, Math.min(query.limit, 50)) : rows;
  }

  async getById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<CounterpartyCardResponseDto> {
    this.assertView(currentUser, id);
    const counterparty = await this.prisma.counterparty.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, login: true, fullName: true },
        },
        objects: {
          where: { deletedAt: null },
          include: objectInclude,
          orderBy: [{ name: "asc" }, { id: "asc" }],
        },
        masterObject: {
          include: objectInclude,
        },
        _count: {
          select: {
            objects: { where: this.objectVisibilityWhere(currentUser) },
          },
        },
      },
    });
    if (!counterparty) {
      throw new NotFoundException("Counterparty not found");
    }

    const visibleObjects = counterparty.objects.filter((object) =>
      canViewObjectBasicProfile({
        subject: currentUser,
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
      masterObject:
        counterparty.masterObject &&
        visibleObjects.some(
          (object) => object.id === counterparty.masterObject?.id,
        )
          ? this.mapObjectSummary(counterparty.masterObject)
          : null,
      objects: visibleObjects.map((object) => ({
        id: object.id,
        name: object.name,
        internalName: object.internalName,
        address: object.address,
        status: object.status,
      })),
      capabilities: {
        canManage: decideAccess(
          currentUser,
          "counterparties.update",
          canManageCounterparties(this.permissions(currentUser)),
          { resourceType: "counterparty", resourceId: id },
        ),
        canLinkObjects: decideAccess(
          currentUser,
          "counterparties.objects.link",
          canLinkCounterpartyObjects(this.permissions(currentUser)),
          { resourceType: "counterparty", resourceId: id },
        ),
        canArchive:
          counterparty.status === "active" &&
          decideAccess(
            currentUser,
            "counterparties.archive",
            canManageCounterparties(this.permissions(currentUser)),
            { resourceType: "counterparty", resourceId: id },
          ),
        canRestore:
          counterparty.status === "archived" &&
          decideAccess(
            currentUser,
            "counterparties.restore",
            canManageCounterparties(this.permissions(currentUser)),
            { resourceType: "counterparty", resourceId: id },
          ),
        canManageMasterObject: decideAccess(
          currentUser,
          "counterparties.master_object.manage",
          canLinkCounterpartyObjects(this.permissions(currentUser)),
          { resourceType: "counterparty", resourceId: id },
        ),
      },
    };
  }

  async create(
    currentUser: CurrentAuthUser,
    payload: CreateCounterpartyDto,
  ): Promise<CounterpartyCardResponseDto | SavedWithoutAccess> {
    this.assertManage(currentUser, undefined, "counterparties.create");
    const created = await this.prisma.$transaction(async (tx) => {
      await lockActorAccessRevision(tx, currentUser);
      const item = await tx.counterparty.create({
        data: {
          name: payload.name,
          legalName: payload.legalName || null,
          contactName: payload.contactName || null,
          contactPhone: payload.contactPhone || null,
          notes: payload.notes || null,
          createdByUserId: currentUser.id,
        },
      });

      this.assertView(currentUser, item.id);
      await this.auditService.writeAuditEvent(
        {
          entityType: "counterparty",
          entityId: item.id,
          actorUserId: currentUser.id,
          action: "counterparty.created",
          newValues: this.snapshot(item),
        },
        tx,
      );
      return item;
    });

    return this.projectSavedCard(currentUser, created.id);
  }

  async update(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateCounterpartyDto,
  ): Promise<CounterpartyCardResponseDto | SavedWithoutAccess> {
    this.assertManage(currentUser, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "counterparties" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, currentUser);
      const existing = await tx.counterparty.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException("Counterparty not found");
      }

      const updated = await tx.counterparty.update({
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

      await this.auditService.writeAuditEvent(
        {
          entityType: "counterparty",
          entityId: id,
          actorUserId: currentUser.id,
          action: "counterparty.updated",
          oldValues: this.snapshot(existing),
          newValues: this.snapshot(updated),
        },
        tx,
      );
    });

    return this.projectSavedCard(currentUser, id);
  }

  async setArchived(
    currentUser: CurrentAuthUser,
    id: string,
    archived: boolean,
  ): Promise<CounterpartyCardResponseDto | SavedWithoutAccess> {
    this.assertManage(
      currentUser,
      id,
      archived ? "counterparties.archive" : "counterparties.restore",
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "counterparties" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, currentUser);
      const existing = await tx.counterparty.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException("Counterparty not found");
      }
      const nextStatus = archived ? "archived" : "active";
      if (existing.status !== nextStatus) {
        await tx.counterparty.update({
          where: { id },
          data: { status: nextStatus },
        });
        await this.auditService.writeAuditEvent(
          {
            entityType: "counterparty",
            entityId: id,
            actorUserId: currentUser.id,
            action: archived
              ? "counterparty.archived"
              : "counterparty.restored",
            oldValues: { status: existing.status },
            newValues: { status: nextStatus },
          },
          tx,
        );
      }
    });
    return this.projectSavedCard(currentUser, id);
  }

  async linkObject(
    currentUser: CurrentAuthUser,
    id: string,
    objectId: string,
  ): Promise<CounterpartyCardResponseDto | SavedWithoutAccess> {
    this.assertLink(currentUser, id);
    const counterparty = await this.prisma.counterparty.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!counterparty) {
      throw new NotFoundException("Counterparty not found");
    }
    if (counterparty.status !== "active") {
      throw new BadRequestException(
        "Archived counterparty cannot accept new objects",
      );
    }

    const object = await this.loadLinkableObject(currentUser, objectId);
    const previousCounterpartyId = object.counterpartyId;
    if (previousCounterpartyId === id) {
      return this.projectSavedCard(currentUser, id);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockLinkContext(tx, [id, previousCounterpartyId, object.masterForCounterpartyId], objectId);
      await lockActorAccessRevision(tx, currentUser);
      const destination = await tx.counterparty.findUnique({ where: { id }, select: { status: true } });
      if (!destination) throw new NotFoundException('Counterparty not found');
      if (destination.status !== 'active') throw new BadRequestException('Archived counterparty cannot accept new objects');
      const latest = await this.loadLinkableObject(currentUser, objectId, tx);
      if (latest.counterpartyId !== previousCounterpartyId || latest.masterForCounterpartyId !== object.masterForCounterpartyId) {
        throw new ConflictException('Object counterparty changed; refresh and retry');
      }
      await tx.object.update({
        where: { id: objectId },
        data: {
          counterpartyId: id,
          ...(object.masterForCounterpartyId
            ? { masterForCounterpartyId: null }
            : {}),
        },
      });
      if (object.masterForCounterpartyId) {
        await this.auditService.writeAuditEvent(
          {
            entityType: "counterparty",
            entityId: object.masterForCounterpartyId,
            actorUserId: currentUser.id,
            action: "counterparty.master_object_cleared",
            oldValues: { objectId },
            newValues: { reason: "object_relinked" },
          },
          tx,
        );
      }
      await this.auditService.writeAuditEvent(
        {
          entityType: "counterparty",
          entityId: id,
          actorUserId: currentUser.id,
          action: "counterparty.object_linked",
          oldValues: previousCounterpartyId ? { previousCounterpartyId } : null,
          newValues: { objectId },
        },
        tx,
      );
      if (previousCounterpartyId) {
        await this.auditService.writeAuditEvent(
          {
            entityType: "counterparty",
            entityId: previousCounterpartyId,
            actorUserId: currentUser.id,
            action: "counterparty.object_unlinked_by_relink",
            oldValues: { objectId },
            newValues: { newCounterpartyId: id },
          },
          tx,
        );
      }
      await this.auditService.writeObjectAuditLog(
        {
          objectId,
          actorUserId: currentUser.id,
          actionCode: "object.counterparty_changed",
          payload: {
            oldCounterpartyId: previousCounterpartyId,
            newCounterpartyId: id,
          } as Prisma.InputJsonObject,
        },
        tx,
      );
    });

    return this.projectSavedCard(currentUser, id);
  }

  async unlinkObject(
    currentUser: CurrentAuthUser,
    id: string,
    objectId: string,
  ): Promise<CounterpartyCardResponseDto | SavedWithoutAccess> {
    this.assertLink(currentUser, id);
    const object = await this.loadLinkableObject(currentUser, objectId);
    if (object.counterpartyId !== id) {
      throw new BadRequestException(
        "Object is not linked to this counterparty",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockLinkContext(tx, [id, object.masterForCounterpartyId], objectId);
      await lockActorAccessRevision(tx, currentUser);
      const latest = await this.loadLinkableObject(currentUser, objectId, tx);
      if (latest.counterpartyId !== id || latest.masterForCounterpartyId !== object.masterForCounterpartyId) {
        throw new ConflictException('Object counterparty changed; refresh and retry');
      }
      await tx.object.update({
        where: { id: objectId },
        data: {
          counterpartyId: null,
          ...(object.masterForCounterpartyId
            ? { masterForCounterpartyId: null }
            : {}),
        },
      });
      if (object.masterForCounterpartyId) {
        await this.auditService.writeAuditEvent(
          {
            entityType: "counterparty",
            entityId: id,
            actorUserId: currentUser.id,
            action: "counterparty.master_object_cleared",
            oldValues: { objectId },
            newValues: { reason: "object_unlinked" },
          },
          tx,
        );
      }
      await this.auditService.writeAuditEvent(
        {
          entityType: "counterparty",
          entityId: id,
          actorUserId: currentUser.id,
          action: "counterparty.object_unlinked",
          oldValues: { objectId },
          newValues: { objectId: null },
        },
        tx,
      );
      await this.auditService.writeObjectAuditLog(
        {
          objectId,
          actorUserId: currentUser.id,
          actionCode: "object.counterparty_changed",
          payload: {
            oldCounterpartyId: id,
            newCounterpartyId: null,
          } as Prisma.InputJsonObject,
        },
        tx,
      );
    });

    return this.projectSavedCard(currentUser, id);
  }

  async history(currentUser: CurrentAuthUser, id: string) {
    this.assertView(currentUser, id, 'counterparties.history');
    await this.assertExists(id);
    const events = await this.auditService.listAuditEvents('counterparty', id);
    return events.map((event) => this.mapHistoryEvent(event));
  }

  async historyPage(
    currentUser: CurrentAuthUser,
    id: string,
    query: ListAuditHistoryQueryDto,
  ) {
    this.assertView(currentUser, id, "counterparties.history");
    await this.assertExists(id);
    const page = await this.auditService.listAuditEventsPage(
      "counterparty",
      id,
      query,
    );
    return {
      ...page,
      items: page.items.map((event) => this.mapHistoryEvent(event)),
    };
  }

  private mapHistoryEvent(event: AuditHistoryEvent) {
    return {
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
    };
  }

  async setMasterObject(
    currentUser: CurrentAuthUser,
    id: string,
    objectId: string,
  ) {
    this.assertLink(currentUser, id, "counterparties.master_object.manage");
    const counterparty = await this.prisma.counterparty.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!counterparty) throw new NotFoundException("Counterparty not found");
    if (counterparty.status !== "active") {
      throw new BadRequestException(
        "Archived counterparty cannot change its master object",
      );
    }
    const object = await this.loadLinkableObject(currentUser, objectId);
    if (object.counterpartyId !== id) {
      throw new BadRequestException(
        "Master object must already be linked to this counterparty",
      );
    }
    if (object.masterForCounterpartyId === id)
      return this.projectSavedCard(currentUser, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockLinkContext(tx, [id, object.counterpartyId, object.masterForCounterpartyId], objectId);
        await lockActorAccessRevision(tx, currentUser);
        const destination = await tx.counterparty.findUnique({ where: { id }, select: { status: true } });
        if (!destination) throw new NotFoundException('Контрагент не найден');
        if (destination.status !== 'active') {
          throw new BadRequestException('У архивного контрагента нельзя изменить головной объект');
        }
        const latest = await this.loadLinkableObject(currentUser, objectId, tx);
        if (latest.counterpartyId !== id) {
          throw new ConflictException('Привязка объекта изменилась. Обновите данные и повторите действие.');
        }
        if (latest.masterForCounterpartyId === id) return;
        const previous = await tx.object.findFirst({
          where: { masterForCounterpartyId: id },
          select: { id: true },
        });
        if (previous) {
          await tx.object.update({
            where: { id: previous.id },
            data: { masterForCounterpartyId: null },
          });
        }
        await tx.object.update({
          where: { id: objectId },
          data: { masterForCounterpartyId: id },
        });
        await this.auditService.writeAuditEvent(
          {
            entityType: "counterparty",
            entityId: id,
            actorUserId: currentUser.id,
            action: "counterparty.master_object_changed",
            oldValues: { objectId: previous?.id ?? null },
            newValues: { objectId },
          },
          tx,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "This object is already designated as another counterparty master",
        );
      }
      throw error;
    }
    return this.projectSavedCard(currentUser, id);
  }

  async clearMasterObject(currentUser: CurrentAuthUser, id: string) {
    this.assertLink(currentUser, id, "counterparties.master_object.manage");
    await this.assertExists(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "counterparties" WHERE "id" = ${id} FOR UPDATE`;
      await lockActorAccessRevision(tx, currentUser);
      const master = await tx.object.findFirst({
        where: { masterForCounterpartyId: id },
        select: { id: true },
      });
      if (!master) return;
      await tx.object.update({
        where: { id: master.id },
        data: { masterForCounterpartyId: null },
      });
      await this.auditService.writeAuditEvent(
        {
          entityType: "counterparty",
          entityId: id,
          actorUserId: currentUser.id,
          action: "counterparty.master_object_cleared",
          oldValues: { objectId: master.id },
          newValues: null,
        },
        tx,
      );
    });
    return this.projectSavedCard(currentUser, id);
  }

  private projectSavedCard(currentUser: CurrentAuthUser, id: string) {
    return projectCommittedWrite(this.prisma, currentUser, () => this.getById(currentUser, id));
  }

  async inventoryMovements(
    currentUser: CurrentAuthUser,
    id: string,
    query: ListCounterpartyMovementsQueryDto,
  ) {
    this.assertView(currentUser, id, "counterparties.inventory.read");
    await this.assertExists(id);
    return this.inventoryService.listCounterpartyMovementsScoped(
      currentUser as CurrentAuthUser & { roleCode: string },
      id,
      query.page,
      query.limit,
      query,
    );
  }

  private async lockLinkContext(tx: Prisma.TransactionClient, ids: Array<string | null>, objectId: string): Promise<void> {
    const counterparties = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
    // Coordinate with archive/master changes in the same order, then serialize
    // physical-object relinks. Reload and compare the observed relationship.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "counterparties" WHERE "id" IN (${Prisma.join(counterparties)}) ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
  }

  private async loadLinkableObject(
    currentUser: CurrentAuthUser,
    objectId: string,
    database: Pick<Prisma.TransactionClient, 'object'> = this.prisma,
  ) {
    const object = await database.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        counterpartyId: true,
        masterForCounterpartyId: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    if (
      !object ||
      !canViewObjectBasicProfile({ subject: currentUser,
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
    if (
      !(await this.prisma.counterparty.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException("Counterparty not found");
    }
  }

  private mapObjectSummary(object: {
    id: string;
    name: string;
    internalName: string | null;
    address: string;
    status: string;
  }) {
    return {
      id: object.id,
      name: object.name,
      internalName: object.internalName,
      address: object.address,
      status: object.status,
    };
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

  private accessWhere(user: CurrentAuthUser): Prisma.CounterpartyWhereInput {
    return buildAccessWhere<Prisma.CounterpartyWhereInput>({
      subject: user,
      actionCode: "counterparties.read",
      legacyWhere: canViewCounterparties(this.permissions(user))
        ? {}
        : { id: { in: [] } },
      invariantWhere: {},
      scopeWhere: (rule) =>
        rule.scope === "all"
          ? {}
          : rule.scope === "selected"
            ? { id: { in: [...rule.selectedIds] } }
            : null,
    }) as Prisma.CounterpartyWhereInput;
  }

  private objectVisibilityWhere(
    user: CurrentAuthUser,
  ): Prisma.ObjectWhereInput {
    return buildObjectBasicProfileAccessWhere({
      subject: user,
      roleCodes: this.roleCodes(user),
      permissionCodes: this.permissions(user),
    });
  }

  private assertView(
    user: CurrentAuthUser,
    id?: string,
    action = "counterparties.read",
  ): void {
    if (!user.isActive) throw new ForbiddenException('Counterparty access denied');
    const context = { resourceType: "counterparty", resourceId: id };
    if (
      hasModuleDeny(user, action, context) ||
      (!decideAccess(
        user,
        action,
        canViewCounterparties(this.permissions(user)),
        context,
      ) &&
        !(
          id === undefined &&
          user.accessRules?.some(
            (r) =>
              r.effect === "allow" &&
              ["counterparties.access", "counterparties.read"].includes(
                r.actionCode,
              ),
          )
        ))
    ) {
      throw new ForbiddenException("Counterparty access denied");
    }
  }

  private assertManage(
    user: CurrentAuthUser,
    id?: string,
    action = "counterparties.update",
  ): void {
    // Mutations return the card. Reject an unreadable target before any write,
    // rather than reporting 403 after its changes have already committed.
    this.assertView(user, id);
    if (
      !decideAccess(
        user,
        action,
        canManageCounterparties(this.permissions(user)),
        { resourceType: "counterparty", resourceId: id },
      )
    ) {
      throw new ForbiddenException("Counterparty management denied");
    }
  }

  private assertLink(
    user: CurrentAuthUser,
    id?: string,
    action = "counterparties.objects.link",
  ): void {
    this.assertView(user, id);
    if (
      !decideAccess(
        user,
        action,
        canLinkCounterpartyObjects(this.permissions(user)),
        { resourceType: "counterparty", resourceId: id },
      )
    ) {
      throw new ForbiddenException("Counterparty object linking denied");
    }
  }
}
