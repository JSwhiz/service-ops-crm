import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import {
  canViewObjectByScope,
  hasWideObjectAccess,
} from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { canViewOneTimeOrderByScope } from '../one-time-orders/utils/one-time-order-access.util';

import { CreateObjectInventoryIssueDto } from './dto/create-object-inventory-issue.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { InventoryMovementResponseDto } from './dto/inventory-movement-response.dto';
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
  canAdjustInventory,
  canCreateInventoryMovement,
  canCreateInventoryReceipt,
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

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

type InventoryItemRecord = {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  notes: string | null;
  currentUnitPrice: Prisma.Decimal | null;
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
  movementType: string;
  quantity: Prisma.Decimal;
  unitPriceSnapshot: Prisma.Decimal;
  totalAmountSnapshot: Prisma.Decimal;
  adjustmentDirection: string | null;
  comment: string | null;
  evidenceRequired: boolean;
  requiresApprovalBridge: boolean;
  approvalBridgeType: string | null;
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
  relatedObject: {
    id: string;
    name: string;
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
    bucket: string;
    objectKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByUserId: string | null;
    createdAt: Date;
    attachments: Array<{
      id: string;
      entityType: string;
      entityId: string;
      fieldCode: string | null;
      uploadedByUserId: string | null;
      createdAt: Date;
    }>;
  };
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listItems(
    currentUser: CurrentAuthUser,
    query: ListInventoryItemsQueryDto,
  ): Promise<InventoryItemResponseDto[]> {
    this.assertInventoryVisible(currentUser);

    const items = (await this.prisma.inventoryItem.findMany({
      where: {
        ...(query.search?.trim()
          ? {
              OR: [
                {
                  name: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  category: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  unit: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
        ...(query.category?.trim()
          ? {
              category: {
                equals: query.category.trim(),
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
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
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })) as InventoryItemRecord[];

    const stockByItemId = await this.loadStockSummariesByItemIds(
      items.map((item) => item.id),
    );
    const capabilities = this.getGlobalCapabilities(currentUser);

    return items.map((item) =>
      this.mapItem(item, stockByItemId.get(item.id), capabilities),
    );
  }

  async getItemById(
    currentUser: CurrentAuthUser,
    id: string,
  ): Promise<InventoryItemResponseDto> {
    this.assertInventoryVisible(currentUser);

    const item = (await this.prisma.inventoryItem.findFirst({
      where: {
        id,
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

    const stockByItemId = await this.loadStockSummariesByItemIds([item.id]);

    return this.mapItem(
      item,
      stockByItemId.get(item.id),
      this.getGlobalCapabilities(currentUser),
    );
  }

  async createItem(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryItemDto,
  ): Promise<InventoryItemResponseDto> {
    this.assertCatalogManageable(currentUser);

    const created = (await this.prisma.inventoryItem.create({
      data: {
        name: payload.name.trim(),
        category: payload.category.trim(),
        unit: payload.unit.trim(),
        isActive: payload.isActive ?? true,
        notes: payload.notes?.trim() || null,
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

    await this.auditService.writeAuditEvent({
      entityType: 'inventory_item',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'inventory.item.created',
      newValues: {
        name: created.name,
        category: created.category,
        unit: created.unit,
        isActive: created.isActive,
        notes: created.notes,
      },
    });

    return this.mapItem(
      created,
      undefined,
      this.getGlobalCapabilities(currentUser),
    );
  }

  async updateItem(
    currentUser: CurrentAuthUser,
    id: string,
    payload: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponseDto> {
    this.assertCatalogManageable(currentUser);

    const existing = await this.prisma.inventoryItem.findFirst({
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
    });

    if (!existing) {
      throw new NotFoundException('Inventory item not found');
    }

    const updated = (await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
        ...(payload.category === undefined
          ? {}
          : { category: payload.category.trim() }),
        ...(payload.unit === undefined ? {} : { unit: payload.unit.trim() }),
        ...(payload.isActive === undefined
          ? {}
          : { isActive: payload.isActive }),
        ...(payload.notes === undefined
          ? {}
          : { notes: payload.notes?.trim() || null }),
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

    await this.auditService.writeAuditEvent({
      entityType: 'inventory_item',
      entityId: updated.id,
      actorUserId: currentUser.id,
      action: 'inventory.item.updated',
      oldValues: {
        name: existing.name,
        category: existing.category,
        unit: existing.unit,
        isActive: existing.isActive,
        notes: existing.notes,
      },
      newValues: {
        name: updated.name,
        category: updated.category,
        unit: updated.unit,
        isActive: updated.isActive,
        notes: updated.notes,
      },
    });

    const stockByItemId = await this.loadStockSummariesByItemIds([updated.id]);

    return this.mapItem(
      updated,
      stockByItemId.get(updated.id),
      this.getGlobalCapabilities(currentUser),
    );
  }

  async listMovements(
    currentUser: CurrentAuthUser,
    query: ListInventoryMovementsQueryDto,
  ): Promise<InventoryMovementResponseDto[]> {
    this.assertInventoryVisible(currentUser);

    const movements = (await this.prisma.inventoryMovement.findMany({
      where: {
        ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
        ...(query.movementType ? { movementType: query.movementType } : {}),
        ...(query.objectId ? { relatedObjectId: query.objectId } : {}),
        ...(query.oneTimeOrderId
          ? { relatedOneTimeOrderId: query.oneTimeOrderId }
          : {}),
        ...(query.approvalBridge === 'true'
          ? { requiresApprovalBridge: true }
          : {}),
        ...this.buildDateRangeWhere(query),
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
        relatedObject: {
          select: {
            id: true,
            name: true,
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
    })) as InventoryMovementRecord[];

    const attachmentsByEntityId = await this.loadMovementAttachments(
      movements.map((movement) => movement.id),
    );

    return movements.map((movement) =>
      this.mapMovement(
        movement,
        attachmentsByEntityId.get(movement.id) ?? [],
        currentUser,
      ),
    );
  }

  async createMovement(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    this.assertMovementCreatable(currentUser, payload.movementType);

    return this.createMovementRecord(currentUser, payload);
  }

  async listObjectInventory(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<ObjectInventoryResponseDto> {
    const object = await this.loadObjectScope(objectId);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Object inventory access denied');
    }

    const [movements, availableItems] = await Promise.all([
      this.listObjectScopedMovements(currentUser, objectId),
      this.listItems(currentUser, { isActive: true }).catch((error: unknown) => {
        if (error instanceof ForbiddenException) {
          return this.listOperationalInventoryItemsForObject(currentUser, object);
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

  private async createMovementRecord(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id: payload.inventoryItemId,
      },
      select: {
        id: true,
        isActive: true,
        currentUnitPrice: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    if (!item.isActive) {
      throw new BadRequestException(
        'Inactive inventory item cannot be used in movements',
      );
    }

    await this.assertScopedTargets(payload);
    const normalizedMovement = this.normalizeMovementPayload(
      payload,
      item.currentUnitPrice,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const stockSummary = await this.loadStockSummaryForItem(tx, item.id);
        const nextStock = stockSummary.currentStock + normalizedMovement.signedQuantity;

        if (nextStock < -0.0001) {
          throw new BadRequestException('Insufficient stock for movement');
        }

        const createdMovement = await tx.inventoryMovement.create({
          data: {
            inventoryItemId: item.id,
            movementType: normalizedMovement.movementType,
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
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              currentUnitPrice: normalizedMovement.unitPriceSnapshot,
            },
          });
        }

        return createdMovement;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.auditService.writeAuditEvent({
      entityType: 'inventory_movement',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'inventory.movement.created',
      newValues: {
        inventoryItemId: created.inventoryItemId,
        movementType: created.movementType,
        quantity: Number(created.quantity),
        unitPriceSnapshot: Number(created.unitPriceSnapshot),
        totalAmountSnapshot: Number(created.totalAmountSnapshot),
        adjustmentDirection: created.adjustmentDirection,
        evidenceRequired: created.evidenceRequired,
        requiresApprovalBridge: created.requiresApprovalBridge,
        approvalBridgeType: created.approvalBridgeType,
        relatedObjectId: created.relatedObjectId,
        relatedOneTimeOrderId: created.relatedOneTimeOrderId,
        comment: created.comment,
      },
    });

    const createdView = await this.prisma.inventoryMovement.findFirst({
      where: {
        id: created.id,
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
        relatedObject: {
          select: {
            id: true,
            name: true,
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

    return this.mapMovement(createdView as InventoryMovementRecord, [], currentUser);
  }

  async listObjectReferenceOptions(
    currentUser: CurrentAuthUser,
  ): Promise<Array<{ id: string; name: string; status: string }>> {
    this.assertInventoryVisible(currentUser);

    return this.prisma.object.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async listOneTimeOrderReferenceOptions(
    currentUser: CurrentAuthUser,
  ): Promise<Array<{ id: string; title: string; status: string }>> {
    this.assertInventoryVisible(currentUser);

    return this.prisma.oneTimeOrder.findMany({
      select: {
        id: true,
        title: true,
        status: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async listObjectScopedMovements(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<InventoryMovementResponseDto[]> {
    const movements = (await this.prisma.inventoryMovement.findMany({
      where: {
        relatedObjectId: objectId,
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
        relatedObject: {
          select: {
            id: true,
            name: true,
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
      movements.map((movement) => movement.id),
    );

    return movements.map((movement) =>
      this.mapMovement(
        movement,
        attachmentsByEntityId.get(movement.id) ?? [],
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
        isActive: true,
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

  private async loadObjectScope(objectId: string): Promise<{
    id: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive: boolean;
    }>;
  }> {
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
      createdByUserId: string;
      assignments: Array<{
        userId: string;
        isActive: boolean;
      }>;
    },
  ): boolean {
    const roleCodes = this.getRoleCodes(currentUser);

    return (
      canIssueInventoryToObject(roleCodes) ||
      hasWideObjectAccess(roleCodes) ||
      object.createdByUserId === currentUser.id ||
      object.assignments.some((assignment) => assignment.userId === currentUser.id)
    );
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    return currentUser.roleCodes ?? [currentUser.roleCode];
  }

  private getGlobalCapabilities(
    currentUser: CurrentAuthUser,
  ): InventoryGlobalCapabilities {
    return buildInventoryGlobalCapabilities(this.getRoleCodes(currentUser));
  }

  private assertInventoryVisible(currentUser: CurrentAuthUser): void {
    if (!canAccessInventory(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Inventory access denied');
    }
  }

  private assertCatalogManageable(currentUser: CurrentAuthUser): void {
    if (!canManageInventoryCatalog(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Inventory catalog management denied');
    }
  }

  private assertMovementCreatable(
    currentUser: CurrentAuthUser,
    movementType: string,
  ): void {
    const roleCodes = this.getRoleCodes(currentUser);

    if (!canCreateInventoryMovement(roleCodes)) {
      throw new ForbiddenException('Inventory movement creation denied');
    }

    if (!INVENTORY_MOVEMENT_TYPES.includes(movementType as InventoryMovementType)) {
      throw new BadRequestException('Unsupported movement type');
    }

    switch (movementType as InventoryMovementType) {
      case 'receipt':
        if (!canCreateInventoryReceipt(roleCodes)) {
          throw new ForbiddenException('Inventory receipt denied');
        }
        return;
      case 'issue_to_object':
        if (!canIssueInventoryToObject(roleCodes)) {
          throw new ForbiddenException('Inventory issue to object denied');
        }
        return;
      case 'issue_to_one_time_order':
        if (!canIssueInventoryToOneTimeOrder(roleCodes)) {
          throw new ForbiddenException(
            'Inventory issue to one-time order denied',
          );
        }
        return;
      case 'return':
        if (!canReturnInventory(roleCodes)) {
          throw new ForbiddenException('Inventory return denied');
        }
        return;
      case 'writeoff':
        if (!canWriteoffInventory(roleCodes)) {
          throw new ForbiddenException('Inventory writeoff denied');
        }
        return;
      case 'adjustment':
        if (!canAdjustInventory(roleCodes)) {
          throw new ForbiddenException('Inventory adjustment denied');
        }
    }
  }

  private async assertScopedTargets(
    payload: CreateInventoryMovementDto,
  ): Promise<void> {
    const objectId = payload.relatedObjectId ?? null;
    const oneTimeOrderId = payload.relatedOneTimeOrderId ?? null;

    if (objectId && oneTimeOrderId) {
      throw new BadRequestException(
        'Movement cannot reference object and one-time order simultaneously',
      );
    }

    if (objectId) {
      const objectExists = await this.prisma.object.findFirst({
        where: {
          id: objectId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!objectExists) {
        throw new NotFoundException('Related object not found');
      }
    }

    if (oneTimeOrderId) {
      const orderExists = await this.prisma.oneTimeOrder.findFirst({
        where: { id: oneTimeOrderId },
        select: { id: true },
      });

      if (!orderExists) {
        throw new NotFoundException('Related one-time order not found');
      }
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

      return {
        movementType,
        quantity,
        unitPriceSnapshot,
        totalAmountSnapshot,
        signedQuantity: params.signedQuantity,
        adjustmentDirection: params.adjustmentDirection,
        comment,
        evidenceRequired,
        requiresApprovalBridge: evidenceRequired,
        approvalBridgeType: evidenceRequired && movementType === 'issue_to_object'
          ? 'inventory_without_photo_confirmation'
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

  private async loadStockSummariesByItemIds(itemIds: string[]): Promise<
    Map<
      string,
      {
        currentStock: number;
        movementsCount: number;
        receiptsCount: number;
        issuesCount: number;
        returnsCount: number;
        writeoffsCount: number;
        adjustmentsCount: number;
      }
    >
  > {
    const result = new Map<
      string,
      {
        currentStock: number;
        movementsCount: number;
        receiptsCount: number;
        issuesCount: number;
        returnsCount: number;
        writeoffsCount: number;
        adjustmentsCount: number;
      }
    >();

    if (itemIds.length === 0) {
      return result;
    }

    const movements = await this.prisma.inventoryMovement.findMany({
      where: {
        inventoryItemId: {
          in: itemIds,
        },
      },
      select: {
        inventoryItemId: true,
        movementType: true,
        quantity: true,
        adjustmentDirection: true,
      },
    });

    for (const movement of movements) {
      const current = result.get(movement.inventoryItemId) ?? {
        currentStock: 0,
        movementsCount: 0,
        receiptsCount: 0,
        issuesCount: 0,
        returnsCount: 0,
        writeoffsCount: 0,
        adjustmentsCount: 0,
      };

      current.currentStock += this.calculateSignedQuantity({
        movementType: movement.movementType as InventoryMovementType,
        quantity: Number(movement.quantity),
        adjustmentDirection: movement.adjustmentDirection,
      });
      current.movementsCount += 1;

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

      result.set(movement.inventoryItemId, current);
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

  private async loadMovementAttachments(
    movementIds: string[],
  ): Promise<Map<string, FileResponseDto[]>> {
    const result = new Map<string, FileResponseDto[]>();

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
      include: {
        file: {
          include: {
            attachments: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })) as FileAttachmentRecord[];

    for (const attachment of attachments) {
      const current = result.get(attachment.entityId) ?? [];
      current.push(this.mapFile(attachment.file));
      result.set(attachment.entityId, current);
    }

    return result;
  }

  private mapFile(file: FileAttachmentRecord['file']): FileResponseDto {
    return {
      id: file.id,
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt.toISOString(),
      url: `/api/v1/files/${file.id}/content`,
      attachments: file.attachments.map((attachment) => ({
        id: attachment.id,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        fieldCode: attachment.fieldCode,
        uploadedByUserId: attachment.uploadedByUserId,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  }

  private mapItem(
    item: InventoryItemRecord,
    stockSummary:
      | {
          currentStock: number;
          movementsCount: number;
          receiptsCount: number;
          issuesCount: number;
          returnsCount: number;
          writeoffsCount: number;
          adjustmentsCount: number;
        }
      | undefined,
    capabilities: InventoryGlobalCapabilities,
  ): InventoryItemResponseDto {
    const currentStock = Number((stockSummary?.currentStock ?? 0).toFixed(3));
    const currentUnitPrice =
      item.currentUnitPrice === null ? null : Number(item.currentUnitPrice);

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      isActive: item.isActive,
      notes: item.notes,
      currentUnitPrice,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy: item.createdBy,
      currentStock,
      currentEstimatedTotalValue: Number(
        (currentStock * (currentUnitPrice ?? 0)).toFixed(2),
      ),
      summary: {
        movementsCount: stockSummary?.movementsCount ?? 0,
        receiptsCount: stockSummary?.receiptsCount ?? 0,
        issuesCount: stockSummary?.issuesCount ?? 0,
        returnsCount: stockSummary?.returnsCount ?? 0,
        writeoffsCount: stockSummary?.writeoffsCount ?? 0,
        adjustmentsCount: stockSummary?.adjustmentsCount ?? 0,
      },
      capabilities: {
        canEditCatalog: capabilities.canManageInventoryCatalog,
        canCreateMovement: capabilities.canCreateInventoryMovement,
        canCreateReceipt: capabilities.canCreateInventoryReceipt,
        canIssueToObject: capabilities.canIssueInventoryToObject,
        canIssueToOneTimeOrder: capabilities.canIssueInventoryToOneTimeOrder,
        canReturn: capabilities.canReturnInventory,
        canWriteoff: capabilities.canWriteoffInventory,
        canAdjust: capabilities.canAdjustInventory,
        canViewReports: capabilities.canViewInventoryReports,
      },
    };
  }

  private mapMovement(
    movement: InventoryMovementRecord,
    attachments: FileResponseDto[],
    currentUser: CurrentAuthUser,
  ): InventoryMovementResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const signedQuantity = this.calculateSignedQuantity({
      movementType: movement.movementType as InventoryMovementType,
      quantity: Number(movement.quantity),
      adjustmentDirection: movement.adjustmentDirection,
    });
    const hasEvidence = attachments.length > 0;

    return {
      id: movement.id,
      inventoryItem: movement.inventoryItem,
      movementType: movement.movementType,
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
            canOpenObjectCard: canViewObjectByScope({
              currentUserId: currentUser.id,
              roleCodes,
              object: movement.relatedObject,
            }),
          }
        : null,
      relatedOneTimeOrder: movement.relatedOneTimeOrder
        ? {
            id: movement.relatedOneTimeOrder.id,
            title: movement.relatedOneTimeOrder.title,
            status: movement.relatedOneTimeOrder.status,
            canOpenOrderCard: canViewOneTimeOrderByScope({
              currentUserId: currentUser.id,
              roleCodes,
              order: movement.relatedOneTimeOrder,
            }),
          }
        : null,
      attachments,
      projection: {
        hasEvidence,
        requiresApprovalBridge: movement.requiresApprovalBridge && !hasEvidence,
        approvalBridgeType:
          movement.requiresApprovalBridge && !hasEvidence
            ? movement.approvalBridgeType
            : null,
        isSensitive: isSensitiveInventoryMovementType(
          movement.movementType as InventoryMovementType,
        ),
        canResolveMissingPhotoApproval:
          movement.requiresApprovalBridge &&
          !hasEvidence &&
          movement.approvalBridgeType ===
            'inventory_without_photo_confirmation' &&
          canResolveInventoryMissingPhotoApproval(roleCodes),
      },
    };
  }
}
