import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { delegatedObjectIds, usedObjectDelegations } from '../user-substitutions/object-delegation.context';
import {
  normalizeObjectSetup, normalizeObjectSetupPatch, normalizeObjectSetupFields,
  type ObjectSetupBudget, type ObjectSetupCapabilities, type ObjectSetupData,
  type ObjectSetupResponseDto,
} from './dto/object-setup.dto';
import {
  canCreateObject, canEditObject, canOverrideFrozenObject,
  canViewObjectBasicProfile, canViewObjectByScope,
  hasHrObjectView, hasWideObjectAccess,
} from './utils/object-access.util';
import { moscowMonthWindow } from './utils/object-season.util';

export { normalizeObjectSetup, normalizeObjectSetupFields, normalizeObjectSetupPatch, validateObjectSetup } from './dto/object-setup.dto';

export interface ObjectSetupActor {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

type SetupObject = {
  id: string;
  createdByUserId: string;
  status: string;
  assignments: Array<{ userId: string; isActive: boolean }>;
};
type Database = Prisma.TransactionClient;

@Injectable()
export class ObjectSetupService {
  constructor(private readonly prisma: PrismaService) {}

  private static roles(user: ObjectSetupActor): string[] {
    return user.roleCodes?.length ? user.roleCodes : [user.roleCode];
  }

  private static assertActive(user: ObjectSetupActor) {
    if (!user.isActive) throw new ForbiddenException('Пользователь неактивен');
  }

  private async context(tx: Database, user: ObjectSetupActor, objectId: string): Promise<SetupObject> {
    ObjectSetupService.assertActive(user);
    const roles = ObjectSetupService.roles(user);
    const object = await tx.object.findFirst({
      where: {
        id: objectId,
        deletedAt: null,
        ...(!hasWideObjectAccess(roles) && !hasHrObjectView(user.permissionCodes) ? {
          OR: [
            { createdByUserId: user.id },
            { assignments: { some: { userId: user.id, isActive: true } } },
            { id: { in: delegatedObjectIds(user.id) } },
          ],
        } : {}),
      },
      select: {
        id: true, status: true, createdByUserId: true,
        assignments: { where: { isActive: true }, select: { userId: true, isActive: true } },
      },
    });
    if (!object || !canViewObjectBasicProfile({
      currentUserId: user.id, roleCodes: roles,
      permissionCodes: user.permissionCodes, object,
    })) throw new NotFoundException('Объект не найден');
    return object;
  }

  private static capabilities(user: ObjectSetupActor, object: SetupObject): ObjectSetupCapabilities {
    const roles = ObjectSetupService.roles(user);
    const operational = canViewObjectByScope({ currentUserId: user.id, roleCodes: roles, object });
    const leadership = canEditObject(roles);
    const writable = object.status !== 'archived' && (object.status !== 'frozen' || canOverrideFrozenObject(roles));
    return {
      canEditCore: writable && leadership,
      canViewContractAmount: leadership,
      canEditContractAmount: writable && leadership,
      canViewBudgets: operational,
      canEditBudgets: writable && operational && (
        roles.some((role) => role === 'founder' || role === 'director') ||
        !!user.permissionCodes?.includes('object.budget_edit')
      ),
      canViewCoefficient: operational,
      canEditCoefficient: writable && operational && !!user.permissionCodes?.includes('object.coefficient_edit'),
    };
  }

  private static assertFields(changes: Partial<ObjectSetupData>, caps: ObjectSetupCapabilities) {
    for (const field of Object.keys(changes) as Array<keyof ObjectSetupData>) {
      const allowed = field === 'budgets' ? caps.canEditBudgets
        : field === 'coefficient' ? caps.canEditCoefficient
          : field === 'contractMonthlyAmount' ? caps.canEditContractAmount : caps.canEditCore;
      if (!allowed) throw new ForbiddenException(`Изменение setup.${field} недоступно`);
    }
  }

