import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';

import { canViewOneTimeOrderByScope } from '../one-time-orders/utils/one-time-order-access.util';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessContext, AccessSubject } from '../users-access/types/access-policy.type';
import { decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';

import { ScopedEquipmentActionDto, ScopedEquipmentMovementReceiptDto } from './dto/scoped-equipment-action.dto';

interface CurrentAuthUser extends AccessSubject {
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
  ) {}

  async listOrderOptions(currentUser: CurrentAuthUser, orderId: string) {
    const order = await this.prisma.oneTimeOrder.findUnique({ where: { id: orderId }, select: {
      id: true, status: true, createdByUserId: true,
      assignments: { where: { isActive: true }, select: { userId: true, assignmentRoleCode: true, isActive: true } },
    } });
    if (!order || !canViewOneTimeOrderByScope({ subject: currentUser, currentUserId: currentUser.id,
      roleCodes: currentUser.roleCodes?.length ? currentUser.roleCodes : [currentUser.roleCode],
      permissionCodes: currentUser.permissionCodes, order })) throw new ForbiddenException('Equipment order unavailable');
    const orderContext: AccessContext = { resourceType: 'one_time_order', resourceId: order.id,
      ownerUserId: order.createdByUserId, assignedUserIds: order.assignments.filter(a => a.assignmentRoleCode === 'one_time_manager').map(a => a.userId) };
    if (!decideAccess(currentUser, 'one_time_orders.read', true, orderContext) ||
        !decideAccess(currentUser, 'one_time_orders.equipment.read', true, orderContext)) throw new ForbiddenException('Equipment order unavailable');
    const assigned = order.assignments.some(a => a.userId === currentUser.id && a.assignmentRoleCode === 'one_time_manager');
    if (!assigned) return { availableUnits: [], returnableUnitIds: [], canAssign: false };
    const units = await this.prisma.equipmentUnit.findMany({ where: { OR: [
      { status: 'in_storage', currentObjectId: null, currentOneTimeOrderId: null },
      { currentOneTimeOrderId: orderId },
    ] }, select: { id: true, inventoryNumber: true, currentOneTimeOrderId: true,
      catalogItem: { select: { name: true } } }, orderBy: [{ inventoryNumber: 'asc' }, { id: 'asc' }] });
    const allowed = (id: string, action: string): boolean => {
      const context: AccessContext = { resourceType: 'equipment_unit', resourceId: id,
        parents: [{ actionCode: 'one_time_orders.read', context: orderContext }] };
      return !hasModuleDeny(currentUser, 'equipment.read', context) && decideAccess(currentUser, action, true, context);
    };
    const open = !['frozen', 'archived', 'closed', 'completed', 'cancelled'].includes(order.status);
    const availableUnits = units.filter(unit => !unit.currentOneTimeOrderId && open && allowed(unit.id, 'equipment.assign_order'))
      .map(unit => ({ id: unit.id, inventoryNumber: unit.inventoryNumber, name: unit.catalogItem.name }));
    return { availableUnits, returnableUnitIds: units.filter(unit => unit.currentOneTimeOrderId === orderId && allowed(unit.id, 'equipment.return')).map(unit => unit.id),
      canAssign: availableUnits.length > 0 };
  }

  async assignToObject(
    currentUser: CurrentAuthUser,
    unitId: string,
    objectId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.applyScopedMovement({
      currentUser,
      unitId,
      movementType: 'issue_to_object',
      toStatus: 'assigned_to_object',
      toObjectId: objectId,
      toOneTimeOrderId: null,
      comment: payload.comment,
    });
  }

  async assignToOneTimeOrder(
    currentUser: CurrentAuthUser,
    unitId: string,
    orderId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.applyScopedMovement({
      currentUser,
      unitId,
      movementType: 'issue_to_one_time_order',
      toStatus: 'assigned_to_one_time_order',
      toObjectId: null,
      toOneTimeOrderId: orderId,
      comment: payload.comment,
    });
  }

  async returnFromOrder(currentUser: CurrentAuthUser, unitId: string, orderId: string, payload: ScopedEquipmentActionDto): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.applyScopedMovement({ currentUser, unitId, expectedOneTimeOrderId: orderId,
      movementType: 'return_to_storage', toStatus: 'in_storage', toObjectId: null, toOneTimeOrderId: null, comment: payload.comment });
  }

  async returnToStorage(
    currentUser: CurrentAuthUser,
    unitId: string,
    payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.applyScopedMovement({
      currentUser,
      unitId,
      movementType: 'return_to_storage',
      toStatus: 'in_storage',
      toObjectId: null,
      toOneTimeOrderId: null,
      comment: payload.comment,
    });
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
    unitId: string;
    expectedOneTimeOrderId?: string;
    movementType: 'issue_to_object' | 'issue_to_one_time_order' | 'return_to_storage';
    toStatus: 'assigned_to_object' | 'assigned_to_one_time_order' | 'in_storage';
    toObjectId: string | null;
    toOneTimeOrderId: string | null;
    comment?: string;
  }): Promise<ScopedEquipmentMovementReceiptDto> {
    const actionCode = params.movementType === 'issue_to_object' ? 'equipment.assign_object'
      : params.movementType === 'issue_to_one_time_order' ? 'equipment.assign_order' : 'equipment.return';
    const assertAccess = (context: AccessContext): void => {
      if (hasModuleDeny(params.currentUser, 'equipment.read', context)) throw new ForbiddenException('Scoped equipment read denied');
      if (!decideAccess(params.currentUser, actionCode, true, context)) throw new ForbiddenException('Scoped equipment action denied');
    };
    // Unit/module denies must win even for missing, unassigned or wrong-state units.
    assertAccess({ resourceType: 'equipment_unit', resourceId: params.unitId });
    const observed = await this.loadUnit(params.unitId);
    return this.prisma.$transaction(async (tx) => {
      // Source rows precede the unit lock, matching source-management writes.
      // Keep the state checked for authorization stable until the movement commits.
      const sourceKeys = [
        ...new Set([
          observed.currentObjectId && `object:${observed.currentObjectId}`,
          params.toObjectId && `object:${params.toObjectId}`,
          observed.currentOneTimeOrderId && `order:${observed.currentOneTimeOrderId}`,
          params.toOneTimeOrderId && `order:${params.toOneTimeOrderId}`,
        ].filter((key): key is string => Boolean(key))),
      ].sort();
      for (const key of sourceKeys) {
        const [kind, id] = key.split(':');
        if (kind === 'object') {
          await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${id} FOR SHARE`;
        } else {
          await tx.$queryRaw`SELECT "id" FROM "one_time_orders" WHERE "id" = ${id} FOR SHARE`;
        }
      }
      // Serialize every scoped transition before reading the state used to apply it.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "equipment_units" WHERE "id" = ${params.unitId} FOR UPDATE`);
      await lockActorAccessRevision(tx, params.currentUser);
      const current = await tx.equipmentUnit.findUnique({
        where: { id: params.unitId },
        select: {
          id: true,
          status: true,
          currentObjectId: true,
          currentOneTimeOrderId: true,
        },
      });
      if (!current) throw new NotFoundException('Equipment unit not found');
      if (
        current.status !== observed.status ||
        current.currentObjectId !== observed.currentObjectId ||
        current.currentOneTimeOrderId !== observed.currentOneTimeOrderId
      ) {
        throw new ConflictException('Equipment unit state changed; refresh and retry');
      }
      const parents: NonNullable<AccessContext['parents']>[number][] = [];
      const workScopes: Array<{ status: string; assigned: boolean; deleted: boolean }> = [];
      const seen = new Set<string>();
      for (const [entityType, id] of [
        ['object', observed.currentObjectId], ['object', current.currentObjectId], ['object', params.toObjectId],
        ['one_time_order', observed.currentOneTimeOrderId], ['one_time_order', current.currentOneTimeOrderId], ['one_time_order', params.toOneTimeOrderId],
      ] as const) {
        if (!id || seen.has(`${entityType}:${id}`)) continue;
        seen.add(`${entityType}:${id}`);
        if (entityType === 'object') {
          await tx.$queryRaw`SELECT "id" FROM "object_assignments"
            WHERE "objectId" = ${id} AND "userId" = ${params.currentUser.id}
              AND "isActive" = true ORDER BY "id" FOR SHARE`;
        } else {
          await tx.$queryRaw`SELECT "id" FROM "one_time_order_assignments"
            WHERE "oneTimeOrderId" = ${id} AND "userId" = ${params.currentUser.id}
              AND "assignmentRoleCode" = 'one_time_manager' AND "isActive" = true
            ORDER BY "id" FOR SHARE`;
        }
        const work = entityType === 'object'
          ? await tx.object.findUnique({ where: { id }, select: { id: true, status: true, deletedAt: true, createdByUserId: true,
            assignments: { where: { isActive: true }, select: { userId: true, assignmentRoleCode: true } } } })
          : await tx.oneTimeOrder.findUnique({ where: { id }, select: { id: true, status: true, createdByUserId: true,
            assignments: { where: { isActive: true }, select: { userId: true, assignmentRoleCode: true } } } });
        if (!work) throw new ForbiddenException('Equipment work scope unavailable');
        if (entityType === 'one_time_order' && !decideAccess(params.currentUser, 'one_time_orders.equipment.read', true, {
          resourceType: entityType, resourceId: id, ownerUserId: work.createdByUserId,
          assignedUserIds: work.assignments.filter(a => a.assignmentRoleCode === 'one_time_manager').map(a => a.userId),
        })) throw new ForbiddenException('Order equipment access denied');
        parents.push({ actionCode: entityType === 'object' ? 'objects.read' : 'one_time_orders.read', context: {
          resourceType: entityType, resourceId: id, ownerUserId: work.createdByUserId,
          assignedUserIds: work.assignments.map((assignment) => assignment.userId),
        } });
        workScopes.push({ status: work.status,
          deleted: 'deletedAt' in work && work.deletedAt !== null,
          assigned: work.assignments.some((assignment) => assignment.userId === params.currentUser.id &&
            (entityType === 'object' || assignment.assignmentRoleCode === 'one_time_manager')) });
      }
      const context = { resourceType: 'equipment_unit', resourceId: current.id, parents };
      assertAccess(context);
      // Positive leaf grants never replace this workflow's active assignment.
      if (workScopes.some((work) => !work.assigned || work.deleted)) throw new ForbiddenException('Equipment assignment was revoked');
      if (params.expectedOneTimeOrderId && current.currentOneTimeOrderId !== params.expectedOneTimeOrderId) {
        throw new ConflictException('Equipment unit no longer belongs to this order');
      }
      if (params.movementType === 'return_to_storage') {
        if (!current.currentObjectId && !current.currentOneTimeOrderId) throw new ConflictException('Equipment unit is not assigned to a work scope');
      } else {
        this.assertUnitInStorage(current);
        if (workScopes.some((work) => ['frozen', 'archived', 'closed', 'completed', 'cancelled'].includes(work.status))) throw new ConflictException('Equipment destination is read-only');
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

      const updated = await tx.equipmentUnit.update({
        where: { id: current.id },
        data: {
          status: params.toStatus,
          currentObjectId: params.toObjectId,
          currentOneTimeOrderId: params.toOneTimeOrderId,
        },
        select: { id: true, status: true },
      });
      await this.auditService.writeAuditEvent({
        entityType: 'equipment_movement',
        entityId: created.id,
        actorUserId: params.currentUser.id,
        action: `equipment.${params.movementType}.scoped_manager`,
        newValues: {
          equipmentUnitId: current.id,
          toStatus: params.toStatus,
          toObjectId: params.toObjectId,
          toOneTimeOrderId: params.toOneTimeOrderId,
        },
      }, tx);
      // Return the authorized operation's receipt before commit. A subsequent
      // global GET may legitimately be forbidden after the unit leaves its scope.
      return { id: updated.id, movementId: created.id, status: updated.status };
    });
  }
}
