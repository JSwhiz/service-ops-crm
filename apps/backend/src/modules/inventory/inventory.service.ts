import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import {
  INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
  INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
  INVENTORY_WRITEOFF_CONFIRMATION_TYPE,
  LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE,
} from '../approvals/constants/approval.constants';
import { FileResponseDto } from '../files/dto/file-response.dto';
import {
  canViewObjectByScope,
  hasWideObjectAccess,
} from '../objects/utils/object-access.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildOneTimeOrderAccessWhere,
  canViewOneTimeOrderByScope,
} from '../one-time-orders/utils/one-time-order-access.util';

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
  permissionCodes?: string[];
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
    const normalized = this.normalizeCreateItemPayload(payload);

    let created: InventoryItemRecord;

    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (normalized.isActive) {
          await this.assertNoActiveItemDuplicate(tx, normalized);
        }

        const item = (await tx.inventoryItem.create({
          data: {
            ...normalized,
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

        const nextValues = {
          name: normalized.name ?? existing.name,
          category: normalized.category ?? existing.category,
          unit: normalized.unit ?? existing.unit,
          notes:
            normalized.notes === undefined ? existing.notes : normalized.notes,
          isActive: normalized.isActive ?? existing.isActive,
        };

        if (existing.isActive && !nextValues.isActive) {
          await this.assertItemArchivable(tx, existing.id);
        }

        if (nextValues.isActive) {
          await this.assertNoActiveItemDuplicate(tx, nextValues, existing.id);
        }

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
        const action =
          existing.isActive && !item.isActive
            ? 'inventory.item.archived'
            : !existing.isActive && item.isActive
              ? 'inventory.item.reactivated'
              : 'inventory.item.updated';

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
          ? { requiresApprovalBridge: true, approvalBridgeResolvedAt: null }
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

  async createMovement(
    currentUser: CurrentAuthUser,
    payload: CreateInventoryMovementDto,
  ): Promise<InventoryMovementResponseDto> {
    this.assertMovementCreatable(currentUser, payload.movementType);

    return this.createMovementRecord(currentUser, payload);
  }

  async resolveMissingPhotoApproval(
    currentUser: CurrentAuthUser,
    movementId: string,
  ): Promise<InventoryMovementResponseDto> {
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
        movementType: true,
        requiresApprovalBridge: true,
        approvalBridgeType: true,
        approvalBridgeResolvedAt: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
    }

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
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.applyInventoryExceptionApprovalDecision(tx, {
        movementId: movement.id,
        actorUserId: currentUser.id,
      });

      if (approvalRequest) {
        await tx.approvalRequest.update({
          where: {
            id: approvalRequest.id,
          },
          data: {
            status: 'approved',
            resolvedByUserId: currentUser.id,
            resolvedAt: new Date(),
            decisionComment: null,
          },
        });
      }
    });

    await this.auditService.writeAuditEvent({
      entityType: 'inventory_movement',
      entityId: movement.id,
      actorUserId: currentUser.id,
        action: 'inventory.missing_photo_approval.resolved',
        newValues: {
          approvalBridgeType: movement.approvalBridgeType,
        },
      });

    if (approvalRequest) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: approvalRequest.id,
        actorUserId: currentUser.id,
        action: 'approval.request.approved',
        newValues: {
          approvalType: INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: movement.id,
        },
      });
    }

    const updated = await this.loadMovementViewById(movement.id);
    const updatedAttachments = await this.loadMovementAttachments([movement.id]);

    return this.mapMovement(
      updated,
      updatedAttachments.get(movement.id) ?? [],
      null,
      currentUser,
    );
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
    const requiresWriteoffApproval =
      normalizedMovement.movementType === 'writeoff';
    const creationResult = await this.prisma.$transaction(
      async (tx) => {
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
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              currentUnitPrice: normalizedMovement.unitPriceSnapshot,
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

        return {
          createdMovement,
          approvalRequestId: approvalRequest?.id ?? null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.auditService.writeAuditEvent({
      entityType: 'inventory_movement',
      entityId: creationResult.createdMovement.id,
      actorUserId: currentUser.id,
      action: 'inventory.movement.created',
      newValues: {
        inventoryItemId: creationResult.createdMovement.inventoryItemId,
        movementType: creationResult.createdMovement.movementType,
        quantity: Number(creationResult.createdMovement.quantity),
        unitPriceSnapshot: Number(creationResult.createdMovement.unitPriceSnapshot),
        totalAmountSnapshot: Number(
          creationResult.createdMovement.totalAmountSnapshot,
        ),
        adjustmentDirection: creationResult.createdMovement.adjustmentDirection,
        evidenceRequired: creationResult.createdMovement.evidenceRequired,
        requiresApprovalBridge:
          creationResult.createdMovement.requiresApprovalBridge,
        approvalBridgeType: creationResult.createdMovement.approvalBridgeType,
        status: creationResult.createdMovement.status,
        relatedObjectId: creationResult.createdMovement.relatedObjectId,
        relatedOneTimeOrderId:
          creationResult.createdMovement.relatedOneTimeOrderId,
        comment: creationResult.createdMovement.comment,
      },
    });

    if (creationResult.approvalRequestId) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: creationResult.approvalRequestId,
        actorUserId: currentUser.id,
        action: 'approval.request.created',
        newValues: {
          approvalType: requiresWriteoffApproval
            ? INVENTORY_WRITEOFF_CONFIRMATION_TYPE
            : INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
          sourceEntityType: INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: creationResult.createdMovement.id,
        },
      });
    }

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

  async applyInventoryExceptionApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
    },
  ): Promise<void> {
    const movement = await tx.inventoryMovement.findFirst({
      where: {
        id: params.movementId,
      },
      select: {
        id: true,
        movementType: true,
        requiresApprovalBridge: true,
        approvalBridgeType: true,
        approvalBridgeResolvedAt: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Inventory movement not found');
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
      },
    });

    if (attachmentCount > 0) {
      throw new BadRequestException(
        'Movement already has evidence and does not need missing photo approval',
      );
    }

    if (!movement.approvalBridgeResolvedAt) {
      await tx.inventoryMovement.update({
        where: {
          id: movement.id,
        },
        data: {
          approvalBridgeResolvedAt: new Date(),
          approvalBridgeResolvedByUserId: params.actorUserId,
        },
      });
    }
  }

  async applyInventoryWriteoffApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
    },
  ): Promise<void> {
    void params.actorUserId;

    const movement = await tx.inventoryMovement.findFirst({
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

    const stockSummary = await this.loadStockSummaryForItem(
      tx,
      movement.inventoryItemId,
    );
    const nextStock = stockSummary.currentStock - Number(movement.quantity);

    if (nextStock < -0.0001) {
      throw new ConflictException('Insufficient stock to approve inventory writeoff');
    }

    await tx.inventoryMovement.update({
      where: {
        id: movement.id,
      },
      data: {
        status: 'applied',
      },
    });
  }

  async applyInventoryWriteoffRejectionDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
      decision: 'reject' | 'cancel';
    },
  ): Promise<void> {
    void params.actorUserId;

    const movement = await tx.inventoryMovement.findFirst({
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

    await tx.inventoryMovement.update({
      where: {
        id: movement.id,
      },
      data: {
        status: params.decision === 'reject' ? 'rejected' : 'cancelled',
      },
    });
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
      where: buildOneTimeOrderAccessWhere({
        currentUserId: currentUser.id,
        roleCodes: this.getRoleCodes(currentUser),
        permissionCodes: currentUser.permissionCodes,
      }),
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

  private normalizeCreateItemPayload(payload: CreateInventoryItemDto): {
    name: string;
    category: string;
    unit: string;
    notes: string | null;
    isActive: boolean;
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
      isActive: payload.isActive ?? true,
    };
  }

  private normalizeUpdateItemPayload(payload: UpdateInventoryItemDto): {
    name?: string;
    category?: string;
    unit?: string;
    notes?: string | null;
    isActive?: boolean;
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
      ...(payload.isActive === undefined
        ? {}
        : { isActive: payload.isActive }),
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

  private async assertItemArchivable(
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
        code: 'INVENTORY_ITEM_ARCHIVE_BLOCKED',
        message: 'Inventory item cannot be archived in its current state',
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
  }): Prisma.InputJsonObject {
    return {
      name: item.name,
      category: item.category,
      unit: item.unit,
      notes: item.notes,
      isActive: item.isActive,
      version: item.version,
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
        status: 'applied',
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
      version: item.version,
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
      ? canViewOneTimeOrderByScope({
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
            canOpenObjectCard: canViewObjectByScope({
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
          canResolveInventoryMissingPhotoApproval(roleCodes),
      },
    };
  }
}