  private static async validateReferences(tx: Database, changes: Partial<ObjectSetupData>) {
    if (changes.salesResponsibleUserId) {
      const user = await tx.user.findFirst({
        where: { id: changes.salesResponsibleUserId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw new BadRequestException('Ответственный за продажи должен быть активным User');
    }
  }

  async getSetup(user: ObjectSetupActor, objectId: string): Promise<ObjectSetupResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const object = await this.context(tx, user, objectId);
      const saved = await tx.objectSetup.findUnique({ where: { objectId } });
      return this.response(tx, user, object, saved?.version ?? 0, normalizeObjectSetup(saved?.data ?? {}));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async patchSetup(user: ObjectSetupActor, objectId: string, input: unknown): Promise<ObjectSetupResponseDto> {
    const { expectedVersion, changes } = normalizeObjectSetupPatch(input);
    return this.prisma.$transaction(async (tx) => {
      // Resolve scope before locking, then recheck it under the row lock.
      await this.context(tx, user, objectId);
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const object = await this.context(tx, user, objectId);
      ObjectSetupService.assertFields(changes, ObjectSetupService.capabilities(user, object));
      const saved = await tx.objectSetup.findUnique({ where: { objectId } });
      if ((saved?.version ?? 0) !== expectedVersion) throw new ConflictException('Настройки изменены. Обновите данные.');
      const oldData = normalizeObjectSetup(saved?.data ?? {});
      const data = normalizeObjectSetup({ ...oldData, ...changes });
      await ObjectSetupService.validateReferences(tx, changes);
      const json = data as unknown as Prisma.InputJsonObject;
      // The parent row lock serializes first inserts too (version zero).
      const result = saved
        ? await tx.objectSetup.update({ where: { objectId }, data: { data: json, version: { increment: 1 } } })
        : await tx.objectSetup.create({ data: { objectId, data: json } });
      await ObjectSetupService.audit(tx, user, objectId, oldData, data, result.version, 'object.setup.updated');
      return this.response(tx, user, object, result.version, data);
    });
  }

  /** ORCH calls this inside its object-create transaction, before assignments
   * exist. No ObjectsService dependency and no nested transaction/commit. */
  async createInTransaction(tx: Database, user: ObjectSetupActor, objectId: string, input: unknown) {
    return createInTransaction(tx, user, objectId, input);
  }

  static async createInTransaction(tx: Database, user: ObjectSetupActor, objectId: string, input: unknown) {
    if (input === undefined) return null;
    ObjectSetupService.assertActive(user);
    if (!canCreateObject(ObjectSetupService.roles(user))) throw new ForbiddenException('Создание setup недоступно');
    await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
    const object = await tx.object.findFirst({
      where: { id: objectId, createdByUserId: user.id, deletedAt: null },
      select: { id: true, createdByUserId: true, status: true },
    });
    if (!object) throw new NotFoundException('Создаваемый объект не найден');
    // Validate only provided fields against ACL; nullable defaults are not edits.
    const changes = normalizeObjectSetupFields(input);
    ObjectSetupService.assertFields(changes, ObjectSetupService.capabilities(user, { ...object, assignments: [] }));
    if (await tx.objectSetup.findUnique({ where: { objectId } })) throw new ConflictException('Настройки уже созданы');
    const data = normalizeObjectSetup(changes);
    await ObjectSetupService.validateReferences(tx, changes);
    const saved = await tx.objectSetup.create({ data: { objectId, data: data as unknown as Prisma.InputJsonObject } });
    await ObjectSetupService.audit(tx, user, objectId, normalizeObjectSetup(), data, saved.version, 'object.setup.created');
    return { version: saved.version, data };
  }

  private static async audit(
    tx: Database, user: ObjectSetupActor, objectId: string,
    before: ObjectSetupData, after: ObjectSetupData, version: number, actionCode: string,
  ) {
    const changes: Record<string, Prisma.InputJsonValue> = {};
    const restrictedChanges: string[] = [];
    for (const field of Object.keys(after) as Array<keyof ObjectSetupData>) {
      if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
      // Existing public audit readers cannot reliably redact new JSON fields.
      if (field === 'contractMonthlyAmount' || field === 'budgets' || field === 'coefficient') {
        restrictedChanges.push(field);
      } else {
        changes[field] = { before: before[field], after: after[field] } as Prisma.InputJsonObject;
      }
    }
    await tx.objectAuditLog.create({ data: {
      objectId, actorUserId: user.id, actionCode,
      payload: { version, changes, restrictedChanges, delegatedActors: usedObjectDelegations() },
    } });
    // Detailed snapshots belong to the restricted audit store. Do not attach
    // these to ObjectAuditLog: its existing readers are object-scoped/public.
    await tx.auditEvent.create({ data: {
      entityType: 'object_setup', entityId: objectId,
      actorUserId: user.id, action: actionCode,
      oldValues: before as unknown as Prisma.InputJsonObject,
      newValues: after as unknown as Prisma.InputJsonObject,
      metadata: { version, delegations: usedObjectDelegations() },
    } });
  }

  private async response(
    tx: Database, user: ObjectSetupActor, object: SetupObject,
    version: number, stored: ObjectSetupData,
  ): Promise<ObjectSetupResponseDto> {
    const capabilities = ObjectSetupService.capabilities(user, object);
    const data: ObjectSetupData = {
      ...stored,
      contractMonthlyAmount: capabilities.canViewContractAmount ? stored.contractMonthlyAmount : null,
      budgets: capabilities.canViewBudgets ? stored.budgets : null,
      coefficient: capabilities.canViewCoefficient ? stored.coefficient : null,
    };
    const { month, start, end } = moscowMonthWindow();
    let consumablesActualAmount: number | null = null;
    let payrollActual: number | null = null;
    if (capabilities.canViewBudgets) {
      const inventory = await tx.inventoryMovement.groupBy({
        by: ['movementType'],
        where: {
          status: 'applied',
          movementType: { in: ['issue_to_object', 'issue_to_one_time_order', 'return'] },
          createdAt: { gte: start, lt: end },
          AND: [
            { OR: [{ requiresApprovalBridge: false }, { approvalBridgeResolvedAt: { not: null } }] },
            { OR: [{ relatedObjectId: object.id }, { relatedObjectId: null, relatedOneTimeOrder: { linkedObjectId: object.id } }] },
          ],
        },
        _sum: { totalAmountSnapshot: true },
      });
      consumablesActualAmount = inventory.reduce((sum, row) => row.movementType === 'return'
        ? sum.minus(row._sum.totalAmountSnapshot ?? 0) : sum.plus(row._sum.totalAmountSnapshot ?? 0), new Prisma.Decimal(0)).toNumber();
      const [year, monthNumber] = month.split('-').map(Number);
      const payroll = await tx.timesheetDayEntry.aggregate({
        where: { row: { timesheetMonth: { objectId: object.id, year, month: monthNumber } } },
        _sum: { dayValue: true },
      });
      payrollActual = payroll._sum.dayValue;
    }
    const monthIndex = Number(month.slice(5)) - 1;
    return {
      objectId: object.id, version, data, capabilities,
      budgets: {
        month,
        consumablesActualAmount,
        consumablesSource: capabilities.canViewBudgets
          ? 'InventoryMovement: applied подтверждённые выдачи минус возвраты, включая связанные разовые заказы; общий итог без разбивки по статьям'
          : 'Нет операционного доступа к бюджетам',
        rows: (data.budgets ?? []).map((row) => ({
          category: row.category,
          planAmount: objectSetupMonthlyPlan(row, monthIndex, month),
          actualAmount: row.category === 'payroll' ? payrollActual : null,
          source: row.category === 'payroll'
            ? payrollActual === null ? 'TimesheetDayEntry.dayValue: нет сохранённых ячеек за месяц'
              : 'TimesheetDayEntry.dayValue: сумма сохранённых начислений за месяц, не выплаты'
            : row.category.startsWith('consumables_')
              ? 'Нет подтверждённого соответствия складских движений этой статье; общий расход указан отдельно'
              : 'Для этой статьи нет подключённого источника подтверждённого факта',
        })),
      },
    };
  }
}

/** Standalone create hook for callers that must not inject another service. */
export async function createInTransaction(tx: Database, user: ObjectSetupActor, objectId: string, input: unknown) {
  return ObjectSetupService.createInTransaction(tx, user, objectId, input);
}

/** A plan is not an expense. Occurrence counts describe this monthly plan. */
export function objectSetupMonthlyPlan(
  row: ObjectSetupBudget,
  monthIndex: number,
  month: string,
): number | null {
  if (row.period === 'once') return row.targetMonth === month ? row.amount : null;
  if (row.period === 'monthly') return row.amount;
  if (row.period === 'annual') return row.monthlyAllocation
    ? row.monthlyAllocation[monthIndex] ?? null
    : row.amount === null ? null : new Prisma.Decimal(row.amount).div(12).toDecimalPlaces(2).toNumber();
  return row.amount === null || row.plannedOccurrences === null ? null
    : new Prisma.Decimal(row.amount).mul(row.plannedOccurrences).toNumber();
}
