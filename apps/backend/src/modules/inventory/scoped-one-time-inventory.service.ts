import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { CreateObjectInventoryIssueDto } from './dto/create-object-inventory-issue.dto';
import { canIssueInventoryToOneTimeOrder } from './utils/inventory-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

export interface ScopedOneTimeInventoryIssueResponse {
  id: string;
  inventoryItemId: string;
  oneTimeOrderId: string;
  quantity: number;
  unitPriceSnapshot: number;
  totalAmountSnapshot: number;
  status: string;
  evidenceRequired: boolean;
  createdAt: string;
}

@Injectable()
export class ScopedOneTimeInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async issueToOrder(
    currentUser: CurrentAuthUser,
    orderId: string,
    payload: CreateObjectInventoryIssueDto,
  ): Promise<ScopedOneTimeInventoryIssueResponse> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        assignments: {
          where: {
            userId: currentUser.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
          select: { id: true },
        },
      },
    });
    if (!order) throw new NotFoundException('One-time order not found');

    const roleCodes = currentUser.roleCodes ?? [currentUser.roleCode];
    if (
      !canIssueInventoryToOneTimeOrder(roleCodes) &&
      order.assignments.length === 0
    ) {
      throw new ForbiddenException(
        'Inventory issue is limited to assigned one-time orders',
      );
    }

    const quantity = Number(payload.quantity);
    if (!Number.isFinite(quantity) || quantity < 0.001) {
      throw new BadRequestException('Inventory quantity must be at least 0.001');
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "inventory_items"
        WHERE "id" = ${payload.inventoryItemId}
        FOR UPDATE
      `;

      const item = await tx.inventoryItem.findUnique({
        where: { id: payload.inventoryItemId },
        select: {
          id: true,
          isActive: true,
          currentUnitPrice: true,
        },
      });
      if (!item) throw new NotFoundException('Inventory item not found');
      if (!item.isActive) {
        throw new BadRequestException(
          'Inactive inventory item cannot be used in movements',
        );
      }
      if (!item.currentUnitPrice) {
        throw new BadRequestException(
          'Inventory item has no current unit price; create a receipt first',
        );
      }

      const rows = await tx.inventoryMovement.findMany({
        where: { inventoryItemId: item.id, status: 'applied' },
        select: {
          movementType: true,
          quantity: true,
          adjustmentDirection: true,
        },
      });
      const currentStock = rows.reduce((sum, row) => {
        const value = Number(row.quantity);
        if (row.movementType === 'receipt' || row.movementType === 'return') {
          return sum + value;
        }
        if (
          row.movementType === 'issue_to_object' ||
          row.movementType === 'issue_to_one_time_order' ||
          row.movementType === 'writeoff'
        ) {
          return sum - value;
        }
        if (row.movementType === 'adjustment') {
          return sum + (row.adjustmentDirection === 'increase' ? value : -value);
        }
        return sum;
      }, 0);
      if (currentStock - quantity < -0.0001) {
        throw new BadRequestException('Insufficient stock for movement');
      }

      const unitPriceSnapshot = item.currentUnitPrice;
      const totalAmountSnapshot = unitPriceSnapshot.mul(
        new Prisma.Decimal(quantity),
      );
      const created = await tx.inventoryMovement.create({
        data: {
          inventoryItemId: item.id,
          movementType: 'issue_to_one_time_order',
          status: 'applied',
          quantity: new Prisma.Decimal(quantity),
          unitPriceSnapshot,
          totalAmountSnapshot,
          adjustmentDirection: null,
          comment: payload.comment?.trim() || null,
          evidenceRequired: true,
          requiresApprovalBridge: true,
          approvalBridgeType: 'inventory_missing_photo_evidence_required',
          createdByUserId: currentUser.id,
          relatedObjectId: null,
          relatedOneTimeOrderId: order.id,
        },
      });

      await this.auditService.writeAuditEvent(
        {
          entityType: 'inventory_movement',
          entityId: created.id,
          actorUserId: currentUser.id,
          action: 'inventory.movement.created',
          newValues: {
            inventoryItemId: item.id,
            movementType: created.movementType,
            quantity,
            unitPriceSnapshot: Number(unitPriceSnapshot),
            totalAmountSnapshot: Number(totalAmountSnapshot),
            evidenceRequired: true,
            requiresApprovalBridge: true,
            approvalBridgeType: created.approvalBridgeType,
            relatedOneTimeOrderId: order.id,
          },
        },
        tx,
      );
      return created;
    });

    return {
      id: movement.id,
      inventoryItemId: movement.inventoryItemId,
      oneTimeOrderId: order.id,
      quantity: Number(movement.quantity),
      unitPriceSnapshot: Number(movement.unitPriceSnapshot),
      totalAmountSnapshot: Number(movement.totalAmountSnapshot),
      status: movement.status,
      evidenceRequired: movement.evidenceRequired,
      createdAt: movement.createdAt.toISOString(),
    };
  }
}
