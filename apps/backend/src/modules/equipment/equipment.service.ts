import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  EQUIPMENT_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
  EQUIPMENT_WRITEOFF_CONFIRMATION_TYPE,
} from '../approvals/constants/approval.constants';
import { AuditService } from '../audit/audit.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import {
  canViewObjectByScope,
} from '../objects/utils/object-access.util';
import { canViewOneTimeOrderByScope } from '../one-time-orders/utils/one-time-order-access.util';
import { PrismaService } from '../prisma/prisma.service';

import { CreateEquipmentCatalogItemDto } from './dto/create-equipment-catalog-item.dto';
import { CreateEquipmentMovementDto } from './dto/create-equipment-movement.dto';
import { CreateEquipmentUnitDto } from './dto/create-equipment-unit.dto';
import {
  EquipmentCatalogItemResponseDto,
  EquipmentMovementResponseDto,
  EquipmentScopeResponseDto,
  EquipmentUnitResponseDto,
} from './dto/equipment-response.dto';
import { ListEquipmentUnitsQueryDto } from './dto/list-equipment-query.dto';
import {
  EQUIPMENT_MOVEMENT_TYPES,
  EquipmentMovementType,
  EquipmentStatus,
} from './types/equipment.type';
import {
  buildEquipmentGlobalCapabilities,
  EquipmentGlobalCapabilities,
} from './utils/equipment-capabilities.util';
import {
  canAccessEquipment,
  canAssignEquipmentToObject,
  canAssignEquipmentToOneTimeOrder,
  canManageEquipmentCatalog,
  canMarkEquipmentBroken,
  canReturnEquipment,
  canReturnEquipmentFromRepair,
  canSendEquipmentToRepair,
  canWriteoffEquipment,
} from './utils/equipment-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

type ObjectScope = {
  id: string;
  name: string;
  createdByUserId: string;
  assignments: Array<{ userId: string; isActive?: boolean }>;
};

type OrderScope = {
  id: string;
  title: string;
  status: string;
  createdByUserId: string;
  assignments: Array<{
    userId: string;
    assignmentRoleCode: string;
    isActive?: boolean;
  }>;
};

