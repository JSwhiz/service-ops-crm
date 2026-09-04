import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { ScopedEquipmentActionDto } from './dto/scoped-equipment-action.dto';
import { EquipmentUnitResponseDto } from './dto/equipment-response.dto';
import { EquipmentService } from './equipment.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class ScopedEquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly equipmentService: EquipmentService,
  ) {}

  async assignToObject(
    currentUser: CurrentAuthUser,
    unitId: string,
    objectId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    const [unit, object] = await Promise.all([
      this.loadUnit(unitId),
      this.prisma.object.findFirst({
        where: { id: objectId, deletedAt: null },
        select: {
          id: true,
          assignments: {
            where: { userId: currentUser.id, isActive: true },
            select: { id: true },
          },
        },
      }),
    ]);

    if (!object) throw new NotFoundException('Object not found');
    if (object.assignments.length === 0) {
      throw new ForbiddenException('Equipment assignment is limited to assigned objects');
    }
    this.assertUnitInStorage(unit);

    await this.applyScopedMovement({
      currentUser,
      unit,
      movementType: 'issue_to_object',
      toStatus: 'assigned_to_object',
      toObjectId: object.id,
      toOneTimeOrderId: null,
      comment: payload.comment,
    });

    return this.equipmentService.getUnitById(currentUser, unit.id);
  }

  async assignToOneTimeOrder(
    currentUser: CurrentAuthUser,
    unitId: string,
    orderId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    const [unit, order] = await Promise.all([
      this.loadUnit(unitId),
      this.prisma.oneTimeOrder.findFirst({
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
      }),
    ]);

    if (!order) throw new NotFoundException('One-time order not found');
    if (order.assignments.length === 0) {
      throw new ForbiddenException(
        'Equipment assignment is limited to assigned one-time orders',
      );
    }
    this.assertUnitInStorage(unit);

    await this.applyScopedMovement({
      currentUser,
      unit,
      movementType: 'issue_to_one_time_order',
      toStatus: 'assigned_to_one_time_order',
      toObjectId: null,
      toOneTimeOrderId: order.id,
      comment: payload.comment,
    });

    return this.equipmentService.getUnitById(currentUser, unit.id);
  }

  async returnToStorage(
    currentUser: CurrentAuthUser,
    unitId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    const unit = await this.loadUnit(unitId);

    if (unit.currentObjectId) {
      const assignment = await this.prisma.objectAssignment.findFirst({
        where: {
          objectId: unit.currentObjectId,
          userId: currentUser.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'Equipment return is limited to assigned objects',
        );
      }
    } else if (unit.currentOneTimeOrderId) {
      const assignment = await this.prisma.oneTimeOrderAssignment.findFirst({
        where: {
          oneTimeOrderId: unit.currentOneTimeOrderId,
          userId: currentUser.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'Equipment return is limited to assigned one-time orders',
        );
      }
    } else {
      throw new ConflictException('Equipment unit is not assigned to a work scope');
    }

    await this.applyScopedMovement({
      currentUser,
      unit,
      movementType: 'return_to_storage',
      toStatus: 'in_storage',
      toObjectId: null,
      toOneTimeOrderId: null,
      comment: payload.comment,
    });

    return this.equipmentService.getUnitById(currentUser, unit.id);
  }

  private async loadUnit(unitId: string): Promise<{
    id: string;
    status: string;
    currentObjectId: string | null;
    currentOneTimeOrderId: string | null;
  }> {
    const unit = await this.prisma.equipmentUnit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        status: true,
        currentObjectId: true,
        currentOneTimeOrderId: true,
      },
    });
    if (!unit) throw new NotFoundException('Equipment unit not found');
    return unit;
  }

  private assertUnitInStorage(unit: {
    status: string;
    currentObjectId: string | null;
    currentOneTimeOrderId: string | null;
  }): void {
    if (
      unit.status !== 'in_storage' ||
      unit.currentObjectId !== null ||
      unit.currentOneTimeOrderId !== null
    ) {
      throw new ConflictException('Only equipment currently in storage can be assigned');
    }
  }

  private async applyScopedMovement(params: {
    currentUser: CurrentAuthUser;
    unit: {
      id: string;
      status: string;
      currentObjectId: string | null;
      currentOneTimeOrderId: string | null;
    };
    movementType: 'issue_to_object' | 'issue_to_one_time_order' | 'return_to_storage';
    toStatus: 'assigned_to_object' | 'assigned_to_one_time_order' | 'in_storage';
    toObjectId: string | null;
    toOneTimeOrderId: string | null;
    comment?: string;
  }): Promise<void> {
    const movement = await this.prisma.$transaction(async (tx) => {
      const current = await tx.equipmentUnit.findUnique({
        where: { id: params.unit.id },
        select: {
          id: true,
          status: true,
          currentObjectId: true,
          currentOneTimeOrderId: true,
        },
      });
      if (!current) throw new NotFoundException('Equipment unit not found');
      if (
        current.status !== params.unit.status ||
        current.currentObjectId !== params.unit.currentObjectId ||
        current.currentOneTimeOrderId !== params.unit.currentOneTimeOrderId
      ) {
        throw new ConflictException('Equipment unit state changed; refresh and retry');
      }

      const created = await tx.equipmentMovement.create({
        data: {
          equipmentUnitId: current.id,
          movementType: params.movementType,
          status: 'applied',
          fromStatus: current.status,
          toStatus: params.toStatus,
          fromObjectId: current.currentObjectId,
          fromOneTimeOrderId: current.currentOneTimeOrderId,
          toObjectId: params.toObjectId,
          toOneTimeOrderId: params.toOneTimeOrderId,
          comment: params.comment?.trim() || null,
          createdByUserId: params.currentUser.id,
        },
      });

      await tx.equipmentUnit.update({
        where: { id: current.id },
        data: {
          status: params.toStatus,
          currentObjectId: params.toObjectId,
          currentOneTimeOrderId: params.toOneTimeOrderId,
        },
      });
      return created;
    });

    await this.auditService.writeAuditEvent({
      entityType: 'equipment_movement',
      entityId: movement.id,
      actorUserId: params.currentUser.id,
      action: `equipment.${params.movementType}.scoped_manager`,
      newValues: {
        equipmentUnitId: params.unit.id,
        toStatus: params.toStatus,
        toObjectId: params.toObjectId,
        toOneTimeOrderId: params.toOneTimeOrderId,
      },
    });
  }
}
