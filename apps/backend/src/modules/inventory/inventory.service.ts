import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { resourceAccessTarget } from '../../common/access/resource-access-context';
import { inventoryMovementVisibilityWhere } from '../../common/access/inventory-movement-visibility';
import { projectCommittedWrite, type SavedWithoutAccess } from '../../common/access/project-committed-write';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { AccessSubject, buildAccessWhere, decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';

import { AuditService } from '../audit/audit.service';
import { ObjectPlanningService } from '../objects/object-planning.service';
import { inventoryTransaction } from './utils/inventory-transaction.util';
import { authorizeInventoryCorrection, canCorrectInventoryMovement } from './utils/inventory-correction-access.util';
import { canAttachStandaloneInventoryPhoto } from './utils/inventory-photo.util';
import { canReadInventoryObjectTarget, canUseInventoryObjectIssueTarget, inventoryObjectFormCapabilities, inventoryOrderFormCapabilities } from './utils/inventory-form-target-access.util';
import { InventoryObjectReferenceResponseDto, InventoryOrderReferenceResponseDto } from './dto/inventory-reference-response.dto';
import {
  INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
  INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
  INVENTORY_WRITEOFF_CONFIRMATION_TYPE,
  LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE,
} from '../approvals/constants/approval.constants';
import { SafeFileResponseDto } from '../files/dto/safe-file-response.dto';
import { mapSafeFileResponse } from '../files/utils/safe-file-response.mapper';
import {
  canViewObjectByScope,
  hasWideObjectAccess,
  buildObjectBasicProfileAccessWhere,
} from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { hasDelegatedObjectAction, objectDelegationContext } from '../user-substitutions/object-delegation.context';
import { resolveObjectDelegationGrants } from '../user-substitutions/resolve-object-delegation-grants.util';
import {
  buildOneTimeOrderAccessWhere,
  canViewOneTimeOrderByScope,
  hasActiveOneTimeOrderAssignment,
} from '../one-time-orders/utils/one-time-order-access.util';

import { CreateObjectInventoryIssueDto } from './dto/create-object-inventory-issue.dto';
import { CreateOrderInventoryIssueDto } from './dto/create-order-inventory-issue.dto';
import { OrderInventoryResponseDto } from './dto/order-inventory-response.dto';
import type { OrderInventoryIssueResult } from './dto/order-inventory-issue-response.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import { InventoryItemListResponseDto } from './dto/inventory-item-list-response.dto';
import { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { InventoryMovementListResponseDto } from './dto/inventory-movement-list-response.dto';
import { InventoryMovementResponseDto, type InventoryMovementWriteResult } from './dto/inventory-movement-response.dto';
import { InventoryReportSummaryDto } from './dto/inventory-report-summary.dto';
import { ListInventoryItemsQueryDto } from './dto/list-inventory-items-query.dto';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';
import { ObjectInventoryResponseDto } from './dto/object-inventory-response.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import {
  buildInventoryGlobalCapabilities,
  InventoryGlobalCapabilities,
} from './utils/inventory-capabilities.util';
import {
  canAccessInventory,
  canViewInventoryReports,
  canAdjustInventory,
  canDeleteInventoryItem,
  canCreateInventoryReceipt,
  canCreateInventoryMovement,
  canIssueInventoryToObject,
  canIssueInventoryToOneTimeOrder,
  canManageInventoryCatalog,
  canResolveInventoryMissingPhotoApproval,
  canReturnInventory,
  canWriteoffInventory,
} from './utils/inventory-access.util';
import {
  defaultEvidenceRequiredForMovementType,
  INVENTORY_MOVEMENT_TYPES,
  InventoryMovementType,
  isSensitiveInventoryMovementType,
} from './types/inventory-movement.type';

interface CurrentAuthUser extends AccessSubject {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

type InventoryItemRecord = {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  notes: string | null;
  currentUnitPrice: Prisma.Decimal | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
};

type InventoryMovementRecord = {
  id: string;
  inventoryItemId: string;
  movementType: string;
  status: string;
  quantity: Prisma.Decimal;
  unitPriceSnapshot: Prisma.Decimal;
  totalAmountSnapshot: Prisma.Decimal;
  adjustmentDirection: string | null;
  comment: string | null;
  evidenceRequired: boolean;
  requiresApprovalBridge: boolean;
  approvalBridgeType: string | null;
  approvalBridgeResolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  inventoryItem: {
    id: string;
    name: string;
    category: string;
    unit: string;
    isActive: boolean;
    currentUnitPrice: Prisma.Decimal | null;
  };
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  approvalBridgeResolvedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  relatedObject: {
    id: string;
    name: string;
    status: string;
    deletedAt: Date | null;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive: boolean;
    }>;
  } | null;
  relatedOneTimeOrder: {
    id: string;
    title: string;
    status: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive: boolean;
    }>;
  } | null;
};