type EquipmentCatalogRecord = {
  id: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EquipmentUnitRecord = {
  id: string;
  inventoryNumber: string;
  serialNumber: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  catalogItem: EquipmentCatalogRecord;
  currentObject: ObjectScope | null;
  currentOneTimeOrder: OrderScope | null;
};

type EquipmentMovementRecord = {
  id: string;
  equipmentUnitId: string;
  movementType: string;
  status: string;
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  createdAt: Date;
  createdBy: { id: string; login: string; fullName: string };
  fromObject: ObjectScope | null;
  toObject: ObjectScope | null;
  fromOneTimeOrder: OrderScope | null;
  toOneTimeOrder: OrderScope | null;
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
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listCatalog(
    currentUser: CurrentAuthUser,
  ): Promise<EquipmentCatalogItemResponseDto[]> {
    this.assertEquipmentVisible(currentUser);

    const items = await this.prisma.equipmentCatalogItem.findMany({
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });

    return items.map((item) => this.mapCatalogItem(item));
  }

  async createCatalogItem(
    currentUser: CurrentAuthUser,
    payload: CreateEquipmentCatalogItemDto,
  ): Promise<EquipmentCatalogItemResponseDto> {
    this.assertCatalogManageable(currentUser);

    const created = await this.prisma.equipmentCatalogItem.create({
      data: {
        category: payload.category.trim(),
        name: payload.name.trim(),
        brand: payload.brand?.trim() || null,
        model: payload.model?.trim() || null,
        isActive: payload.isActive ?? true,
        notes: payload.notes?.trim() || null,
        createdByUserId: currentUser.id,
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'equipment_catalog_item',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'equipment.catalog_item.created',
      newValues: {
        category: created.category,
        name: created.name,
      },
    });

    return this.mapCatalogItem(created);
  }

  async listUnits(
    currentUser: CurrentAuthUser,
    query: ListEquipmentUnitsQueryDto,
  ): Promise<EquipmentUnitResponseDto[]> {
    this.assertEquipmentVisible(currentUser);

    const units = (await this.prisma.equipmentUnit.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.objectId ? { currentObjectId: query.objectId } : {}),
        ...(query.oneTimeOrderId
          ? { currentOneTimeOrderId: query.oneTimeOrderId }
          : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                { inventoryNumber: { contains: query.search.trim(), mode: 'insensitive' } },
                { serialNumber: { contains: query.search.trim(), mode: 'insensitive' } },
                {
                  catalogItem: {
                    name: { contains: query.search.trim(), mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: this.unitInclude(),
      orderBy: [{ status: 'asc' }, { inventoryNumber: 'asc' }],
    })) as EquipmentUnitRecord[];

    const capabilities = this.getGlobalCapabilities(currentUser);
    return units.map((unit) => this.mapUnit(unit, currentUser, capabilities));
  }

  async getUnitById(
    currentUser: CurrentAuthUser,
    unitId: string,
  ): Promise<EquipmentUnitResponseDto> {
    this.assertEquipmentVisible(currentUser);
    const unit = await this.loadUnit(unitId);
    return this.mapUnit(unit, currentUser, this.getGlobalCapabilities(currentUser));
  }

  async createUnit(
    currentUser: CurrentAuthUser,
    payload: CreateEquipmentUnitDto,
  ): Promise<EquipmentUnitResponseDto> {
    this.assertCatalogManageable(currentUser);

    const catalogItem = await this.prisma.equipmentCatalogItem.findFirst({
      where: { id: payload.catalogItemId, isActive: true },
      select: { id: true },
    });

    if (!catalogItem) {
      throw new NotFoundException('Equipment catalog item not found');
    }

    const created = await this.prisma.equipmentUnit.create({
      data: {
        catalogItemId: catalogItem.id,
        inventoryNumber: payload.inventoryNumber.trim(),
        serialNumber: payload.serialNumber?.trim() || null,
        notes: payload.notes?.trim() || null,
        createdByUserId: currentUser.id,
      },
      include: this.unitInclude(),
    });

    await this.auditService.writeAuditEvent({
      entityType: 'equipment_unit',
      entityId: created.id,
      actorUserId: currentUser.id,
      action: 'equipment.unit.created',
      newValues: {
        inventoryNumber: created.inventoryNumber,
      },
    });

    return this.mapUnit(
      created as EquipmentUnitRecord,
      currentUser,
      this.getGlobalCapabilities(currentUser),
    );
  }

  async listUnitMovements(
    currentUser: CurrentAuthUser,
    unitId: string,
  ): Promise<EquipmentMovementResponseDto[]> {
    const unit = await this.loadUnit(unitId);

    if (!this.canReadUnit(currentUser, unit)) {
      throw new ForbiddenException('Equipment unit access denied');
    }

    const movements = (await this.prisma.equipmentMovement.findMany({
      where: { equipmentUnitId: unit.id },
      include: this.movementInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) as EquipmentMovementRecord[];

    const attachmentsByMovementId = await this.loadMovementAttachments(
      movements.map((movement) => movement.id),
    );
    const approvalRequestsByMovementId =
      await this.loadPendingApprovalRequestsByMovementIds(
        movements.map((movement) => movement.id),
      );

    return movements.map((movement) =>
      this.mapMovement(
        movement,
        attachmentsByMovementId.get(movement.id) ?? [],
        approvalRequestsByMovementId.get(movement.id) ?? null,
        currentUser,
      ),
    );
  }

  async createMovement(
    currentUser: CurrentAuthUser,
    unitId: string,
    payload: CreateEquipmentMovementDto,
  ): Promise<EquipmentMovementResponseDto> {
    const roleCodes = this.getRoleCodes(currentUser);
    const movementType = payload.movementType as EquipmentMovementType;

    this.assertMovementCreatable(roleCodes, movementType);

    const unit = await this.loadUnit(unitId);
    const normalized = await this.normalizeMovement(unit, payload);
    const requiresWriteoffApproval = movementType === 'writeoff';

    if (requiresWriteoffApproval) {
      const existingPendingWriteoff = await this.prisma.equipmentMovement.findFirst({
        where: {
          equipmentUnitId: unit.id,
          movementType: 'writeoff',
          status: 'pending_approval',
        },
        select: {
          id: true,
        },
      });

      if (existingPendingWriteoff) {
        throw new ConflictException('Equipment writeoff approval is already pending');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const movement = await tx.equipmentMovement.create({
        data: {
          equipmentUnitId: unit.id,
          movementType,
          status: requiresWriteoffApproval ? 'pending_approval' : 'applied',
          fromStatus: unit.status,
          toStatus: normalized.status,
          fromObjectId: unit.currentObject?.id ?? null,
          fromOneTimeOrderId: unit.currentOneTimeOrder?.id ?? null,
          toObjectId: normalized.currentObjectId,
          toOneTimeOrderId: normalized.currentOneTimeOrderId,
          comment: payload.comment?.trim() || null,
          createdByUserId: currentUser.id,
        },
      });

      if (!requiresWriteoffApproval) {
        await tx.equipmentUnit.update({
          where: { id: unit.id },
          data: {
            status: normalized.status,
            currentObjectId: normalized.currentObjectId,
            currentOneTimeOrderId: normalized.currentOneTimeOrderId,
          },
        });
      }

      const approvalRequest = requiresWriteoffApproval
        ? await tx.approvalRequest.create({
            data: {
              approvalType: EQUIPMENT_WRITEOFF_CONFIRMATION_TYPE,
              sourceEntityType:
                EQUIPMENT_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
              sourceEntityId: movement.id,
              createdByUserId: currentUser.id,
              payloadSnapshot: {
                summaryTitle: 'Списание оборудования',
                summarySubtitle: `${unit.inventoryNumber} · ${unit.catalogItem.name}`,
                equipmentUnitId: unit.id,
                inventoryNumber: unit.inventoryNumber,
                movementType,
                fromStatus: unit.status,
                toStatus: normalized.status,
                comment: payload.comment?.trim() || null,
              },
            },
          })
        : null;

      return {
        movement,
        approvalRequestId: approvalRequest?.id ?? null,
      };
    });

    await this.auditService.writeAuditEvent({
      entityType: 'equipment_movement',
      entityId: created.movement.id,
      actorUserId: currentUser.id,
      action: `equipment.${movementType}`,
      newValues: {
        equipmentUnitId: unit.id,
        status: created.movement.status,
        toStatus: normalized.status,
        toObjectId: normalized.currentObjectId,
        toOneTimeOrderId: normalized.currentOneTimeOrderId,
      },
    });

    if (created.approvalRequestId) {
      await this.auditService.writeAuditEvent({
        entityType: 'approval_request',
        entityId: created.approvalRequestId,
        actorUserId: currentUser.id,
        action: 'approval.request.created',
        newValues: {
          approvalType: EQUIPMENT_WRITEOFF_CONFIRMATION_TYPE,
          sourceEntityType: EQUIPMENT_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: created.movement.id,
        },
      });
    }

    const movement = await this.loadMovement(created.movement.id);
    const approvalRequestByMovementId =
      await this.loadPendingApprovalRequestsByMovementIds([movement.id]);

    return this.mapMovement(
      movement,
      [],
      approvalRequestByMovementId.get(movement.id) ?? null,
      currentUser,
    );
  }

  async listObjectEquipment(
    currentUser: CurrentAuthUser,
    objectId: string,
  ): Promise<EquipmentScopeResponseDto> {
    const object = await this.loadObjectScope(objectId);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      !canViewObjectByScope({
        currentUserId: currentUser.id,
        roleCodes,
        object,
      })
    ) {
      throw new ForbiddenException('Object equipment access denied');
    }

    const units = (await this.prisma.equipmentUnit.findMany({
      where: { currentObjectId: objectId },
      include: this.unitInclude(),
      orderBy: [{ updatedAt: 'desc' }, { inventoryNumber: 'asc' }],
    })) as EquipmentUnitRecord[];

    return {
      units: units.map((unit) =>
        this.mapUnit(unit, currentUser, this.scopedReadCapabilities()),
      ),
      capabilities: {
        canViewEquipmentHistory: true,
      },
    };
  }

  async listOneTimeOrderEquipment(
    currentUser: CurrentAuthUser,
    orderId: string,
  ): Promise<EquipmentScopeResponseDto> {
    const order = await this.loadOrderScope(orderId);
    const roleCodes = this.getRoleCodes(currentUser);

    if (
      !canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        order,
      })
    ) {
      throw new ForbiddenException('One-time order equipment access denied');
    }

    const units = (await this.prisma.equipmentUnit.findMany({
      where: { currentOneTimeOrderId: orderId },
      include: this.unitInclude(),
      orderBy: [{ updatedAt: 'desc' }, { inventoryNumber: 'asc' }],
    })) as EquipmentUnitRecord[];

    return {
      units: units.map((unit) =>
        this.mapUnit(unit, currentUser, this.scopedReadCapabilities()),
      ),
      capabilities: {
        canViewEquipmentHistory: true,
      },
    };
  }

  async applyEquipmentWriteoffApprovalDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
    },
  ): Promise<void> {
    void params.actorUserId;

    const movement = await tx.equipmentMovement.findFirst({
      where: {
        id: params.movementId,
      },
      select: {
        id: true,
        equipmentUnitId: true,
        movementType: true,
        status: true,
        fromStatus: true,
        fromObjectId: true,
        fromOneTimeOrderId: true,
        toStatus: true,
        toObjectId: true,
        toOneTimeOrderId: true,
      },
    });

    if (!movement) {
      throw new NotFoundException('Equipment movement not found');
    }

    if (movement.movementType !== 'writeoff') {
      throw new BadRequestException('Only equipment writeoff can use this approval path');
    }

    if (movement.status !== 'pending_approval') {
      throw new ConflictException('Equipment writeoff is already resolved');
    }

    const unit = await tx.equipmentUnit.findFirst({
      where: {
        id: movement.equipmentUnitId,
      },
      select: {
        id: true,
        status: true,
        currentObjectId: true,
        currentOneTimeOrderId: true,
      },
    });

    if (!unit) {
      throw new NotFoundException('Equipment unit not found');
    }

    if (
      unit.status !== movement.fromStatus ||
      unit.currentObjectId !== movement.fromObjectId ||
      unit.currentOneTimeOrderId !== movement.fromOneTimeOrderId
    ) {
      throw new ConflictException(
        'Equipment unit state changed after approval request was created',
      );
    }

    await tx.equipmentUnit.update({
      where: {
        id: unit.id,
      },
      data: {
        status: movement.toStatus,
        currentObjectId: movement.toObjectId,
        currentOneTimeOrderId: movement.toOneTimeOrderId,
      },
    });

    await tx.equipmentMovement.update({
      where: {
        id: movement.id,
      },
      data: {
        status: 'applied',
      },
    });
  }

  async applyEquipmentWriteoffRejectionDecision(
    tx: Prisma.TransactionClient,
    params: {
      movementId: string;
      actorUserId: string;
      decision: 'reject' | 'cancel';
    },
  ): Promise<void> {
    void params.actorUserId;

    const movement = await tx.equipmentMovement.findFirst({
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
      throw new NotFoundException('Equipment movement not found');
    }

    if (movement.movementType !== 'writeoff') {
      throw new BadRequestException('Only equipment writeoff can use this approval path');
    }

    if (movement.status !== 'pending_approval') {
      throw new ConflictException('Equipment writeoff is already resolved');
    }

    await tx.equipmentMovement.update({
      where: {
        id: movement.id,
      },
      data: {
        status: params.decision === 'reject' ? 'rejected' : 'cancelled',
      },
    });
  }

  private async normalizeMovement(
    unit: EquipmentUnitRecord,
    payload: CreateEquipmentMovementDto,
  ): Promise<{
    status: EquipmentStatus;
    currentObjectId: string | null;
    currentOneTimeOrderId: string | null;
  }> {
    switch (payload.movementType as EquipmentMovementType) {
      case 'issue_to_object':
        if (!payload.toObjectId || payload.toOneTimeOrderId) {
          throw new BadRequestException('issue_to_object requires toObjectId only');
        }
        await this.ensureObjectExists(payload.toObjectId);
        return {
          status: 'assigned_to_object',
          currentObjectId: payload.toObjectId,
          currentOneTimeOrderId: null,
        };
      case 'issue_to_one_time_order':
        if (!payload.toOneTimeOrderId || payload.toObjectId) {
          throw new BadRequestException(
            'issue_to_one_time_order requires toOneTimeOrderId only',
          );
        }
        await this.ensureOrderExists(payload.toOneTimeOrderId);
        return {
          status: 'assigned_to_one_time_order',
          currentObjectId: null,
          currentOneTimeOrderId: payload.toOneTimeOrderId,
        };
      case 'return_to_storage':
      case 'return_from_repair':
        return {
          status: 'in_storage',
          currentObjectId: null,
          currentOneTimeOrderId: null,
        };
      case 'send_to_repair':
        return {
          status: 'under_repair',
          currentObjectId: null,
          currentOneTimeOrderId: null,
        };
      case 'mark_broken':
        return {
          status: 'broken',
          currentObjectId: unit.currentObject?.id ?? null,
          currentOneTimeOrderId: unit.currentOneTimeOrder?.id ?? null,
        };
      case 'mark_lost':
        return {
          status: 'lost',
          currentObjectId: null,
          currentOneTimeOrderId: null,
        };
      case 'writeoff':
        return {
          status: 'written_off',
          currentObjectId: null,
          currentOneTimeOrderId: null,
        };
    }
  }

  private assertEquipmentVisible(currentUser: CurrentAuthUser): void {
    if (!canAccessEquipment(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Equipment access denied');
    }
  }

  private assertCatalogManageable(currentUser: CurrentAuthUser): void {
    if (!canManageEquipmentCatalog(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Equipment catalog management denied');
    }
  }

  private assertMovementCreatable(
    roleCodes: string[],
    movementType: EquipmentMovementType,
  ): void {
    if (!EQUIPMENT_MOVEMENT_TYPES.includes(movementType)) {
      throw new BadRequestException('Unsupported equipment movement type');
    }

    const allowed =
      movementType === 'issue_to_object'
        ? canAssignEquipmentToObject(roleCodes)
        : movementType === 'issue_to_one_time_order'
          ? canAssignEquipmentToOneTimeOrder(roleCodes)
          : movementType === 'return_to_storage'
            ? canReturnEquipment(roleCodes)
            : movementType === 'send_to_repair'
              ? canSendEquipmentToRepair(roleCodes)
              : movementType === 'return_from_repair'
                ? canReturnEquipmentFromRepair(roleCodes)
                : movementType === 'mark_broken' || movementType === 'mark_lost'
                  ? canMarkEquipmentBroken(roleCodes)
                  : canWriteoffEquipment(roleCodes);

    if (!allowed) {
      throw new ForbiddenException('Equipment movement denied');
    }
  }

  private canReadUnit(
    currentUser: CurrentAuthUser,
    unit: EquipmentUnitRecord,
  ): boolean {
    const roleCodes = this.getRoleCodes(currentUser);

    return (
      canAccessEquipment(roleCodes) ||
      (!!unit.currentObject &&
        canViewObjectByScope({
          currentUserId: currentUser.id,
          roleCodes,
          object: unit.currentObject,
        })) ||
      (!!unit.currentOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes,
          order: unit.currentOneTimeOrder,
        }))
    );
  }

  private async ensureObjectExists(objectId: string): Promise<void> {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: { id: true },
    });

    if (!object) {
      throw new NotFoundException('Target object not found');
    }
  }

  private async ensureOrderExists(orderId: string): Promise<void> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Target one-time order not found');
    }
  }

  private async loadUnit(unitId: string): Promise<EquipmentUnitRecord> {
    const unit = await this.prisma.equipmentUnit.findFirst({
      where: { id: unitId },
      include: this.unitInclude(),
    });

    if (!unit) {
      throw new NotFoundException('Equipment unit not found');
    }

    return unit as EquipmentUnitRecord;
  }

  private async loadMovement(
    movementId: string,
  ): Promise<EquipmentMovementRecord> {
    const movement = await this.prisma.equipmentMovement.findFirst({
      where: { id: movementId },
      include: this.movementInclude(),
    });

    if (!movement) {
      throw new NotFoundException('Equipment movement not found');
    }

    return movement as EquipmentMovementRecord;
  }

  private async loadObjectScope(objectId: string): Promise<ObjectScope> {
    const object = await this.prisma.object.findFirst({
      where: { id: objectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, isActive: true },
        },
      },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    return object;
  }

  private async loadOrderScope(orderId: string): Promise<OrderScope> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        title: true,
        status: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, assignmentRoleCode: true, isActive: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('One-time order not found');
    }

    return order;
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
        entityType: 'equipment_movement',
        entityId: { in: movementIds },
        file: { deletedAt: null },
      },
      include: {
        file: {
          include: { attachments: { orderBy: { createdAt: 'asc' } } },
        },
      },
      orderBy: { createdAt: 'asc' },
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

    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        sourceEntityType: EQUIPMENT_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE,
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

    for (const request of requests) {
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

  private mapCatalogItem(
    item: EquipmentCatalogRecord | Prisma.EquipmentCatalogItemGetPayload<object>,
  ): EquipmentCatalogItemResponseDto {
    return {
      id: item.id,
      category: item.category,
      name: item.name,
      brand: item.brand,
      model: item.model,
      isActive: item.isActive,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private mapUnit(
    unit: EquipmentUnitRecord,
    currentUser: CurrentAuthUser,
    capabilities: EquipmentGlobalCapabilities,
  ): EquipmentUnitResponseDto {
    return {
      id: unit.id,
      inventoryNumber: unit.inventoryNumber,
      serialNumber: unit.serialNumber,
      status: unit.status,
      notes: unit.notes,
      currentObject: unit.currentObject
        ? {
            id: unit.currentObject.id,
            name: unit.currentObject.name,
            canOpenObjectCard: canViewObjectByScope({
              currentUserId: currentUser.id,
              roleCodes: this.getRoleCodes(currentUser),
              object: unit.currentObject,
            }),
          }
        : null,
      currentOneTimeOrder:
        unit.currentOneTimeOrder &&
        canViewOneTimeOrderByScope({
          currentUserId: currentUser.id,
          roleCodes: this.getRoleCodes(currentUser),
          permissionCodes: currentUser.permissionCodes,
          order: unit.currentOneTimeOrder,
        })
        ? {
            id: unit.currentOneTimeOrder.id,
            title: unit.currentOneTimeOrder.title,
            status: unit.currentOneTimeOrder.status,
            canOpenOrderCard: true,
          }
        : null,
      catalogItem: this.mapCatalogItem(unit.catalogItem),
      createdAt: unit.createdAt.toISOString(),
      updatedAt: unit.updatedAt.toISOString(),
      capabilities: {
        canCreateMovement: capabilities.canAccessEquipment,
        canAssignToObject: capabilities.canAssignEquipmentToObject,
        canAssignToOneTimeOrder: capabilities.canAssignEquipmentToOneTimeOrder,
        canReturn: capabilities.canReturnEquipment,
        canMove: capabilities.canMoveEquipment,
        canMarkBroken: capabilities.canMarkEquipmentBroken,
        canSendToRepair: capabilities.canSendEquipmentToRepair,
        canReturnFromRepair: capabilities.canReturnEquipmentFromRepair,
        canWriteoff: capabilities.canWriteoffEquipment,
        canViewHistory: capabilities.canViewEquipmentHistory,
      },
    };
  }

  private mapMovement(
    movement: EquipmentMovementRecord,
    attachments: FileResponseDto[],
    approvalRequest:
      | {
          id: string;
          approvalType: string;
          status: string;
        }
      | null,
    currentUser: CurrentAuthUser,
  ): EquipmentMovementResponseDto {
    const roleCodes = this.getRoleCodes(currentUser);
    const mapObject = (object: ObjectScope | null) =>
      object
        ? {
            id: object.id,
            name: object.name,
            canOpenObjectCard: canViewObjectByScope({
              currentUserId: currentUser.id,
              roleCodes,
              object,
            }),
          }
        : null;
    const mapOrder = (order: OrderScope | null) =>
      order &&
      canViewOneTimeOrderByScope({
        currentUserId: currentUser.id,
        roleCodes,
        permissionCodes: currentUser.permissionCodes,
        order,
      })
        ? {
            id: order.id,
            title: order.title,
            status: order.status,
            canOpenOrderCard: true,
          }
        : null;

    return {
      id: movement.id,
      equipmentUnitId: movement.equipmentUnitId,
      movementType: movement.movementType,
      status: movement.status,
      fromStatus: movement.fromStatus,
      toStatus: movement.toStatus,
      fromObject: mapObject(movement.fromObject),
      toObject: mapObject(movement.toObject),
      fromOneTimeOrder: mapOrder(movement.fromOneTimeOrder),
      toOneTimeOrder: mapOrder(movement.toOneTimeOrder),
      comment: movement.comment,
      createdBy: movement.createdBy,
      createdAt: movement.createdAt.toISOString(),
      attachments,
      approvalRequest,
    };
  }

  private mapFile(file: {
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
  }): FileResponseDto {
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

  private unitInclude() {
    return {
      catalogItem: true,
      currentObject: {
        select: {
          id: true,
          name: true,
          createdByUserId: true,
          assignments: {
            where: { isActive: true },
            select: { userId: true, isActive: true },
          },
        },
      },
      currentOneTimeOrder: {
        select: {
          id: true,
          title: true,
          status: true,
          createdByUserId: true,
          assignments: {
            where: { isActive: true },
            select: { userId: true, assignmentRoleCode: true, isActive: true },
          },
        },
      },
    };
  }

  private movementInclude() {
    const objectSelect = {
      id: true,
      name: true,
      createdByUserId: true,
      assignments: {
        where: { isActive: true },
        select: { userId: true, isActive: true },
      },
    };
    const orderSelect = {
      id: true,
      title: true,
      status: true,
      createdByUserId: true,
      assignments: {
        where: { isActive: true },
        select: { userId: true, assignmentRoleCode: true, isActive: true },
      },
    };

    return {
      createdBy: { select: { id: true, login: true, fullName: true } },
      fromObject: { select: objectSelect },
      toObject: { select: objectSelect },
      fromOneTimeOrder: { select: orderSelect },
      toOneTimeOrder: { select: orderSelect },
    };
  }

  private scopedReadCapabilities(): EquipmentGlobalCapabilities {
    return {
      canAccessEquipment: false,
      canManageEquipmentCatalog: false,
      canAssignEquipmentToObject: false,
      canAssignEquipmentToOneTimeOrder: false,
      canReturnEquipment: false,
      canMoveEquipment: false,
      canMarkEquipmentBroken: false,
      canSendEquipmentToRepair: false,
      canReturnEquipmentFromRepair: false,
      canWriteoffEquipment: false,
      canViewEquipmentHistory: true,
    };
  }

  private getGlobalCapabilities(
    currentUser: CurrentAuthUser,
  ): EquipmentGlobalCapabilities {
    return buildEquipmentGlobalCapabilities(this.getRoleCodes(currentUser));
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }
}