type FileAttachmentRecord = {
  entityId: string;
  file: {
    id: string;
    uploadedByUserId: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  };
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly objectPlanning: ObjectPlanningService,
  ) {}

  async correctMovement(user: CurrentAuthUser, id: string, reason: string) {
    return inventoryTransaction(this.prisma, async (tx) => {
      // Same item-first lock order as creation prevents stock/correction races.
      const reference = await tx.inventoryMovement.findUnique({ where: { id }, select: { inventoryItemId: true } });
      if (!reference) throw new NotFoundException('Движение не найдено');
      this.assertItemNotDenied(user, reference.inventoryItemId);
      await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${reference.inventoryItemId} FOR UPDATE`;
      await lockActorAccessRevision(tx, user);
      await tx.$queryRaw`SELECT id FROM inventory_movements WHERE id = ${id} FOR UPDATE`;
      const targets = await tx.inventoryMovement.findUniqueOrThrow({ where: { id }, select: {
        relatedObjectId: true, relatedOneTimeOrderId: true,
      } });
      // Preserve item -> movement -> source ordering. Read lifecycle/assignments
      // only after acquiring the same source lock used by status transitions.
      if (targets.relatedObjectId) await tx.$queryRaw`SELECT id FROM objects WHERE id = ${targets.relatedObjectId} FOR UPDATE`;
      if (targets.relatedOneTimeOrderId) await tx.$queryRaw`SELECT id FROM one_time_orders WHERE id = ${targets.relatedOneTimeOrderId} FOR UPDATE`;
      const source = await tx.inventoryMovement.findUniqueOrThrow({ where: { id }, include: {
        relatedObject: { include: { assignments: { where: { isActive: true } } } },
        relatedOneTimeOrder: { include: { assignments: { where: { isActive: true } } } },
      } });
      const roles = user.roleCodes?.length ? user.roleCodes : [user.roleCode];
      if (!authorizeInventoryCorrection(user, source, true)) throw new ForbiddenException('Нет права исправлять движение');
      if (!['issue_to_object', 'issue_to_one_time_order'].includes(source.movementType)) throw new BadRequestException('Исправление доступно для выдачи на объект или заказ');
      if (source.relatedObject && source.relatedObject.status !== 'active' && !roles.some((role) => ['founder', 'director'].includes(role))) throw new ForbiddenException('Объект недоступен для изменений');
      const prior = await tx.auditEvent.findFirst({ where: { entityType: 'inventory_movement', entityId: id, action: 'inventory.movement.reversed' } });
      if (prior) return { id, mode: 'reversed' as const, compensatingMovementId: (prior.newValues as { compensatingMovementId: string }).compensatingMovementId };
      if (source.status === 'cancelled') return { id, mode: 'cancelled' as const };
      if (!['applied', 'pending_approval'].includes(source.status)) throw new BadRequestException('Движение уже завершено');
      const unconfirmed = source.status === 'pending_approval' || (source.requiresApprovalBridge && !source.approvalBridgeResolvedAt);
      if (unconfirmed) {
        await tx.inventoryMovement.update({ where: { id }, data: { status: 'cancelled' } });
        await tx.approvalRequest.updateMany({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: id, status: 'pending' }, data: { status: 'cancelled', cancelledByUserId: user.id, cancelledAt: new Date(), decisionComment: reason } });
        await this.auditService.writeAuditEvent({ entityType: 'inventory_movement', entityId: id, actorUserId: user.id, action: 'inventory.movement.cancelled', newValues: { reason } }, tx);
        await this.updateObjectBudget(tx, source);
        return { id, mode: 'cancelled' as const };
      }
      const reverse = await tx.inventoryMovement.create({ data: {
        inventoryItemId: source.inventoryItemId, movementType: 'return', status: 'applied',
        quantity: source.quantity, unitPriceSnapshot: source.unitPriceSnapshot, totalAmountSnapshot: source.totalAmountSnapshot,
        createdByUserId: user.id, relatedObjectId: source.relatedObjectId, relatedOneTimeOrderId: source.relatedOneTimeOrderId,
        comment: `Сторно выдачи: ${reason}`, evidenceRequired: false,
      } });
      await this.auditService.writeAuditEvent({ entityType: 'inventory_movement', entityId: id, actorUserId: user.id, action: 'inventory.movement.reversed', newValues: { reason, compensatingMovementId: reverse.id } }, tx);
      await this.updateObjectBudget(tx, reverse);
      return { id, mode: 'reversed' as const, compensatingMovementId: reverse.id };
    });
  }

  private async updateObjectBudget(tx: Prisma.TransactionClient, movement: {
    relatedObjectId: string | null; relatedOneTimeOrderId: string | null;
  }): Promise<void> {
    const objectId = movement.relatedObjectId ?? (movement.relatedOneTimeOrderId
      ? (await tx.oneTimeOrder.findUnique({ where: { id: movement.relatedOneTimeOrderId }, select: { linkedObjectId: true } }))?.linkedObjectId
      : null);
    if (objectId) await this.objectPlanning.evaluateBudget(objectId, new Date(), tx);
  }

  async listCounterpartyMovementsScoped(
    currentUser: CurrentAuthUser,
    counterpartyId: string,
    page = 1,
    limit = 50,
    query: Pick<
      ListInventoryMovementsQueryDto,
      'dateFrom' | 'dateTo' | 'objectId' | 'movementType'
    > = {},
  ): Promise<InventoryMovementListResponseDto> {
    const createdAtFrom = query.dateFrom
      ? this.parseCounterpartyMovementDate(query.dateFrom)
      : undefined;
    const createdAtToExclusive = query.dateTo
      ? this.parseCounterpartyMovementDate(query.dateTo, true)
      : undefined;
    if (
      createdAtFrom &&
      createdAtToExclusive &&
      createdAtFrom >= createdAtToExclusive
    ) {
      throw new BadRequestException('Counterparty movement date range is invalid');
    }

    const linkedObjects = await this.prisma.object.findMany({
      where: { counterpartyId, deletedAt: null },
      select: {
        id: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });
    const roleCodes = this.getRoleCodes(currentUser);
    const visibleObjectIds = linkedObjects
      .filter((object) =>
        canViewObjectByScope({ subject: currentUser,
          currentUserId: currentUser.id,
          roleCodes,
          object,
        }),
      )
      .map((object) => object.id);

    const scopedObjectIds = query.objectId
      ? visibleObjectIds.filter((objectId) => objectId === query.objectId)
      : visibleObjectIds;

    if (scopedObjectIds.length === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const where: Prisma.InventoryMovementWhereInput = {
      relatedObjectId: { in: scopedObjectIds },
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(createdAtFrom ? { gte: createdAtFrom } : {}),
              ...(createdAtToExclusive ? { lt: createdAtToExclusive } : {}),
            },
          }
        : {}),
    };
    const [total, movements] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              isActive: true,
              currentUnitPrice: true,
            },
          },
          createdBy: { select: { id: true, login: true, fullName: true } },
          approvalBridgeResolvedBy: {
            select: { id: true, login: true, fullName: true },
          },
          relatedObject: {
            select: {
              id: true,
              name: true,
              status: true,
              deletedAt: true,
              createdByUserId: true,
              assignments: {
                where: { isActive: true },
                select: { userId: true, isActive: true },
              },
            },
          },
          relatedOneTimeOrder: {
            select: {
              id: true,
              title: true,
              status: true,
              createdByUserId: true,
              assignments: {
                where: { isActive: true },
                select: {
                  userId: true,
                  assignmentRoleCode: true,
                  isActive: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const movementIds = movements.map((movement) => movement.id);
    const [attachmentsByEntityId, approvalRequestsByEntityId] =
      await Promise.all([
        this.loadMovementAttachments(currentUser, movementIds),
        this.loadPendingApprovalRequestsByMovementIds(movementIds),
      ]);

    return {
      items: (movements as InventoryMovementRecord[]).map((movement) =>
        this.mapMovement(
          movement,
          attachmentsByEntityId.get(movement.id) ?? [],
          approvalRequestsByEntityId.get(movement.id) ?? null,
          currentUser,
        ),
      ),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private parseCounterpartyMovementDate(value: string, nextDay = false): Date {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month! - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException('Counterparty movement date is invalid');
    }
    if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
    // CRM calendar dates use Europe/Moscow (UTC+03:00).
    return new Date(`${date.toISOString().slice(0, 10)}T00:00:00+03:00`);
  }

  async listItems(
    currentUser: CurrentAuthUser,
    query: ListInventoryItemsQueryDto,
  ): Promise<InventoryItemListResponseDto> {
    this.assertInventoryVisible(currentUser);
    const where: Prisma.InventoryItemWhereInput = { AND: [this.buildItemListWhere(query), this.inventoryItemAccessWhere(currentUser, 'inventory.read')] };
    const orderBy: Prisma.InventoryItemOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortDirection },
      { id: 'asc' },
    ];
    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
        },
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const stockByItemId = await this.loadStockSummariesByItemIds(
      items.map((item) => item.id),
      currentUser,
    );
    return {
      items: (items as InventoryItemRecord[]).map((item) =>
        this.mapItem(item, stockByItemId.get(item.id), this.getGlobalCapabilities(currentUser, item.id)),
      ),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getItemById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<InventoryItemResponseDto> {
    this.assertInventoryVisible(currentUser);

    const item = (await this.prisma.inventoryItem.findFirst({
      where: {
        id,
        AND: [this.inventoryItemAccessWhere(currentUser, 'inventory.read')],
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    })) as InventoryItemRecord | null;

    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    const stockByItemId = await this.loadStockSummariesByItemIds([item.id], currentUser);

    return this.mapItem(
      item,
      stockByItemId.get(item.id),
      this.getGlobalCapabilities(currentUser, item.id),
    );
  }

  async createItem(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryItemDto,
  ): Promise<InventoryItemResponseDto | SavedWithoutAccess> {
    if (!decideAccess(currentUser, 'inventory.catalog.create', canManageInventoryCatalog(this.getRoleCodes(currentUser)))) throw new ForbiddenException('Inventory catalog creation denied');
    const normalized = this.normalizeCreateItemPayload(payload);

    let created: InventoryItemRecord;

    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.assertNoActiveItemDuplicate(tx, normalized);
        await lockActorAccessRevision(tx, currentUser);

        const item = (await tx.inventoryItem.create({
          data: {
            ...normalized,
            isActive: true,
            deletedAt: null,
            deletedByUserId: null,
            createdByUserId: currentUser.id,
          },
          include: {
            createdBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
              },
            },
          },
        })) as InventoryItemRecord;

        // The generated card must be readable before either row or audit can commit.
        if (!decideAccess(currentUser, 'inventory.read', canAccessInventory(this.getRoleCodes(currentUser)), { resourceType: 'inventory_item', resourceId: item.id })) {
          throw new ForbiddenException('Created inventory item access denied');
        }
        await this.auditService.writeAuditEvent(
          {
            entityType: 'inventory_item',
            entityId: item.id,
            actorUserId: currentUser.id,
            action: 'inventory.item.created',
            newValues: this.buildItemAuditSnapshot(item),
          },
          tx,
        );

        return item;
      });
    } catch (error) {
      this.rethrowInventoryItemDuplicate(error);
    }

    return projectCommittedWrite(this.prisma, currentUser, () =>
      this.mapItem(created, undefined, this.getGlobalCapabilities(currentUser, created.id)),
    );
  }

  async updateItem(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponseDto | SavedWithoutAccess> {
    this.assertItemNotDenied(currentUser, id);
    if (!decideAccess(currentUser, 'inventory.catalog.update', canManageInventoryCatalog(this.getRoleCodes(currentUser)), { resourceType: 'inventory_item', resourceId: id })) throw new ForbiddenException('Inventory catalog update denied');
    const normalized = this.normalizeUpdateItemPayload(payload);

    let updated: InventoryItemRecord;

    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "inventory_items"
          WHERE "id" = ${id}
          FOR UPDATE
        `;
        await lockActorAccessRevision(tx, currentUser);

        const existing = (await tx.inventoryItem.findUnique({
          where: { id },
          include: {
            createdBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
              },
            },
          },
        })) as InventoryItemRecord | null;

        if (!existing) {
          throw new NotFoundException('Inventory item not found');
        }

        if (existing.version !== payload.expectedVersion) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_VERSION_CONFLICT',
            message: 'Inventory item was changed by another user',
          });
        }

        if (existing.deletedAt || !existing.isActive) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_DELETED',
            message: 'Deleted inventory item cannot be edited',
          });
        }

        const nextValues = {
          name: normalized.name ?? existing.name,
          category: normalized.category ?? existing.category,
          unit: normalized.unit ?? existing.unit,
          notes:
            normalized.notes === undefined ? existing.notes : normalized.notes,
        };

        await this.assertNoActiveItemDuplicate(tx, nextValues, existing.id);

        const updateResult = await tx.inventoryItem.updateMany({
          where: {
            id,
            version: payload.expectedVersion,
          },
          data: {
            ...normalized,
            version: { increment: 1 },
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_VERSION_CONFLICT',
            message: 'Inventory item was changed by another user',
          });
        }

        const item = (await tx.inventoryItem.findUniqueOrThrow({
          where: { id },
          include: {
            createdBy: {
              select: {
                id: true,
                login: true,
                fullName: true,
              },
            },
          },
        })) as InventoryItemRecord;
        const action = 'inventory.item.updated';

        await this.auditService.writeAuditEvent(
          {
            entityType: 'inventory_item',
            entityId: item.id,
            actorUserId: currentUser.id,
            action,
            oldValues: this.buildItemAuditSnapshot(existing),
            newValues: this.buildItemAuditSnapshot(item),
          },
          tx,
        );

        return item;
      });
    } catch (error) {
      this.rethrowInventoryItemDuplicate(error);
    }

    return projectCommittedWrite(this.prisma, currentUser, async () => {
      const stockByItemId = await this.loadStockSummariesByItemIds([updated.id], currentUser);
      return this.mapItem(
        updated,
        stockByItemId.get(updated.id),
        this.getGlobalCapabilities(currentUser, updated.id),
      );
    });
  }

  async deleteItem(
    currentUser: CurrentAuthUser,
    id: string,
    expectedVersion?: number,
  ): Promise<{ id: string; mode: 'hard' | 'soft' } | SavedWithoutAccess> {
    this.assertItemNotDenied(currentUser, id);
    if (!decideAccess(currentUser, 'inventory.catalog.delete', canDeleteInventoryItem(this.getRoleCodes(currentUser), currentUser.permissionCodes), { resourceType: 'inventory_item', resourceId: id })) throw new ForbiddenException('Inventory deletion denied');
    if (
      !decideAccess(currentUser, 'inventory.catalog.delete', canDeleteInventoryItem(
        this.getRoleCodes(currentUser),
        currentUser.permissionCodes,
      ), { resourceType: 'inventory_item', resourceId: id })
    ) {
      throw new ForbiddenException('Inventory item deletion denied');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "inventory_items"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      await lockActorAccessRevision(tx, currentUser);

      const existing = (await tx.inventoryItem.findUnique({
        where: { id },
        include: {
          createdBy: {
            select: { id: true, login: true, fullName: true },
          },
        },
      })) as InventoryItemRecord | null;

      if (!existing) {
        throw new NotFoundException('Inventory item not found');
      }

      if (existing.deletedAt || !existing.isActive) {
        throw new ConflictException({
          code: 'INVENTORY_ITEM_ALREADY_DELETED',
          message: 'Inventory item is already deleted',
        });
      }

      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new ConflictException({
          code: 'INVENTORY_ITEM_VERSION_CONFLICT',
          message: 'Карточка расходника изменилась. Обновите её и подтвердите удаление заново.',
        });
      }

      try {
        await this.assertItemDeletable(tx, existing.id);
      } catch (error) {
        if (error instanceof ConflictException) {
          const response = error.getResponse();
          const body = typeof response === 'object' && response !== null ? response : {};
          throw new ConflictException({
            ...(body as Record<string, unknown>),
            code: 'INVENTORY_ITEM_DELETE_BLOCKED',
            message: 'Inventory item cannot be deleted in its current state',
          });
        }
        throw error;
      }

      const movementsCount = await tx.inventoryMovement.count({
        where: { inventoryItemId: existing.id },
      });

      if (movementsCount === 0) {
        await this.auditService.writeAuditEvent(
          {
            entityType: 'inventory_item',
            entityId: existing.id,
            actorUserId: currentUser.id,
            action: 'inventory.item.deleted_permanently',
            oldValues: this.buildItemAuditSnapshot(existing),
          },
          tx,
        );
        await tx.inventoryItem.delete({ where: { id: existing.id } });
        return { id: existing.id, mode: 'hard' as const };
      }

      const deleted = await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          deletedByUserId: currentUser.id,
          version: { increment: 1 },
        },
        include: {
          createdBy: {
            select: { id: true, login: true, fullName: true },
          },
        },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'inventory_item',
          entityId: existing.id,
          actorUserId: currentUser.id,
          action: 'inventory.item.deleted',
          oldValues: this.buildItemAuditSnapshot(existing),
          newValues: this.buildItemAuditSnapshot(deleted),
        },
        tx,
      );

      return { id: existing.id, mode: 'soft' as const };
    });
    return projectCommittedWrite(this.prisma, currentUser, () => result);
  }

  async restoreItem(
    currentUser: CurrentAuthUser,
    id: string,
    expectedVersion: number,
  ): Promise<InventoryItemResponseDto | SavedWithoutAccess> {
    this.assertItemNotDenied(currentUser, id);
    if (
      !decideAccess(currentUser, 'inventory.catalog.restore', canDeleteInventoryItem(
        this.getRoleCodes(currentUser),
        currentUser.permissionCodes,
      ), { resourceType: 'inventory_item', resourceId: id })
    ) {
      throw new ForbiddenException('Inventory item restore denied');
    }

    let restored: InventoryItemRecord;

    try {
      restored = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "inventory_items"
          WHERE "id" = ${id}
          FOR UPDATE
        `;
        await lockActorAccessRevision(tx, currentUser);

        const existing = (await tx.inventoryItem.findUnique({
          where: { id },
          include: {
            createdBy: {
              select: { id: true, login: true, fullName: true },
            },
          },
        })) as InventoryItemRecord | null;

        if (!existing) {
          throw new NotFoundException('Inventory item not found');
        }

        if (!existing.deletedAt || existing.isActive) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_NOT_DELETED',
            message: 'Inventory item is not deleted',
          });
        }

        if (existing.version !== expectedVersion) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_VERSION_CONFLICT',
            message: 'Inventory item was changed by another user',
          });
        }

        await this.assertNoActiveItemDuplicate(tx, existing, existing.id);

        const updateResult = await tx.inventoryItem.updateMany({
          where: { id, version: expectedVersion, isActive: false },
          data: {
            isActive: true,
            deletedAt: null,
            deletedByUserId: null,
            version: { increment: 1 },
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException({
            code: 'INVENTORY_ITEM_VERSION_CONFLICT',
            message: 'Inventory item was changed by another user',
          });
        }

        const item = (await tx.inventoryItem.findUniqueOrThrow({
          where: { id },
          include: {
            createdBy: {
              select: { id: true, login: true, fullName: true },
            },
          },
        })) as InventoryItemRecord;

        await this.auditService.writeAuditEvent(
          {
            entityType: 'inventory_item',
            entityId: item.id,
            actorUserId: currentUser.id,
            action: 'inventory.item.restored',
            oldValues: this.buildItemAuditSnapshot(existing),
            newValues: this.buildItemAuditSnapshot(item),
          },
          tx,
        );

        return item;
      });
    } catch (error) {
      this.rethrowInventoryItemDuplicate(error);
    }

    return projectCommittedWrite(this.prisma, currentUser, async () => {
      const stockByItemId = await this.loadStockSummariesByItemIds([restored.id], currentUser);
      return this.mapItem(
        restored,
        stockByItemId.get(restored.id),
        this.getGlobalCapabilities(currentUser, restored.id),
      );
    });
  }

  async listMovements(
    currentUser: CurrentAuthUser,
    query: ListInventoryMovementsQueryDto,
  ): Promise<InventoryMovementListResponseDto> {
    this.assertInventoryVisible(currentUser);
    if (currentUser.accessRules?.some(rule => rule.actionCode === 'inventory.movements.read' &&
      rule.effect === 'deny' && rule.scope === 'all')) {
      throw new ForbiddenException('Inventory movements denied');
    }
    if (!canAccessInventory(this.getRoleCodes(currentUser))) {
      // Collection leaf denies are applied before pagination/count by SQL.
      // Do not evaluate a selected rule without its item identity here.
      if (!currentUser.accessRules?.some(r => r.actionCode === 'inventory.movements.read' && r.effect === 'allow')) throw new ForbiddenException('Inventory movements denied');
    }
    return this.listMovementsInternal(currentUser, query);
  }

  async listOneTimeOrderMovementsScoped(
    currentUser: CurrentAuthUser,
    oneTimeOrderId: string,
    page = 1,
    limit = 100,
  ): Promise<InventoryMovementListResponseDto> {
    this.assertOrderInventoryReadable(currentUser, await this.loadOrderInventoryScope(this.prisma, oneTimeOrderId));
    return this.listMovementsInternal(currentUser, {
      oneTimeOrderId,
      page,
      limit,
    }, true);
  }

  private async listMovementsInternal(
    currentUser: CurrentAuthUser,
    query: Pick<
      ListInventoryMovementsQueryDto,
      | 'inventoryItemId'
      | 'objectId'
      | 'oneTimeOrderId'
      | 'movementType'
      | 'status'
      | 'page'
      | 'limit'
    >,
    authorizedOrderScope = false,
  ): Promise<InventoryMovementListResponseDto> {
    const where: Prisma.InventoryMovementWhereInput = { AND: [
      this.buildMovementListWhere(query as ListInventoryMovementsQueryDto),
      this.inventoryMovementAccessWhere(currentUser, 'inventory.movements.read', authorizedOrderScope),
    ] };
    const [total, movements] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              isActive: true,
              currentUnitPrice: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
          approvalBridgeResolvedBy: {
            select: {
              id: true,
              login: true,
              fullName: true,
            },
          },
          relatedObject: {
            select: {
              id: true,
              name: true,
              status: true,
              deletedAt: true,
              createdByUserId: true,
              assignments: {
                where: { isActive: true },
                select: {
                  userId: true,
                  isActive: true,
                },
              },
            },
          },
          relatedOneTimeOrder: {
            select: {
              id: true,
              title: true,
              status: true,
              createdByUserId: true,
              assignments: {
                where: { isActive: true },
                select: {
                  userId: true,
                  assignmentRoleCode: true,
                  isActive: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const attachmentsByEntityId = await this.loadMovementAttachments(
      currentUser,
      movements.map((movement) => movement.id),
    );
    const approvalRequestsByEntityId =
      await this.loadPendingApprovalRequestsByMovementIds(
        movements.map((movement) => movement.id),
      );

    return {
      items: (movements as InventoryMovementRecord[]).map((movement) =>
        this.mapMovement(
          movement,
          attachmentsByEntityId.get(movement.id) ?? [],
          approvalRequestsByEntityId.get(movement.id) ?? null,
          currentUser,
        ),
      ),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async createMovement(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
  ): Promise<InventoryMovementWriteResult> {
    await this.assertMovementCreatable(currentUser, payload.movementType, payload);

    if (payload.relatedOneTimeOrderId) {
      const order = await this.loadOrderInventoryScope(this.prisma, payload.relatedOneTimeOrderId);
      if (!inventoryOrderFormCapabilities(currentUser, order).canLinkMovement) throw new ForbiddenException('Related one-time order access denied');
    }

    const movement = await this.createMovementRecord(currentUser, payload);
    if (currentUser.accessVersion !== undefined) {
      // A grant or revoke that committed while the response was being built
      // invalidates the authorization snapshot used to project item data. An
      // unavailable revision check also yields acknowledgement of the committed write.
      const actor = await this.prisma.user.findFirst({
        where: { id: currentUser.id, isActive: true, deletedAt: null },
        select: { accessVersion: true },
      }).catch(() => null);
      if (actor?.accessVersion !== currentUser.accessVersion) return { outcome: 'saved_without_access' };
    }
    return movement;
  }

  async getReportSummary(currentUser: CurrentAuthUser): Promise<InventoryReportSummaryDto> {
    this.assertInventoryVisible(currentUser);
    const itemWhere: Prisma.InventoryItemWhereInput = { AND: [
      this.inventoryItemAccessWhere(currentUser, 'inventory.reports'),
      this.inventoryItemAccessWhere(currentUser, 'inventory.read'),
    ] };
    const movementWhere = this.inventoryMovementAccessWhere(currentUser, 'inventory.reports');
    const [items, totalActiveItems, movementCount, missingPhotoBridgeCount] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: itemWhere, select: { id: true, currentUnitPrice: true } }),
      this.prisma.inventoryItem.count({ where: { AND: [itemWhere, { isActive: true, deletedAt: null }] } }),
      this.prisma.inventoryMovement.count({ where: movementWhere }),
      this.prisma.inventoryMovement.count({ where: { AND: [movementWhere, { requiresApprovalBridge: true, approvalBridgeResolvedAt: null }] } }),
    ]);
    const stock = await this.loadStockSummariesByItemIds(items.map(item => item.id));
    return { totalItems: items.length, totalActiveItems, movementCount, missingPhotoBridgeCount,
      totalStockValueEstimate: items.reduce((sum, item) => sum + (stock.get(item.id)?.currentStock ?? 0) * Number(item.currentUnitPrice ?? 0), 0) };
  }

  async resolveMissingPhotoApproval(
    currentUser: CurrentAuthUser,
    movementId: string,
  ): Promise<InventoryMovementWriteResult> {
    if (
      !canResolveInventoryMissingPhotoApproval(this.getRoleCodes(currentUser))
    ) {
      throw new ForbiddenException('Inventory missing photo approval denied');
    }

    const movement = await this.prisma.inventoryMovement.findFirst({
      where: {
        id: movementId,
      },
      select: {
        id: true,
        inventoryItemId: true,
        relatedObject: { select: { id: true, createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } } } },
        createdByUserId: true,
        movementType: true,
        requiresApprovalBridge: true,
        approvalBridgeType: true,
        approvalBridgeResolvedAt: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

    this.assertItemNotDenied(currentUser, movement.inventoryItemId);
    if (movement.createdByUserId === currentUser.id) throw new ForbiddenException('Собственную отгрузку подтверждает другой пользователь');
    if (!decideAccess(currentUser, 'inventory.resolve_missing_photo', true, { resourceType: 'inventory_item', resourceId: movement.inventoryItemId,
      parents: movement.relatedObject ? [{ actionCode: 'objects.read', context: { resourceType: 'object', resourceId: movement.relatedObject.id,
        ownerUserId: movement.relatedObject.createdByUserId, assignedUserIds: movement.relatedObject.assignments.map(a => a.userId) } }] : [] })) throw new ForbiddenException('Inventory missing photo approval denied');

    if (
      movement.movementType !== 'issue_to_object' ||
      !movement.requiresApprovalBridge ||
      movement.approvalBridgeType !== LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE
    ) {
      throw new BadRequestException(
        'Only issue_to_object without photo can be resolved by this bridge',
      );
    }

    const approvalRequest = await this.prisma.approvalRequest.findFirst({
      where: {
        approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
        sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: movement.id,
        status: 'pending',
      },
      select: {
        id: true,
        createdByUserId: true,
      },
    });

    if (approvalRequest?.createdByUserId === currentUser.id) throw new ForbiddenException('Собственную заявку подтверждает другой пользователь');
    await this.prisma.$transaction(async (tx) => {
      await this.lockInventoryExceptionSource(tx, movement.id);
      await lockActorAccessRevision(tx, currentUser);
      // The preflight context may be older than a wait on the item/movement.
      // Re-read the actual source before applying the direct bridge. This is a
      // fresh authorization check, not serialization of assignment mutations.
      const currentMovement = await tx.inventoryMovement.findUniqueOrThrow({
        where: { id: movement.id },
        select: {
          inventoryItemId: true,
          createdByUserId: true,
          relatedObject: { select: { id: true, createdByUserId: true, assignments: { where: { isActive: true }, select: { userId: true } } } },
        },
      });
      this.assertItemNotDenied(currentUser, currentMovement.inventoryItemId);
      if (currentMovement.createdByUserId === currentUser.id) throw new ForbiddenException('Собственную отгрузку подтверждает другой пользователь');
      if (!decideAccess(currentUser, 'inventory.resolve_missing_photo', true, {
        resourceType: 'inventory_item', resourceId: currentMovement.inventoryItemId,
        parents: currentMovement.relatedObject ? [{ actionCode: 'objects.read', context: {
          resourceType: 'object', resourceId: currentMovement.relatedObject.id,
          ownerUserId: currentMovement.relatedObject.createdByUserId,
          assignedUserIds: currentMovement.relatedObject.assignments.map(a => a.userId),
        } }] : [],
      })) throw new ForbiddenException('Inventory missing photo approval denied');
      if (approvalRequest) {
        const lockedApprovalRequests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "approval_requests"
          WHERE "id" = ${approvalRequest.id}
          FOR UPDATE
        `;
        const lockedApprovalRequest = await tx.approvalRequest.findUnique({
          where: { id: approvalRequest.id },
          select: { status: true, createdByUserId: true },
        });

        if (lockedApprovalRequest?.createdByUserId === currentUser.id) throw new ForbiddenException('Собственную заявку подтверждает другой пользователь');

        if (
          lockedApprovalRequests.length === 0 ||
          lockedApprovalRequest?.status !== 'pending'
        ) {
          throw new ConflictException('Inventory approval is already resolved');
        }
      }

      await this.applyInventoryExceptionApprovalDecision(tx, {
        movementId: movement.id,
        actorUserId: currentUser.id,
      });

      if (approvalRequest) {
        const resolvedApproval = await tx.approvalRequest.updateMany({
          where: {
            id: approvalRequest.id,
            status: 'pending',
          },
          data: {
            status: 'approved',
            resolvedByUserId: currentUser.id,
            resolvedAt: new Date(),
            decisionComment: null,
          },
        });

        if (resolvedApproval.count !== 1) {
          throw new ConflictException('Inventory approval is already resolved');
        }

        await this.auditService.writeAuditEvent(
          {
            entityType: 'approval_request',
            entityId: approvalRequest.id,
            actorUserId: currentUser.id,
            action: 'approval.request.approved',
            newValues: {
              approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
              sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
              sourceEntityId: movement.id,
            },
          },
          tx,
        );
      }
    });

    return projectCommittedWrite(this.prisma, currentUser, async () => {
      const updated = await this.loadMovementViewById(movement.id);
      const updatedAttachments = await this.loadMovementAttachments(currentUser, [movement.id]);

      return this.mapMovement(
        updated,
        updatedAttachments.get(movement.id) ?? [],
        null,
        currentUser,
      );
    });
  }

  async listObjectInventory(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectInventoryResponseDto> {
    const object = await this.loadObjectScope(objectId);
    const roleCodes = this.getRoleCodes(currentUser);
    if (!decideAccess(currentUser, 'objects.inventory.read', true, { resourceType: 'object', resourceId: object.id,
      ownerUserId: object.createdByUserId, assignedUserIds: object.assignments.filter(a => a.isActive).map(a => a.userId) })) throw new ForbiddenException('Object inventory read denied');

    if (
      !canViewObjectByScope({ subject: currentUser,
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Object inventory access denied');
    }

    const [movements, availableItems] = await Promise.all([
      this.listObjectScopedMovements(currentUser, objectId),
      this.listItems(currentUser, {
        isActive: true,
        page: 1,
        limit: 100,
        sortBy: 'name',
        sortDirection: 'asc',
      })
        .then((response) => response.items)
        .catch((error: unknown) => {
          if (error instanceof ForbiddenException) {
            return this.listOperationalInventoryItemsForObject(
              currentUser,
              object,
            );
          }

          throw error;
        }),
    ]);

    return {
      movements,
      availableItems: this.canIssueToSpecificObject(currentUser, object)
        ? availableItems
        : [],
      capabilities: {
        canIssueInventoryToObject: this.canIssueToSpecificObject(
          currentUser,
          object,
        ),
        canResolveMissingPhotoApproval:
          canResolveInventoryMissingPhotoApproval(roleCodes),
      },
    };
  }

  async createObjectIssueMovement(
    currentUser: CurrentAuthUser,
    objectId: string,
    payload: CreateObjectInventoryIssueDto,
  ): Promise<InventoryMovementResponseDto> {
    const object = await this.loadObjectScope(objectId);

    if (!this.canIssueToSpecificObject(currentUser, object)) {
      throw new ForbiddenException('Inventory issue to object denied');
    }

    return this.createMovementRecord(currentUser, {
      inventoryItemId: payload.inventoryItemId,
      movementType: 'issue_to_object',
      quantity: payload.quantity,
      comment: payload.comment,
      evidenceRequired: true,
      relatedObjectId: objectId,
    });
  }

  async listOneTimeOrderInventory(currentUser: CurrentAuthUser, orderId: string): Promise<OrderInventoryResponseDto> {
    const order = await this.loadOrderInventoryScope(this.prisma, orderId);
    this.assertOrderInventoryReadable(currentUser, order);
    const canIssueInventoryToOrder = this.canIssueToSpecificOrder(currentUser, order);
    const movements = await this.listOneTimeOrderMovementsScoped(currentUser, orderId, 1, 100);
    const items = canIssueInventoryToOrder ? await this.prisma.inventoryItem.findMany({
      where: { AND: [{ isActive: true, deletedAt: null }, this.inventoryItemAccessWhere(currentUser, 'inventory.read', {})] },
      include: { createdBy: { select: { id: true, login: true, fullName: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }) : [];
    const returnItems = await this.prisma.inventoryItem.findMany({
      where: { AND: [{ isActive: true, deletedAt: null,
        movements: { some: { relatedOneTimeOrderId: orderId, movementType: 'issue_to_one_time_order', status: 'applied' } } },
        this.inventoryItemAccessWhere(currentUser, 'inventory.read', {})] },
      include: { createdBy: { select: { id: true, login: true, fullName: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const availableReturns = returnItems.filter(item => this.canReturnToSpecificOrder(currentUser, order, item.id));
    const stock = await this.loadStockSummariesByItemIds([...items, ...availableReturns].map(item => item.id));
    // The order picker does not advertise global catalog or stock-management actions.
    const capabilities: InventoryGlobalCapabilities = {
      canAccessInventory: false, canManageInventoryCatalog: false, canDeleteInventoryItem: false,
      canCreateInventoryMovement: false, canCreateInventoryReceipt: false, canIssueInventoryToObject: false,
      canIssueInventoryToOneTimeOrder: canIssueInventoryToOrder, canReturnInventory: false,
      canWriteoffInventory: false, canAdjustInventory: false, canViewInventoryReports: false,
      canViewInventoryMovements: false,
      canResolveInventoryMissingPhotoApproval: false,
    };
    return { ...movements, availableItems: items.map(item => this.mapItem(item, stock.get(item.id), capabilities)),
      availableReturnItems: availableReturns.map(item => this.mapItem(item, stock.get(item.id), capabilities)),
      capabilities: { canIssueInventoryToOrder, canReturnInventoryFromOrder: availableReturns.length > 0 } };
  }

  async createOneTimeOrderIssueMovement(currentUser: CurrentAuthUser, orderId: string, payload: CreateOrderInventoryIssueDto): Promise<OrderInventoryIssueResult> {
    if (payload.requestId !== undefined && !isUUID(payload.requestId)) throw new BadRequestException('requestId must be a UUID');
    // Legacy callers have one operation per call; only an explicit client key
    // identifies retries across HTTP requests. Never deduplicate by payload.
    const requestId = payload.requestId ?? randomUUID();
    const movement = await this.createMovementRecord(currentUser, {
      inventoryItemId: payload.inventoryItemId, movementType: 'issue_to_one_time_order',
      quantity: payload.quantity, comment: payload.comment, evidenceRequired: true,
      relatedOneTimeOrderId: orderId,
    }, { requestId, authorize: async tx => {
      await tx.$queryRaw`SELECT id FROM one_time_orders WHERE id = ${orderId} FOR UPDATE`;
      const order = await this.loadOrderInventoryScope(tx, orderId);
      this.assertOrderInventoryReadable(currentUser, order);
      if (!this.canIssueToSpecificOrder(currentUser, order)) throw new ForbiddenException('Inventory issue to order denied');
    } });
    // The write has committed. Recheck access before returning its full payload.
    try {
      this.assertOrderInventoryReadable(currentUser, await this.loadOrderInventoryScope(this.prisma, orderId));
      if (currentUser.accessVersion !== undefined) {
        const actor = await this.prisma.user.findFirst({
          where: { id: currentUser.id, isActive: true, deletedAt: null },
          select: { accessVersion: true },
        });
        if (actor?.accessVersion !== currentUser.accessVersion) return { outcome: 'saved_without_access' };
      }
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return { outcome: 'saved_without_access' };
      throw error;
    }
    return { ...movement, inventoryItemId: movement.inventoryItem.id, oneTimeOrderId: orderId };
  }

  private canReturnToSpecificOrder(currentUser: CurrentAuthUser, order: Awaited<ReturnType<InventoryService['loadOrderInventoryScope']>>, itemId: string): boolean {
    const globalReturn = canReturnInventory(this.getRoleCodes(currentUser));
    return decideAccess(currentUser, 'inventory.return', globalReturn, {
      resourceType: 'inventory_item', resourceId: itemId,
      invariantAllowed: !['completed', 'cancelled'].includes(order.status) &&
        (globalReturn || hasActiveOneTimeOrderAssignment(order, currentUser.id)),
      parents: [{ actionCode: 'one_time_orders.read', context: this.orderInventoryContext(order) }],
    });
  }

  async createOneTimeOrderReturnMovement(currentUser: CurrentAuthUser, orderId: string, payload: CreateOrderInventoryIssueDto): Promise<OrderInventoryIssueResult> {
    if (payload.requestId !== undefined && !isUUID(payload.requestId)) throw new BadRequestException('requestId must be a UUID');
    const movement = await this.createMovementRecord(currentUser, {
      inventoryItemId: payload.inventoryItemId, movementType: 'return',
      quantity: payload.quantity, comment: payload.comment, evidenceRequired: true,
      relatedOneTimeOrderId: orderId,
    }, { requestId: payload.requestId ?? randomUUID(), authorize: async tx => {
      // Source and assignments are already locked by the existing return path.
      const order = await this.loadOrderInventoryScope(tx, orderId);
      this.assertOrderInventoryReadable(currentUser, order);
      if (!this.canReturnToSpecificOrder(currentUser, order, payload.inventoryItemId)) throw new ForbiddenException('Inventory return from order denied');
    }, validateNewMovement: async tx => {
      // The existing item FOR UPDATE lock serializes issues, returns and corrections.
      // Validate only a new movement: an identical retry still returns its receipt
      // even when the original return exhausted the outstanding quantity.
      const totals = await tx.inventoryMovement.groupBy({
        by: ['movementType'],
        where: { inventoryItemId: payload.inventoryItemId, relatedOneTimeOrderId: orderId,
          status: 'applied', movementType: { in: ['issue_to_one_time_order', 'return'] } },
        _sum: { quantity: true },
      });
      const issued = totals.find(row => row.movementType === 'issue_to_one_time_order')?._sum.quantity;
      if (!issued || issued.lte(0)) throw new ConflictException({
        code: 'INVENTORY_ORDER_RETURN_NOT_ISSUED', message: 'Этот расходник не выдавался на данный заказ.',
      });
      const returned = totals.find(row => row.movementType === 'return')?._sum.quantity ?? new Prisma.Decimal(0);
      if (new Prisma.Decimal(payload.quantity).gt(issued.minus(returned))) throw new ConflictException({
        code: 'INVENTORY_ORDER_RETURN_EXCEEDS_OUTSTANDING', message: 'Количество возврата превышает остаток выданного на этот заказ.',
      });
    } });
    try {
      this.assertOrderInventoryReadable(currentUser, await this.loadOrderInventoryScope(this.prisma, orderId));
      if (currentUser.accessVersion !== undefined) {
        const actor = await this.prisma.user.findFirst({ where: { id: currentUser.id, isActive: true, deletedAt: null }, select: { accessVersion: true } });
        if (actor?.accessVersion !== currentUser.accessVersion) return { outcome: 'saved_without_access' };
      }
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return { outcome: 'saved_without_access' };
      throw error;
    }
    return { ...movement, inventoryItemId: movement.inventoryItem.id, oneTimeOrderId: orderId };
  }

  private async loadOrderInventoryScope(database: Pick<Prisma.TransactionClient, 'oneTimeOrder'>, orderId: string) {
    const order = await database.oneTimeOrder.findUnique({ where: { id: orderId }, select: {
      id: true, status: true, createdByUserId: true,
      assignments: { where: { isActive: true }, select: { userId: true, assignmentRoleCode: true, isActive: true } },
    } });
    if (!order) throw new NotFoundException('One-time order not found');
    return order;
  }

  private orderInventoryContext(order: { id: string; createdByUserId: string; assignments: Array<{ userId: string; assignmentRoleCode: string; isActive: boolean }> }) {
    return { resourceType: 'one_time_order', resourceId: order.id, ownerUserId: order.createdByUserId,
      assignedUserIds: order.assignments.filter(a => a.isActive && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId) };
  }

  private assertOrderInventoryReadable(currentUser: CurrentAuthUser, order: Awaited<ReturnType<InventoryService['loadOrderInventoryScope']>>) {
    const context = this.orderInventoryContext(order);
    const visible = decideAccess(currentUser, 'one_time_orders.read', canViewOneTimeOrderByScope({ subject: currentUser,
      currentUserId: currentUser.id, roleCodes: this.getRoleCodes(currentUser), permissionCodes: currentUser.permissionCodes, order,
    }), context);
    if (!decideAccess(currentUser, 'one_time_orders.inventory.read', visible, { ...context, parentAllowed: visible }) ||
        !decideAccess(currentUser, 'inventory.access', true, context)) throw new ForbiddenException('Order inventory access denied');
  }

  private canIssueToSpecificOrder(currentUser: CurrentAuthUser, order: Awaited<ReturnType<InventoryService['loadOrderInventoryScope']>>): boolean {
    const globalIssuer = canIssueInventoryToOneTimeOrder(this.getRoleCodes(currentUser));
    // The pre-ACL scoped API already allowed every active one_time_manager
    // assignment, independently of system role or a personal permission row.
    const assigned = hasActiveOneTimeOrderAssignment(order, currentUser.id);
    const legacyAllowed = globalIssuer || assigned;
    return decideAccess(currentUser, 'inventory.issue_to_one_time_order', legacyAllowed, {
      ...this.orderInventoryContext(order),
      invariantAllowed: !['completed', 'cancelled'].includes(order.status) &&
        (globalIssuer || assigned),
      parents: [{ actionCode: 'one_time_orders.read', context: this.orderInventoryContext(order) }],
    });
  }

  private async createMovementRecord(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
    orderIssue?: {
      requestId: string;
      authorize: (tx: Prisma.TransactionClient) => Promise<void>;
      validateNewMovement?: (tx: Prisma.TransactionClient) => Promise<void>;
    },
  ): Promise<InventoryMovementResponseDto> {
    this.assertItemNotDenied(currentUser, payload.inventoryItemId);
    await this.assertScopedTargets(currentUser, payload);
    const delegation = objectDelegationContext.getStore();
    const requiresSourceCheck = payload.movementType === 'return' || payload.movementType === 'issue_to_object';
    const returnGrants = requiresSourceCheck && delegation?.actorUserId === currentUser.id
      ? delegation.grants.filter((grant) => grant.objectId === payload.relatedObjectId) : [];
    const creationResult = await inventoryTransaction(this.prisma, async (tx) => {
        if (orderIssue) {
          // Serialize retries even if the caller changes the item or order.
          const requestKey = `inventory-order-issue:${currentUser.id}:${orderIssue.requestId}`;
          // The lock returns PostgreSQL void, which Prisma cannot decode as a query result.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
        }
        await tx.$queryRaw`
          SELECT "id"
          FROM "inventory_items"
          WHERE "id" = ${payload.inventoryItemId}
          FOR UPDATE
        `;
        await lockActorAccessRevision(tx, currentUser);

        if (requiresSourceCheck) {
          // Match correction's item -> actor -> source order. Holding a source
          // before the item would invert the existing inventory correction path.
          if (payload.relatedObjectId) await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${payload.relatedObjectId} FOR SHARE`;
          if (payload.relatedOneTimeOrderId) await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${payload.relatedOneTimeOrderId} FOR SHARE`;
          const sourceIds = [...new Set(returnGrants.map((grant) => grant.substitutionId))].sort();
          const principalIds = [...new Set(returnGrants.map((grant) => grant.principalUserId))].sort();
          if (principalIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" IN (${Prisma.join(principalIds)}) ORDER BY "id" FOR SHARE`);
          if (sourceIds.length) {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitutions" WHERE "id" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user_substitution_objects" WHERE "objectId" = ${payload.relatedObjectId} AND "substitutionId" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR SHARE`);
          }
          if (payload.relatedObjectId) await tx.$queryRaw`SELECT "id" FROM "object_assignments" WHERE "objectId" = ${payload.relatedObjectId} AND "isActive" = true ORDER BY "id" FOR SHARE`;
          if (payload.relatedOneTimeOrderId) await tx.$queryRaw`SELECT "id" FROM "one_time_order_assignments" WHERE "oneTimeOrderId" = ${payload.relatedOneTimeOrderId} AND "isActive" = true ORDER BY "id" FOR SHARE`;
          // Reuse only the request's captured delegation sources, resolved fresh
          // under their locks; a cached preflight grant cannot survive a revoke.
          const grants = sourceIds.length
            ? (await resolveObjectDelegationGrants(tx, currentUser.id)).filter((grant) =>
              grant.objectId === payload.relatedObjectId && sourceIds.includes(grant.substitutionId)) : [];
          await objectDelegationContext.run({ actorUserId: currentUser.id, grants, used: new Map() },
            () => this.assertScopedTargets(currentUser, payload, tx));
        }

        if (orderIssue) {
          await orderIssue.authorize(tx);
          const prior = await tx.auditEvent.findFirst({
            where: {
              actorUserId: currentUser.id,
              entityType: 'inventory_movement',
              action: 'inventory.movement.created',
              metadata: { path: ['orderIssueRequestId'], equals: orderIssue.requestId },
            },
          });
          if (prior) {
            const saved = await tx.inventoryMovement.findUnique({ where: { id: prior.entityId } });
            if (!saved || saved.inventoryItemId !== payload.inventoryItemId ||
                saved.relatedOneTimeOrderId !== payload.relatedOneTimeOrderId ||
                saved.movementType !== payload.movementType ||
                Number(saved.quantity) !== Number(payload.quantity) ||
                saved.comment !== (payload.comment?.trim() || null)) {
              throw new ConflictException('Request ID already used with a different issue payload');
            }
            return { createdMovement: saved };
          }
        }
        if (orderIssue?.validateNewMovement) await orderIssue.validateNewMovement(tx);
        if (!orderIssue && payload.movementType === 'issue_to_one_time_order' && payload.relatedOneTimeOrderId) {
          await tx.$queryRaw`SELECT id FROM one_time_orders WHERE id = ${payload.relatedOneTimeOrderId} FOR UPDATE`;
          const order = await this.loadOrderInventoryScope(tx, payload.relatedOneTimeOrderId);
          if (!inventoryOrderFormCapabilities(currentUser, order).canIssueToOneTimeOrder) throw new ForbiddenException('Inventory issue to order denied');
        }

        const item = await tx.inventoryItem.findUnique({
          where: { id: payload.inventoryItemId },
          select: {
            id: true,
            isActive: true,
            deletedAt: true,
            currentUnitPrice: true,
          },
        });

        if (!item) {
          throw new NotFoundException('Inventory item not found');
        }

        if (!item.isActive || item.deletedAt) {
          throw new BadRequestException(
            'Deleted inventory item cannot be used in movements',
          );
        }

        const normalizedMovement = this.normalizeMovementPayload(
          payload,
          item.currentUnitPrice,
        );
        const requiresWriteoffApproval =
          normalizedMovement.movementType === 'writeoff';
        const stockSummary = await this.loadStockSummaryForItem(tx, item.id);
        const nextStock =
          stockSummary.currentStock + normalizedMovement.signedQuantity;

        if (nextStock < -0.0001) {
          throw new BadRequestException('Insufficient stock for movement');
        }

        const createdMovement = await tx.inventoryMovement.create({
          data: {
            inventoryItemId: item.id,
            movementType: normalizedMovement.movementType,
            status: requiresWriteoffApproval ? 'pending_approval' : 'applied',
            quantity: normalizedMovement.quantity,
            unitPriceSnapshot: normalizedMovement.unitPriceSnapshot,
            totalAmountSnapshot: normalizedMovement.totalAmountSnapshot,
            adjustmentDirection: normalizedMovement.adjustmentDirection,
            comment: normalizedMovement.comment,
            evidenceRequired: normalizedMovement.evidenceRequired,
            requiresApprovalBridge: normalizedMovement.requiresApprovalBridge,
            approvalBridgeType: normalizedMovement.approvalBridgeType,
            createdByUserId: currentUser.id,
            relatedObjectId: normalizedMovement.relatedObjectId,
            relatedOneTimeOrderId: normalizedMovement.relatedOneTimeOrderId,
          },
        });

        if (normalizedMovement.movementType === 'receipt') {
          const nextUnitPrice =
            item.currentUnitPrice === null ||
            normalizedMovement.unitPriceSnapshot.gt(item.currentUnitPrice)
              ? normalizedMovement.unitPriceSnapshot
              : item.currentUnitPrice;

          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              currentUnitPrice: nextUnitPrice,
            },
          });
        }

        const approvalRequest = requiresWriteoffApproval
          ? await tx.approvalRequest.create({
              data: {
                approvalType: INVENTORY_WRITEOFF_CONFIRMATION_TYPE,
                sourceEntityType:
                  INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
                sourceEntityId: createdMovement.id,
                createdByUserId: currentUser.id,
                payloadSnapshot: {
                  summaryTitle: 'Списание расходников',
                  summarySubtitle: `${payload.relatedObjectId ? 'Объект' : payload.relatedOneTimeOrderId ? 'Разовый заказ' : 'Склад'} · ${Number(createdMovement.quantity).toLocaleString('ru-RU')} ед.`,
                  movementType: createdMovement.movementType,
                  inventoryItemId: createdMovement.inventoryItemId,
                  relatedObjectId: createdMovement.relatedObjectId,
                  relatedOneTimeOrderId: createdMovement.relatedOneTimeOrderId,
                  quantity: Number(createdMovement.quantity),
                  unitPriceSnapshot: Number(createdMovement.unitPriceSnapshot),
                  totalAmountSnapshot: Number(
                    createdMovement.totalAmountSnapshot,
                  ),
                  comment: createdMovement.comment,
                },
              },
            })
          : createdMovement.requiresApprovalBridge &&
              createdMovement.approvalBridgeType ===
                LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE
            ? await tx.approvalRequest.create({
                data: {
                  approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
                  sourceEntityType:
                    INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
                  sourceEntityId: createdMovement.id,
                  createdByUserId: currentUser.id,
                  payloadSnapshot: {
                    summaryTitle: 'Inventory exception',
                    summarySubtitle: `${normalizedMovement.movementType} · ${payload.relatedObjectId ? 'объект' : 'движение'}`,
                    movementType: createdMovement.movementType,
                    inventoryItemId: createdMovement.inventoryItemId,
                    relatedObjectId: createdMovement.relatedObjectId,
                    relatedOneTimeOrderId: createdMovement.relatedOneTimeOrderId,
                    quantity: Number(createdMovement.quantity),
                    unitPriceSnapshot: Number(createdMovement.unitPriceSnapshot),
                    totalAmountSnapshot: Number(
                      createdMovement.totalAmountSnapshot,
                    ),
                    comment: createdMovement.comment,
                    approvalBridgeType: createdMovement.approvalBridgeType,
                  },
                },
              })
            : null;

        await this.auditService.writeAuditEvent(
          {
            entityType: 'inventory_movement',
            entityId: createdMovement.id,
            actorUserId: currentUser.id,
            action: 'inventory.movement.created',
            ...(orderIssue ? { metadata: { orderIssueRequestId: orderIssue.requestId } } : {}),
            newValues: {
              inventoryItemId: createdMovement.inventoryItemId,
              movementType: createdMovement.movementType,
              quantity: Number(createdMovement.quantity),
              unitPriceSnapshot: Number(createdMovement.unitPriceSnapshot),
              totalAmountSnapshot: Number(
                createdMovement.totalAmountSnapshot,
              ),
              adjustmentDirection: createdMovement.adjustmentDirection,
              evidenceRequired: createdMovement.evidenceRequired,
              requiresApprovalBridge:
                createdMovement.requiresApprovalBridge,
              approvalBridgeType: createdMovement.approvalBridgeType,
              status: createdMovement.status,
              relatedObjectId: createdMovement.relatedObjectId,
              relatedOneTimeOrderId:
                createdMovement.relatedOneTimeOrderId,
              comment: createdMovement.comment,
            },
          },
          tx,
        );

        if (approvalRequest) {
          await this.auditService.writeAuditEvent(
            {
              entityType: 'approval_request',
              entityId: approvalRequest.id,
              actorUserId: currentUser.id,
              action: 'approval.request.created',
              newValues: {
                approvalType: requiresWriteoffApproval
                  ? INVENTORY_WRITEOFF_CONFIRMATION_TYPE
                  : INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
                sourceEntityType:
                  INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
                sourceEntityId: createdMovement.id,
              },
            },
            tx,
          );
        }

        await this.updateObjectBudget(tx, createdMovement);
        return {
          createdMovement,
        };
    });

    const createdView = await this.prisma.inventoryMovement.findFirst({
      where: {
        id: creationResult.createdMovement.id,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            category: true,
            unit: true,
            isActive: true,
            currentUnitPrice: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        approvalBridgeResolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        relatedObject: {
          select: {
            id: true,
            name: true,
            status: true,
            deletedAt: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                isActive: true,
              },
            },
          },
        },
        relatedOneTimeOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                assignmentRoleCode: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!createdView) {
      throw new NotFoundException('Inventory movement not found after creation');
    }

    const approvalRequestsByEntityId =
      await this.loadPendingApprovalRequestsByMovementIds([
        creationResult.createdMovement.id,
      ]);

    return this.mapMovement(
      createdView as InventoryMovementRecord,
      [],
      approvalRequestsByEntityId.get(creationResult.createdMovement.id) ?? null,
      currentUser,
    );
  }

  /** Inventory exception resolvers share correction's item -> movement order
   * before acquiring an approval row. Authorization still uses locked fresh data. */
  async lockInventoryExceptionSource(tx: Prisma.TransactionClient, movementId: string): Promise<void> {
    const reference = await tx.inventoryMovement.findUnique({ where: { id: movementId }, select: { inventoryItemId: true } });
    if (!reference) throw new NotFoundException('Inventory movement not found');
    await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${reference.inventoryItemId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM inventory_movements WHERE id = ${movementId} FOR UPDATE`;
    const locked = await tx.inventoryMovement.findUnique({ where: { id: movementId }, select: { inventoryItemId: true } });
    if (!locked) throw new NotFoundException('Inventory movement not found');
    if (locked.inventoryItemId !== reference.inventoryItemId) throw new ConflictException('Inventory movement source changed');
  }

  async applyInventoryExceptionApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
    },
  ): Promise<void> {
    const lockedMovements = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "inventory_movements"
      WHERE "id" = ${params.movementId}
      FOR UPDATE
    `;

    if (lockedMovements.length === 0) {
      throw new NotFoundException('Inventory movement not found');
    }

    const movement = await tx.inventoryMovement.findUnique({
      where: {
        id: params.movementId,
      },
      select: {
        id: true,
        status: true,
        createdByUserId: true,
        movementType: true,
        requiresApprovalBridge: true,
        approvalBridgeType: true,
        approvalBridgeResolvedAt: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

    if (movement.createdByUserId === params.actorUserId) throw new ForbiddenException('Собственную отгрузку подтверждает другой пользователь');
    if (!['applied', 'pending_approval'].includes(movement.status)) {
      throw new ConflictException('Отменённую или завершённую отгрузку нельзя подтвердить');
    }
    if (
      movement.movementType !== 'issue_to_object' ||
      !movement.requiresApprovalBridge ||
      movement.approvalBridgeType !== LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE
    ) {
      throw new BadRequestException(
        'Only issue_to_object without photo can be approved through shared approvals',
      );
    }

    const attachmentCount = await tx.fileAttachment.count({
      where: {
        entityType: 'inventory_movement',
        entityId: movement.id,
        file: {
          deletedAt: null,
        },
      },
    });

    if (attachmentCount > 0) {
      throw new BadRequestException(
        'Movement already has evidence and does not need missing photo approval',
      );
    }

    if (movement.approvalBridgeResolvedAt) {
      throw new ConflictException('Inventory exception is already resolved');
    }

    const resolved = await tx.inventoryMovement.updateMany({
      where: {
        id: movement.id,
        approvalBridgeResolvedAt: null,
        status: { in: ['applied', 'pending_approval'] },
      },
      data: {
        approvalBridgeResolvedAt: new Date(),
        approvalBridgeResolvedByUserId: params.actorUserId,
      },
    });

    if (resolved.count !== 1) {
      throw new ConflictException('Inventory exception is already resolved');
    }

    const budgetMovement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } });
    await this.updateObjectBudget(tx, budgetMovement);

    await this.auditService.writeAuditEvent(
      {
        entityType: 'inventory_movement',
        entityId: movement.id,
        actorUserId: params.actorUserId,
        action: 'inventory.missing_photo_approval.resolved',
        newValues: {
          approvalBridgeType: movement.approvalBridgeType,
        },
      },
      tx,
    );
  }

  async applyInventoryWriteoffApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
    },
  ): Promise<void> {
    const lockedMovements = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "inventory_movements"
      WHERE "id" = ${params.movementId}
      FOR UPDATE
    `;

    if (lockedMovements.length === 0) {
      throw new NotFoundException('Inventory movement not found');
    }

    const movement = await tx.inventoryMovement.findUnique({
      where: {
        id: params.movementId,
      },
      select: {
        id: true,
        inventoryItemId: true,
        movementType: true,
        status: true,
        quantity: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

    if (movement.movementType !== 'writeoff') {
      throw new BadRequestException('Only inventory writeoff can use this approval path');
    }

    if (movement.status !== 'pending_approval') {
      throw new ConflictException('Inventory writeoff is already resolved');
    }

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "inventory_items"
      WHERE "id" = ${movement.inventoryItemId}
      FOR UPDATE
    `;

    const stockSummary = await this.loadStockSummaryForItem(
      tx,
      movement.inventoryItemId,
    );
    const nextStock = stockSummary.currentStock - Number(movement.quantity);

    if (nextStock < -0.0001) {
      throw new ConflictException('Insufficient stock to approve inventory writeoff');
    }

    const resolved = await tx.inventoryMovement.updateMany({
      where: {
        id: movement.id,
        status: 'pending_approval',
      },
      data: {
        status: 'applied',
      },
    });

    if (resolved.count !== 1) {
      throw new ConflictException('Inventory writeoff is already resolved');
    }

    await this.auditService.writeAuditEvent(
      {
        entityType: 'inventory_movement',
        entityId: movement.id,
        actorUserId: params.actorUserId,
        action: 'inventory.writeoff.approved',
        newValues: {
          status: 'applied',
          quantity: Number(movement.quantity),
        },
      },
      tx,
    );
  }

  async applyInventoryWriteoffRejectionDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
      decision: 'reject' | 'cancel';
    },
  ): Promise<void> {
    const lockedMovements = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "inventory_movements"
      WHERE "id" = ${params.movementId}
      FOR UPDATE
    `;

    if (lockedMovements.length === 0) {
      throw new NotFoundException('Inventory movement not found');
    }

    const movement = await tx.inventoryMovement.findUnique({
      where: {
        id: params.movementId,
      },
      select: {
        id: true,
        movementType: true,
        status: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

    if (movement.movementType !== 'writeoff') {
      throw new BadRequestException('Only inventory writeoff can use this approval path');
    }

    if (movement.status !== 'pending_approval') {
      throw new ConflictException('Inventory writeoff is already resolved');
    }

    const nextStatus = params.decision === 'reject' ? 'rejected' : 'cancelled';
    const resolved = await tx.inventoryMovement.updateMany({
      where: {
        id: movement.id,
        status: 'pending_approval',
      },
      data: {
        status: nextStatus,
      },
    });

    if (resolved.count !== 1) {
      throw new ConflictException('Inventory writeoff is already resolved');
    }

    await this.auditService.writeAuditEvent(
      {
        entityType: 'inventory_movement',
        entityId: movement.id,
        actorUserId: params.actorUserId,
        action: `inventory.writeoff.${nextStatus}`,
        newValues: {
          status: nextStatus,
        },
      },
      tx,
    );
  }

  async listObjectReferenceOptions(
    currentUser: CurrentAuthUser,
  ): Promise<InventoryObjectReferenceResponseDto[]> {
    this.assertInventoryVisible(currentUser);
    if (!decideAccess(currentUser, 'inventory.references.read', true)) throw new ForbiddenException('Inventory references denied');

    const objects = await this.prisma.object.findMany({
      where: buildObjectBasicProfileAccessWhere({ subject: currentUser,
        roleCodes: this.getRoleCodes(currentUser), permissionCodes: currentUser.permissionCodes }),
      select: {
        id: true,
        name: true,
        status: true,
        deletedAt: true,
        createdByUserId: true,
        assignments: { where: { isActive: true }, select: { userId: true, isActive: true } },
      },
      orderBy: {
        name: 'asc',
      },
    });
    return objects.map(object => ({ id: object.id, name: object.name, status: object.status,
      capabilities: inventoryObjectFormCapabilities(currentUser, object) }));
  }

  async listOneTimeOrderReferenceOptions(
    currentUser: CurrentAuthUser,
  ): Promise<InventoryOrderReferenceResponseDto[]> {
    this.assertInventoryVisible(currentUser);
    if (!decideAccess(currentUser, 'inventory.references.read', true)) throw new ForbiddenException('Inventory references denied');

    const orders = await this.prisma.oneTimeOrder.findMany({
      where: buildOneTimeOrderAccessWhere({ subject: currentUser,
        currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: currentUser.permissionCodes,
      }),
      select: {
        id: true,
        title: true,
        status: true,
        createdByUserId: true,
        assignments: { where: { isActive: true }, select: { userId: true, assignmentRoleCode: true, isActive: true } },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return orders.map(order => ({ id: order.id, title: order.title, status: order.status,
      capabilities: inventoryOrderFormCapabilities(currentUser, order) }));
  }

  private async listObjectScopedMovements(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<InventoryMovementResponseDto[]> {
    const movements = (await this.prisma.inventoryMovement.findMany({
      where: {
        AND: [{ relatedObjectId: objectId }, this.inventoryMovementAccessWhere(currentUser, 'inventory.movements.read', true)],
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            category: true,
            unit: true,
            isActive: true,
            currentUnitPrice: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        approvalBridgeResolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        relatedObject: {
          select: {
            id: true,
            name: true,
            status: true,
            deletedAt: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                isActive: true,
              },
            },
          },
        },
        relatedOneTimeOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                assignmentRoleCode: true,
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
    })) as InventoryMovementRecord[];

    const attachmentsByEntityId = await this.loadMovementAttachments(
      currentUser,
      movements.map((movement) => movement.id),
    );
    const approvalRequestsByEntityId =
      await this.loadPendingApprovalRequestsByMovementIds(
        movements.map((movement) => movement.id),
      );

    return movements.map((movement) =>
      this.mapMovement(
        movement,
        attachmentsByEntityId.get(movement.id) ?? [],
        approvalRequestsByEntityId.get(movement.id) ?? null,
        currentUser,
      ),
    );
  }

  private async listOperationalInventoryItemsForObject(
    currentUser: CurrentAuthUser,
    object: {
      createdByUserId: string;
      assignments: Array<{
        userId: string;
        isActive: boolean;
      }>;
    },
  ): Promise<InventoryItemResponseDto[]> {
    if (!this.canIssueToSpecificObject(currentUser, object)) {
      return [];
    }

    const items = (await this.prisma.inventoryItem.findMany({
      where: {
        AND: [{ isActive: true, deletedAt: null }, this.inventoryItemAccessWhere(currentUser, 'inventory.read', {})],
      },
      include: {
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    })) as InventoryItemRecord[];

    const stockByItemId = await this.loadStockSummariesByItemIds(
      items.map((item) => item.id),
    );
    const capabilities: InventoryGlobalCapabilities = {
      ...this.getGlobalCapabilities(currentUser),
      canAccessInventory: true,
      canCreateInventoryMovement: true,
      canIssueInventoryToObject: true,
    };
    return items.map((item) =>
      this.mapItem(item, stockByItemId.get(item.id), capabilities),
    );
  }

  private async loadObjectScope(objectId: string, db: Prisma.TransactionClient = this.prisma): Promise<{
    id: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive: boolean;
    }>;
  }> {
    const object = await db.object.findFirst({
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
          },
          select: {
            userId: true,
            isActive: true,
          },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Related object not found');
    }

    return object;
  }

  private canIssueToSpecificObject(
    currentUser: CurrentAuthUser,
    object: {
      id?: string;
      createdByUserId: string;
      assignments: Array<{
        userId: string;
        isActive: boolean;
      }>;
    },
  ): boolean {
    const roleCodes = this.getRoleCodes(currentUser);
    const context = { resourceType: 'object', resourceId: object.id, ownerUserId: object.createdByUserId,
      assignedUserIds: object.assignments.filter(a => a.isActive).map(a => a.userId) };
    const inventoryContext = { ...context, parents: [{ actionCode: 'objects.inventory.issue', context }, { actionCode: 'objects.read', context }] };

    const legacy = (
      canIssueInventoryToObject(roleCodes) ||
      hasWideObjectAccess(roleCodes) ||
      object.createdByUserId === currentUser.id ||
      object.assignments.some((assignment) => assignment.userId === currentUser.id) ||
      hasDelegatedObjectAction(currentUser.id, object.id, 'inventory_issue', true, 'inventory.issue_to_object', inventoryContext)
    );
    const objectLeaf = decideAccess(currentUser, 'objects.inventory.issue', legacy, context);
    return decideAccess(currentUser, 'inventory.issue_to_object', objectLeaf, inventoryContext);
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.roleCodes ?? [currentUser.roleCode];
  }

  private getGlobalCapabilities(
    currentUser: CurrentAuthUser,
    inventoryItemId?: string,
  ): InventoryGlobalCapabilities {
    return buildInventoryGlobalCapabilities(
      this.getRoleCodes(currentUser),
      currentUser.permissionCodes,
      currentUser,
      { resourceType: 'inventory_item', resourceId: inventoryItemId },
    );
  }

  private inventoryItemAccessWhere(
    user: CurrentAuthUser,
    actionCode: string,
    scopedLegacyWhere?: Prisma.InventoryItemWhereInput,
  ): Prisma.InventoryItemWhereInput {
    const roles = this.getRoleCodes(user);
    const legacyAllowed = actionCode === 'inventory.reports'
      ? canViewInventoryReports(roles)
      : canAccessInventory(roles);
    return buildAccessWhere<Prisma.InventoryItemWhereInput>({ subject: user, actionCode,
      legacyWhere: legacyAllowed ? {} : scopedLegacyWhere ?? { id: { in: [] } }, invariantWhere: {},
      scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : null,
    }) as Prisma.InventoryItemWhereInput;
  }

  private inventoryMovementAccessWhere(user: CurrentAuthUser, actionCode: string, scoped = false): Prisma.InventoryMovementWhereInput {
    return inventoryMovementVisibilityWhere(user, actionCode, scoped ? {} : undefined);
  }

  private normalizeCreateItemPayload(payload: CreateInventoryItemDto): {
    name: string;
    category: string;
    unit: string;
    notes: string | null;
  } {
    return {
      name: this.normalizeCatalogText(payload.name, 'name', 2, 200),
      category: this.normalizeCatalogText(
        payload.category,
        'category',
        2,
        100,
      ),
      unit: this.normalizeCatalogText(payload.unit, 'unit', 1, 50),
      notes: this.normalizeCatalogNotes(payload.notes),
    };
  }

  private normalizeUpdateItemPayload(payload: UpdateInventoryItemDto): {
    name?: string;
    category?: string;
    unit?: string;
    notes?: string | null;
  } {
    return {
      ...(payload.name === undefined
        ? {}
        : { name: this.normalizeCatalogText(payload.name, 'name', 2, 200) }),
      ...(payload.category === undefined
        ? {}
        : {
            category: this.normalizeCatalogText(
              payload.category,
              'category',
              2,
              100,
            ),
          }),
      ...(payload.unit === undefined
        ? {}
        : { unit: this.normalizeCatalogText(payload.unit, 'unit', 1, 50) }),
      ...(payload.notes === undefined
        ? {}
        : { notes: this.normalizeCatalogNotes(payload.notes) }),
    };
  }

  private normalizeCatalogText(
    value: string,
    field: string,
    minLength: number,
    maxLength: number,
  ): string {
    const normalized = value.trim();

    if (
      normalized.length < minLength ||
      normalized.length > maxLength
    ) {
      throw new BadRequestException(
        `${field} length must be between ${minLength} and ${maxLength} characters after trim`,
      );
    }

    return normalized;
  }

  private normalizeCatalogNotes(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = value.trim();

    if (normalized.length > 4000) {
      throw new BadRequestException(
        'notes length must not exceed 4000 characters after trim',
      );
    }

    return normalized || null;
  }

  private async assertNoActiveItemDuplicate(
    tx: Prisma.TransactionClient,
    item: { name: string; category: string; unit: string },
    excludeItemId?: string,
  ): Promise<void> {
    const duplicate = await tx.inventoryItem.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
        name: { equals: item.name.trim(), mode: 'insensitive' },
        category: { equals: item.category.trim(), mode: 'insensitive' },
        unit: { equals: item.unit.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (duplicate) {
      this.throwInventoryItemDuplicate();
    }
  }

  private async assertItemDeletable(
    tx: Prisma.TransactionClient,
    itemId: string,
  ): Promise<void> {
    const [stockSummary, movements] = await Promise.all([
      this.loadStockSummaryForItem(tx, itemId),
      tx.inventoryMovement.findMany({
        where: { inventoryItemId: itemId },
        select: { id: true, status: true },
      }),
    ]);
    const movementIds = movements.map((movement) => movement.id);
    const pendingApproval =
      movementIds.length === 0
        ? null
        : await tx.approvalRequest.findFirst({
            where: {
              sourceEntityType:
                INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
              sourceEntityId: { in: movementIds },
              status: 'pending',
            },
            select: { id: true },
          });
    const reasons: string[] = [];

    if (Math.abs(stockSummary.currentStock) > 0.0001) {
      reasons.push('non_zero_stock');
    }

    if (movements.some((movement) => movement.status === 'pending_approval')) {
      reasons.push('pending_movement');
    }

    if (pendingApproval) {
      reasons.push('pending_approval');
    }

    if (reasons.length > 0) {
      throw new ConflictException({
        code: 'INVENTORY_ITEM_DELETE_BLOCKED',
        message: 'Inventory item cannot be deleted in its current state',
        reasons,
        currentStock: Number(stockSummary.currentStock.toFixed(3)),
      });
    }
  }

  private buildItemAuditSnapshot(item: {
    name: string;
    category: string;
    unit: string;
    notes: string | null;
    isActive: boolean;
    version: number;
    deletedAt?: Date | null;
    deletedByUserId?: string | null;
  }): Prisma.InputJsonObject {
    return {
      name: item.name,
      category: item.category,
      unit: item.unit,
      notes: item.notes,
      isActive: item.isActive,
      version: item.version,
      deletedAt: item.deletedAt?.toISOString() ?? null,
      deletedByUserId: item.deletedByUserId ?? null,
    };
  }

  private rethrowInventoryItemDuplicate(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      this.throwInventoryItemDuplicate();
    }

    throw error;
  }

  private throwInventoryItemDuplicate(): never {
    throw new ConflictException({
      code: 'INVENTORY_ITEM_DUPLICATE',
      message: 'An active inventory item with the same identity already exists',
    });
  }

  private assertItemNotDenied(currentUser: CurrentAuthUser, inventoryItemId: string): void {
    if (hasModuleDeny(currentUser, 'inventory.read', { resourceType: 'inventory_item', resourceId: inventoryItemId })) throw new ForbiddenException('Inventory item access denied');
  }

  private assertInventoryVisible(currentUser: CurrentAuthUser): void {
    if (hasModuleDeny(currentUser, 'inventory.access')) throw new ForbiddenException('Inventory access denied');
    if (!decideAccess(currentUser, 'inventory.access', canAccessInventory(this.getRoleCodes(currentUser))) &&
        !currentUser.accessRules?.some(r => r.effect === 'allow' && ['inventory.access', 'inventory.read'].includes(r.actionCode))) {
      throw new ForbiddenException('Inventory access denied');
    }
  }

  private assertCatalogManageable(currentUser: CurrentAuthUser): void {
    if (!decideAccess(currentUser, 'inventory.catalog.update', canManageInventoryCatalog(this.getRoleCodes(currentUser)))) {
      throw new ForbiddenException('Inventory catalog management denied');
    }
  }

  private async assertMovementCreatable(currentUser: CurrentAuthUser, movementType: string, payload?: CreateInventoryMovementDto): Promise<void> {
    if (!INVENTORY_MOVEMENT_TYPES.includes(movementType as InventoryMovementType)) throw new BadRequestException('Unsupported movement type');
    if (movementType === 'issue_to_object' && payload?.relatedObjectId) {
      const object = await this.loadObjectScope(payload.relatedObjectId);
      if (!inventoryObjectFormCapabilities(currentUser, object).canIssueToObject) throw new ForbiddenException('Inventory movement creation denied');
      return;
    }
    if (movementType === 'issue_to_one_time_order' && payload?.relatedOneTimeOrderId) {
      const order = await this.loadOrderInventoryScope(this.prisma, payload.relatedOneTimeOrderId);
      if (!inventoryOrderFormCapabilities(currentUser, order).canIssueToOneTimeOrder) throw new ForbiddenException('Use the order-scoped issue endpoint with a request ID');
      return;
    }
    const roles = this.getRoleCodes(currentUser);
    const legacy: Record<string, boolean> = { receipt: canCreateInventoryReceipt(roles), issue_to_object: canIssueInventoryToObject(roles),
      issue_to_one_time_order: canIssueInventoryToOneTimeOrder(roles), return: canReturnInventory(roles),
      writeoff: canWriteoffInventory(roles), adjustment: canAdjustInventory(roles) };
    const context = movementType === 'issue_to_object'
      ? { resourceType: 'object', resourceId: payload?.relatedObjectId }
      : movementType === 'issue_to_one_time_order'
        ? { resourceType: 'one_time_order', resourceId: payload?.relatedOneTimeOrderId }
        : { resourceType: 'inventory_item', resourceId: payload?.inventoryItemId };
    if (!decideAccess(currentUser, `inventory.${movementType}`, legacy[movementType], context)) throw new ForbiddenException('Inventory movement creation denied');
    if (movementType === 'issue_to_one_time_order' && !legacy[movementType]) throw new ForbiddenException('Use the order-scoped issue endpoint with a request ID');
  }

  private async assertScopedTargets(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const objectId = payload.relatedObjectId ?? null;
    const oneTimeOrderId = payload.relatedOneTimeOrderId ?? null;

    if (objectId && oneTimeOrderId) {
      throw new BadRequestException(
        'Movement cannot reference object and one-time order simultaneously',
      );
    }

    if (objectId) {
      const object = await this.loadObjectScope(objectId, db);
      if (!canReadInventoryObjectTarget(currentUser, object)) throw new ForbiddenException('Related object access denied');
      if (payload.movementType === 'issue_to_object' && !canUseInventoryObjectIssueTarget(currentUser, object)) throw new ForbiddenException('Object inventory issue denied');
    }

    if (oneTimeOrderId) {
      const order = await this.loadOrderInventoryScope(db, oneTimeOrderId);
      if (!inventoryOrderFormCapabilities(currentUser, order).canLinkMovement) throw new ForbiddenException('Related one-time order access denied');
    }
  }

  private normalizeMovementPayload(
    payload: CreateInventoryMovementDto,
    currentUnitPrice: Prisma.Decimal | null,
  ): {
    movementType: InventoryMovementType;
    quantity: Prisma.Decimal;
    unitPriceSnapshot: Prisma.Decimal;
    totalAmountSnapshot: Prisma.Decimal;
    signedQuantity: number;
    adjustmentDirection: string | null;
    comment: string | null;
    evidenceRequired: boolean;
    requiresApprovalBridge: boolean;
    approvalBridgeType: string | null;
    relatedObjectId: string | null;
    relatedOneTimeOrderId: string | null;
  } {
    const movementType = payload.movementType as InventoryMovementType;
    const quantityValue = Number(payload.quantity);
    const quantity = new Prisma.Decimal(quantityValue);
    const comment = payload.comment?.trim() || null;
    const relatedObjectId = payload.relatedObjectId ?? null;
    const relatedOneTimeOrderId = payload.relatedOneTimeOrderId ?? null;
    const unitPriceSnapshot = this.resolveUnitPriceSnapshot(
      movementType,
      payload.unitPrice,
      currentUnitPrice,
    );
    const totalAmountSnapshot = unitPriceSnapshot.mul(quantity);
    const buildMovement = (params: {
      signedQuantity: number;
      adjustmentDirection: string | null;
      relatedObjectId: string | null;
      relatedOneTimeOrderId: string | null;
    }) => {
      const evidenceRequired = this.resolveEvidenceRequired(
        movementType,
        params.adjustmentDirection,
        payload.evidenceRequired,
      );
      const requiresApprovalBridge =
        evidenceRequired && movementType !== 'writeoff';

      return {
        movementType,
        quantity,
        unitPriceSnapshot,
        totalAmountSnapshot,
        signedQuantity: params.signedQuantity,
        adjustmentDirection: params.adjustmentDirection,
        comment,
        evidenceRequired,
        requiresApprovalBridge,
        approvalBridgeType: requiresApprovalBridge
          ? movementType === 'issue_to_object'
            ? 'inventory_without_photo_confirmation'
            : 'inventory_missing_photo_evidence_required'
          : null,
        relatedObjectId: params.relatedObjectId,
        relatedOneTimeOrderId: params.relatedOneTimeOrderId,
      };
    };

    switch (movementType) {
      case 'receipt':
        if (relatedObjectId || relatedOneTimeOrderId) {
          throw new BadRequestException(
            'Receipt movement cannot reference object or one-time order',
          );
        }
        return buildMovement({
          signedQuantity: quantityValue,
          adjustmentDirection: null,
          relatedObjectId: null,
          relatedOneTimeOrderId: null,
        });
      case 'issue_to_object':
        if (!relatedObjectId || relatedOneTimeOrderId) {
          throw new BadRequestException(
            'Issue to object requires relatedObjectId and forbids relatedOneTimeOrderId',
          );
        }
        return buildMovement({
          signedQuantity: -quantityValue,
          adjustmentDirection: null,
          relatedObjectId,
          relatedOneTimeOrderId: null,
        });
      case 'issue_to_one_time_order':
        if (!relatedOneTimeOrderId || relatedObjectId) {
          throw new BadRequestException(
            'Issue to one-time order requires relatedOneTimeOrderId and forbids relatedObjectId',
          );
        }
        return buildMovement({
          signedQuantity: -quantityValue,
          adjustmentDirection: null,
          relatedObjectId: null,
          relatedOneTimeOrderId,
        });
      case 'return':
        if (!relatedObjectId && !relatedOneTimeOrderId) {
          throw new BadRequestException(
            'Return movement requires relatedObjectId or relatedOneTimeOrderId',
          );
        }
        return buildMovement({
          signedQuantity: quantityValue,
          adjustmentDirection: null,
          relatedObjectId,
          relatedOneTimeOrderId,
        });
      case 'writeoff':
        return buildMovement({
          signedQuantity: -quantityValue,
          adjustmentDirection: null,
          relatedObjectId,
          relatedOneTimeOrderId,
        });
      case 'adjustment':
        if (relatedObjectId || relatedOneTimeOrderId) {
          throw new BadRequestException(
            'Adjustment movement cannot reference object or one-time order',
          );
        }
        if (!payload.adjustmentDirection) {
          throw new BadRequestException(
            'Adjustment movement requires adjustmentDirection',
          );
        }
        return buildMovement({
          signedQuantity:
            payload.adjustmentDirection === 'increase'
              ? quantityValue
              : -quantityValue,
          adjustmentDirection: payload.adjustmentDirection,
          relatedObjectId: null,
          relatedOneTimeOrderId: null,
        });
    }
  }

  private async loadStockSummariesByItemIds(itemIds: string[], historyViewer?: CurrentAuthUser): Promise<
    Map<
      string,
      {
        currentStock: number;
        movementsCount: number;
        visibleMovementsCount: number;
        receiptsCount: number;
        issuesCount: number;
          returnsCount: number;
          writeoffsCount: number;
          adjustmentsCount: number;
          pendingMovementsCount: number;
          pendingApprovalsCount: number;
        }
      >
  > {
    const result = new Map<
      string,
      {
        currentStock: number;
        movementsCount: number;
        visibleMovementsCount: number;
        receiptsCount: number;
        issuesCount: number;
          returnsCount: number;
          writeoffsCount: number;
          adjustmentsCount: number;
          pendingMovementsCount: number;
          pendingApprovalsCount: number;
        }
      >();

    if (itemIds.length === 0) {
      return result;
    }

    const [movements, visibleMovements] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where: { inventoryItemId: { in: itemIds } },
        select: {
          id: true,
          inventoryItemId: true,
          movementType: true,
          status: true,
          quantity: true,
          adjustmentDirection: true,
        },
      }),
      historyViewer ? this.prisma.inventoryMovement.findMany({
        where: { AND: [
          { inventoryItemId: { in: itemIds } },
          this.inventoryMovementAccessWhere(historyViewer, 'inventory.movements.read'),
        ] },
        select: { id: true },
      }) : [],
    ]);
    const visibleMovementIds = new Set(visibleMovements.map(({ id }) => id));
    const movementItemById = new Map(
      movements.map((movement) => [movement.id, movement.inventoryItemId]),
    );
    const pendingApprovals =
      movements.length === 0
        ? []
        : await this.prisma.approvalRequest.findMany({
            where: {
              sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
              sourceEntityId: { in: movements.map((movement) => movement.id) },
              status: 'pending',
            },
            select: { sourceEntityId: true },
          });

    for (const movement of movements) {
      const current = result.get(movement.inventoryItemId) ?? {
        currentStock: 0,
        movementsCount: 0,
        visibleMovementsCount: 0,
        receiptsCount: 0,
        issuesCount: 0,
        returnsCount: 0,
        writeoffsCount: 0,
        adjustmentsCount: 0,
        pendingMovementsCount: 0,
        pendingApprovalsCount: 0,
      };

      if (movement.status === 'applied') {
        current.currentStock += this.calculateSignedQuantity({
          movementType: movement.movementType as InventoryMovementType,
          quantity: Number(movement.quantity),
          adjustmentDirection: movement.adjustmentDirection,
        });
      }
      current.movementsCount += 1;

      if (movement.status === 'pending_approval') {
        current.pendingMovementsCount += 1;
      }

      result.set(movement.inventoryItemId, current);
      if (!visibleMovementIds.has(movement.id)) continue;

      current.visibleMovementsCount += 1;
      switch (movement.movementType as InventoryMovementType) {
        case 'receipt':
          current.receiptsCount += 1;
          break;
        case 'issue_to_object':
        case 'issue_to_one_time_order':
          current.issuesCount += 1;
          break;
        case 'return':
          current.returnsCount += 1;
          break;
        case 'writeoff':
          current.writeoffsCount += 1;
          break;
        case 'adjustment':
          current.adjustmentsCount += 1;
          break;
      }
    }

    for (const approval of pendingApprovals) {
      const itemId = movementItemById.get(approval.sourceEntityId);

      if (itemId) {
        const current = result.get(itemId);

        if (current) {
          current.pendingApprovalsCount += 1;
        }
      }
    }

    return result;
  }

  private async loadStockSummaryForItem(
    tx: Prisma.TransactionClient,
    itemId: string,
  ): Promise<{
    currentStock: number;
  }> {
    const movements = await tx.inventoryMovement.findMany({
      where: {
        inventoryItemId: itemId,
        status: 'applied',
      },
      select: {
        movementType: true,
        quantity: true,
        adjustmentDirection: true,
      },
    });

    return {
      currentStock: movements.reduce(
        (sum, movement) =>
          sum +
          this.calculateSignedQuantity({
            movementType: movement.movementType as InventoryMovementType,
            quantity: Number(movement.quantity),
            adjustmentDirection: movement.adjustmentDirection,
          }),
        0,
      ),
    };
  }

  private calculateSignedQuantity(params: {
    movementType: InventoryMovementType;
    quantity: number;
    adjustmentDirection: string | null;
  }): number {
    switch (params.movementType) {
      case 'receipt':
      case 'return':
        return params.quantity;
      case 'issue_to_object':
      case 'issue_to_one_time_order':
      case 'writeoff':
        return -params.quantity;
      case 'adjustment':
        return params.adjustmentDirection === 'increase'
          ? params.quantity
          : -params.quantity;
    }
  }

  private resolveUnitPriceSnapshot(
    movementType: InventoryMovementType,
    requestedUnitPrice: number | undefined,
    currentUnitPrice: Prisma.Decimal | null,
  ): Prisma.Decimal {
    if (movementType === 'receipt') {
      if (requestedUnitPrice === undefined) {
        throw new BadRequestException('Receipt movement requires unitPrice');
      }

      return new Prisma.Decimal(requestedUnitPrice);
    }

    if (!currentUnitPrice) {
      throw new BadRequestException(
        'Inventory item has no current unit price; create a receipt first',
      );
    }

    return currentUnitPrice;
  }

  private resolveEvidenceRequired(
    movementType: InventoryMovementType,
    adjustmentDirection: string | null,
    requestedEvidenceRequired: boolean | undefined,
  ): boolean {
    const mandatoryEvidence =
      movementType === 'issue_to_object' ||
      movementType === 'issue_to_one_time_order' ||
      movementType === 'writeoff' ||
      (movementType === 'adjustment' && adjustmentDirection === 'decrease');

    if (mandatoryEvidence) {
      return true;
    }

    return (
      requestedEvidenceRequired ??
      defaultEvidenceRequiredForMovementType(movementType)
    );
  }

  private buildItemListWhere(
    query: ListInventoryItemsQueryDto,
  ): Prisma.InventoryItemWhereInput {
    const search = query.search?.trim();
    const category = query.category?.trim();

    return {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { category: { contains: search, mode: 'insensitive' as const } },
              { unit: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(category
        ? { category: { equals: category, mode: 'insensitive' as const } }
        : {}),
      ...(query.isActive === undefined
        ? {}
        : query.isActive
          ? { isActive: true, deletedAt: null }
          : { deletedAt: { not: null } }),
    };
  }

  private buildMovementListWhere(
    query: ListInventoryMovementsQueryDto,
  ): Prisma.InventoryMovementWhereInput {
    return {
      ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.objectId ? { relatedObjectId: query.objectId } : {}),
      ...(query.oneTimeOrderId
        ? { relatedOneTimeOrderId: query.oneTimeOrderId }
        : {}),
      ...(query.approvalBridge === 'true'
        ? { requiresApprovalBridge: true, approvalBridgeResolvedAt: null }
        : {}),
      ...this.buildDateRangeWhere(query),
    };
  }

  private buildDateRangeWhere(query: ListInventoryMovementsQueryDto): {
    createdAt?: {
      gte?: Date;
      lte?: Date;
    };
  } {
    if (!query.dateFrom && !query.dateTo) {
      return {};
    }

    return {
      createdAt: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    };
  }

  private async loadMovementViewById(
    movementId: string,
  ): Promise<InventoryMovementRecord> {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: {
        id: movementId,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            category: true,
            unit: true,
            isActive: true,
            currentUnitPrice: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        approvalBridgeResolvedBy: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
        relatedObject: {
          select: {
            id: true,
            name: true,
            status: true,
            deletedAt: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                isActive: true,
              },
            },
          },
        },
        relatedOneTimeOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            createdByUserId: true,
            assignments: {
              where: { isActive: true },
              select: {
                userId: true,
                assignmentRoleCode: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

    return movement as InventoryMovementRecord;
  }

  private async loadMovementAttachments(
    currentUser: CurrentAuthUser,
    movementIds: string[],
  ): Promise<Map<string, SafeFileResponseDto[]>> {
    const result = new Map<string, SafeFileResponseDto[]>();

    if (movementIds.length === 0) {
      return result;
    }

    const attachments = (await this.prisma.fileAttachment.findMany({
      where: {
        entityType: 'inventory_movement',
        entityId: {
          in: movementIds,
        },
        file: {
          deletedAt: null,
        },
      },
      select: {
        entityId: true,
        file: {
          select: {
            id: true,
            uploadedByUserId: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })) as FileAttachmentRecord[];

    if (attachments.length === 0) return result;

    // Ledger visibility is not an independent grant to a movement's files.
    // Keep the same source baseline and file context as FilesService.
    const sourceIds = [...new Set(attachments.map((attachment) => attachment.entityId))];
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        createdByUserId: true,
        relatedObject: { select: {
          id: true, createdByUserId: true,
          assignments: { where: { isActive: true }, select: { userId: true } },
        } },
        relatedOneTimeOrder: { select: {
          createdByUserId: true,
          assignments: { where: { isActive: true }, select: {
            userId: true, assignmentRoleCode: true, isActive: true,
          } },
        } },
      },
    });
    const targets = new Map(await Promise.all(sourceIds.map(async (id) =>
      [id, await resourceAccessTarget(this.prisma, 'inventory_movement', id)] as const,
    )));
    const roleCodes = this.getRoleCodes(currentUser);
    const readableSources = new Set(movements.filter((movement) => {
      const target = targets.get(movement.id);
      if (!target) return false;
      const legacy = canAccessInventory(roleCodes) ||
        hasDelegatedObjectAction(currentUser.id, movement.relatedObject?.id, 'view', true,
          'inventory.movements.read', target.context) ||
        movement.createdByUserId === currentUser.id ||
        (!!movement.relatedObject && (movement.relatedObject.createdByUserId === currentUser.id ||
          movement.relatedObject.assignments.some((assignment) => assignment.userId === currentUser.id))) ||
        (!!movement.relatedOneTimeOrder && canViewOneTimeOrderByScope({
          currentUserId: currentUser.id, roleCodes, permissionCodes: currentUser.permissionCodes,
          order: movement.relatedOneTimeOrder,
        }));
      return decideAccess(currentUser, target.actionCode, legacy, target.context);
    }).map((movement) => movement.id));

    for (const attachment of attachments) {
      const target = targets.get(attachment.entityId);
      if (!target || !readableSources.has(attachment.entityId) ||
        !decideAccess(currentUser, 'files.read', true, {
          resourceType: 'file', resourceId: attachment.file.id,
          ownerUserId: attachment.file.uploadedByUserId ?? undefined,
          assignedUserIds: target.context.assignedUserIds, parents: [target],
        })) continue;
      const current = result.get(attachment.entityId) ?? [];
      current.push(mapSafeFileResponse(attachment.file));
      result.set(attachment.entityId, current);
    }

    return result;
  }

  private async loadPendingApprovalRequestsByMovementIds(
    movementIds: string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        approvalType: string;
        status: string;
      }
    >
  > {
    const result = new Map<
      string,
      {
        id: string;
        approvalType: string;
        status: string;
      }
    >();

    if (movementIds.length === 0) {
      return result;
    }

    const approvalRequests = await this.prisma.approvalRequest.findMany({
      where: {
        sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: {
          in: movementIds,
        },
        status: 'pending',
      },
      select: {
        id: true,
        approvalType: true,
        status: true,
        sourceEntityId: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    for (const request of approvalRequests) {
      if (!result.has(request.sourceEntityId)) {
        result.set(request.sourceEntityId, {
          id: request.id,
          approvalType: request.approvalType,
          status: request.status,
        });
      }
    }

    return result;
  }

  private mapItem(
    item: InventoryItemRecord,
    stockSummary:
      | {
          currentStock: number;
          movementsCount: number;
          visibleMovementsCount: number;
          receiptsCount: number;
          issuesCount: number;
          returnsCount: number;
          writeoffsCount: number;
          adjustmentsCount: number;
          pendingMovementsCount: number;
          pendingApprovalsCount: number;
        }
      | undefined,
    capabilities: InventoryGlobalCapabilities,
  ): InventoryItemResponseDto {
    const currentStock = Number((stockSummary?.currentStock ?? 0).toFixed(3));
    const currentUnitPrice =
      item.currentUnitPrice === null ? null : Number(item.currentUnitPrice);
    const blockerCodes = [
      ...(Math.abs(currentStock) > 0.0001 ? ['non_zero_stock'] : []),
      ...((stockSummary?.pendingMovementsCount ?? 0) > 0
        ? ['pending_movement']
        : []),
      ...((stockSummary?.pendingApprovalsCount ?? 0) > 0
        ? ['pending_approval']
        : []),
    ];

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      isActive: item.isActive,
      deletedAt: item.deletedAt?.toISOString() ?? null,
      notes: item.notes,
      currentUnitPrice,
      version: item.version,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: item.createdBy,
      currentStock,
      currentEstimatedTotalValue: Number(
        (currentStock * (currentUnitPrice ?? 0)).toFixed(2),
      ),
      summary: capabilities.canViewInventoryMovements ? {
        movementsCount: stockSummary?.visibleMovementsCount ?? 0,
        receiptsCount: stockSummary?.receiptsCount ?? 0,
        issuesCount: stockSummary?.issuesCount ?? 0,
        returnsCount: stockSummary?.returnsCount ?? 0,
        writeoffsCount: stockSummary?.writeoffsCount ?? 0,
        adjustmentsCount: stockSummary?.adjustmentsCount ?? 0,
      } : null,
      archiveState: {
        canArchive: item.isActive && !item.deletedAt && blockerCodes.length === 0,
        pendingMovementsCount: stockSummary?.pendingMovementsCount ?? 0,
        pendingApprovalsCount: stockSummary?.pendingApprovalsCount ?? 0,
        blockerCodes,
      },
      deletionState: {
        canDelete:
          item.isActive &&
          !item.deletedAt &&
          capabilities.canDeleteInventoryItem &&
          blockerCodes.length === 0,
        mode: (stockSummary?.movementsCount ?? 0) === 0 ? 'hard' : 'soft',
        pendingMovementsCount: stockSummary?.pendingMovementsCount ?? 0,
        pendingApprovalsCount: stockSummary?.pendingApprovalsCount ?? 0,
        blockerCodes,
      },
      capabilities: {
        canEditCatalog: capabilities.canManageInventoryCatalog,
        canDelete: capabilities.canDeleteInventoryItem,
        canRestore: !item.isActive && !!item.deletedAt && (capabilities.canRestoreInventoryItem ?? false),
        canCreateMovement: capabilities.canCreateInventoryMovement,
        canCreateReceipt: capabilities.canCreateInventoryReceipt,
        canIssueToObject: capabilities.canIssueInventoryToObject,
        canIssueToOneTimeOrder: capabilities.canIssueInventoryToOneTimeOrder,
        canReturn: capabilities.canReturnInventory,
        canWriteoff: capabilities.canWriteoffInventory,
        canAdjust: capabilities.canAdjustInventory,
        canViewReports: capabilities.canViewInventoryReports,
        canViewMovements: capabilities.canViewInventoryMovements,
      },
    };
  }

  private mapMovement(
    movement: InventoryMovementRecord,
    attachments: SafeFileResponseDto[],
    approvalRequest:
      | {
          id: string;
          approvalType: string;
          status: string;
        }
      | null,
    currentUser: CurrentAuthUser,
  ): InventoryMovementResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const signedQuantity = this.calculateSignedQuantity({
      movementType: movement.movementType as InventoryMovementType,
      quantity: Number(movement.quantity),
      adjustmentDirection: movement.adjustmentDirection,
    });
    const hasEvidence = attachments.length > 0;
    const isPendingMissingPhotoBridge =
      movement.requiresApprovalBridge &&
      !hasEvidence &&
      !movement.approvalBridgeResolvedAt &&
      movement.approvalBridgeType === 'inventory_without_photo_confirmation';
    const canViewRelatedOrder = movement.relatedOneTimeOrder
      ? canViewOneTimeOrderByScope({ subject: currentUser,
          currentUserId: currentUser.id,
          roleCodes,
          permissionCodes: currentUser.permissionCodes,
          order: movement.relatedOneTimeOrder,
        })
      : false;

    return {
      id: movement.id,
      inventoryItem: movement.inventoryItem,
      movementType: movement.movementType,
      status: movement.status,
      quantity: Number(movement.quantity),
      signedQuantity: Number(signedQuantity.toFixed(3)),
      unitPriceSnapshot: Number(movement.unitPriceSnapshot),
      totalAmountSnapshot: Number(movement.totalAmountSnapshot),
      adjustmentDirection: movement.adjustmentDirection,
      comment: movement.comment,
      evidenceRequired: movement.evidenceRequired,
      createdAt: movement.createdAt.toISOString(),
      updatedAt: movement.updatedAt.toISOString(),
      createdBy: movement.createdBy,
      relatedObject: movement.relatedObject
        ? {
            id: movement.relatedObject.id,
            name: movement.relatedObject.name,
            canOpenObjectCard: canViewObjectByScope({ subject: currentUser,
              currentUserId: currentUser.id,
              roleCodes,
              object: movement.relatedObject,
            }),
          }
        : null,
      relatedOneTimeOrder: movement.relatedOneTimeOrder && canViewRelatedOrder
        ? {
            id: movement.relatedOneTimeOrder.id,
            title: movement.relatedOneTimeOrder.title,
            status: movement.relatedOneTimeOrder.status,
            canOpenOrderCard: true,
          }
        : null,
      attachments,
      approvalRequest,
      projection: {
        canAttachStandalonePhoto: canAttachStandaloneInventoryPhoto(currentUser, {
          ...movement, inventoryItemId: movement.inventoryItem.id, createdByUserId: movement.createdBy.id,
        }, canCreateInventoryMovement(roleCodes)) && decideAccess(currentUser, 'files.upload', true, {
          resourceType: 'file', ownerUserId: currentUser.id,
        }),
        canCorrectMovement: canCorrectInventoryMovement(currentUser, movement),
        hasEvidence,
        requiresApprovalBridge:
          movement.requiresApprovalBridge &&
          !hasEvidence &&
          !movement.approvalBridgeResolvedAt,
        approvalBridgeType:
          movement.requiresApprovalBridge &&
          !hasEvidence &&
          !movement.approvalBridgeResolvedAt
            ? movement.approvalBridgeType
            : null,
        approvalBridgeResolvedAt:
          movement.approvalBridgeResolvedAt?.toISOString() ?? null,
        approvalBridgeResolvedBy: movement.approvalBridgeResolvedBy,
        isSensitive: isSensitiveInventoryMovementType(
          movement.movementType as InventoryMovementType,
        ),
        canResolveMissingPhotoApproval:
          isPendingMissingPhotoBridge &&
          movement.createdBy.id !== currentUser.id &&
          !hasModuleDeny(currentUser, 'inventory.read', { resourceType: 'inventory_item', resourceId: movement.inventoryItem.id }) &&
          decideAccess(currentUser, 'inventory.resolve_missing_photo', canResolveInventoryMissingPhotoApproval(roleCodes), { resourceType: 'inventory_item', resourceId: movement.inventoryItem.id }),
      },
    };
  }
}
