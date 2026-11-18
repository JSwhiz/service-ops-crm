import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CounterpartiesService } from '../src/modules/counterparties/counterparties.service';
import { EquipmentService } from '../src/modules/equipment/equipment.service';
import { buildInventoryGlobalCapabilities } from '../src/modules/inventory/utils/inventory-capabilities.util';
import { buildObjectCapabilities } from '../src/modules/objects/utils/object-capabilities.util';
import { ObjectCompensationService } from '../src/modules/object-scheduling/object-compensation.service';
import { RubberMatAggregateService } from '../src/modules/rubber-mats/rubber-mat-aggregate.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';
import { VisitPlansService } from '../src/modules/visit-plans/visit-plans.service';

const deny = (actionCode: string): AccessRule => ({ actionCode, effect: 'deny', scope: 'all', selectedIds: [] });
const allow = (actionCode: string, id: string): AccessRule => ({ actionCode, effect: 'allow', scope: 'selected', selectedIds: [id] });
const actor = (rules: AccessRule[] = [], role = 'manager', permissions: string[] = []) => ({
  id: 'reader', login: 'reader', fullName: 'Synthetic policy reader', roleCode: role, roleCodes: [role],
  permissionCodes: permissions, isActive: true, accessRules: rules,
});

test('inventory movement entry is the OR of real movement leaf permissions, not just receipt', () => {
  const rules = ['inventory.receipt', 'inventory.issue_to_object', 'inventory.issue_to_one_time_order', 'inventory.return', 'inventory.writeoff', 'inventory.adjustment'].map(deny);
  const reader = actor(rules, 'founder');
  const capabilities = () => buildInventoryGlobalCapabilities(reader.roleCodes, [], reader, { resourceType: 'inventory_item', resourceId: 'item' });
  assert.equal(capabilities().canCreateInventoryMovement, false);
  reader.accessRules = rules.filter((rule) => rule.actionCode !== 'inventory.return');
  assert.equal(capabilities().canCreateInventoryReceipt, false);
  assert.equal(capabilities().canReturnInventory, true);
  assert.equal(capabilities().canCreateInventoryMovement, true);
});

test('inventory restore leaf is independent from catalog update/delete', () => {
  const reader = actor([deny('inventory.catalog.update'), deny('inventory.catalog.delete')], 'founder');
  let result = buildInventoryGlobalCapabilities(reader.roleCodes, [], reader);
  assert.equal(result.canManageInventoryCatalog, false);
  assert.equal(result.canDeleteInventoryItem, false);
  assert.equal(result.canRestoreInventoryItem, true);
  reader.accessRules.push(deny('inventory.catalog.restore'));
  result = buildInventoryGlobalCapabilities(reader.roleCodes, [], reader);
  assert.equal(result.canRestoreInventoryItem, false);
});

function objectCaps(reader: ReturnType<typeof actor>, status = 'active') {
  return buildObjectCapabilities({ subject: reader, objectId: 'object', currentUserId: reader.id, roleCodes: reader.roleCodes,
    permissionCodes: reader.permissionCodes, objectStatus: status, createdByUserId: 'other', assignments: [{ userId: reader.id, roleCode: 'manager' }] });
}
test('independent object freeze grant works despite generic status deny, without core/archive authority', () => {
  const reader = actor([deny('objects.status'), allow('objects.freeze', 'object')]);
  const result = objectCaps(reader);
  assert.equal(result.canChangeStatus, false);
  assert.equal(result.canFreeze, true);
  assert.equal(result.canArchive, false);
  assert.equal(result.canEdit, false);
  reader.accessRules.push(deny('objects.access'));
  assert.equal(objectCaps(reader).canFreeze, false);
});
test('archived to frozen legitimately needs both restore and freeze, not generic core permission', () => {
  const reader = actor([deny('objects.status'), allow('objects.freeze', 'object')]);
  assert.equal(objectCaps(reader, 'archived').canFreeze, false);
  reader.accessRules.push(allow('objects.restore', 'object'));
  assert.equal(objectCaps(reader, 'archived').canRestore, true);
  assert.equal(objectCaps(reader, 'archived').canFreeze, true);
  assert.equal(objectCaps(reader, 'frozen').canFreeze, false);
  assert.equal(objectCaps(reader, 'active').canRestore, false);
});
test('contacts/materials manage grants remain read-only on archived or frozen objects without override', () => {
  const reader = actor([allow('objects.contacts.manage', 'object'), allow('objects.materials.manage', 'object')]);
  assert.equal(objectCaps(reader).canManageContacts, true);
  assert.equal(objectCaps(reader).canManageMaterials, true);
  for (const status of ['archived', 'frozen']) {
    assert.equal(objectCaps(reader, status).canManageContacts, false);
    assert.equal(objectCaps(reader, status).canManageMaterials, false);
  }
  reader.accessRules.push(deny('objects.contacts.read'));
  assert.equal(objectCaps(reader).canReadContacts, false);
  assert.equal(objectCaps(reader).canReadMaterials, true);
});

test('counterparty archive/restore/master capabilities follow separate leaves and lifecycle', async () => {
  const date = new Date('2026-11-01T00:00:00Z');
  const row = { id: 'counterparty', name: 'Fixture', status: 'active', objects: [], masterObject: null,
    _count: { objects: 0 }, createdAt: date, updatedAt: date, createdBy: { id: 'other', fullName: 'Other' } };
  const service = new CounterpartiesService({ counterparty: { findUnique: async () => row } } as never, {} as never, {} as never);
  const reader = actor([deny('counterparties.update'), deny('counterparties.objects.link')], 'manager',
    ['counterparties.view', 'counterparties.manage', 'counterparties.link_objects']);
  let result = await service.getById(reader, row.id);
  assert.equal(result.capabilities.canManage, false);
  assert.equal(result.capabilities.canLinkObjects, false);
  assert.equal(result.capabilities.canArchive, true);
  assert.equal(result.capabilities.canRestore, false);
  assert.equal(result.capabilities.canManageMasterObject, true);
  row.status = 'archived';
  result = await service.getById(reader, row.id);
  assert.equal(result.capabilities.canArchive, false);
  assert.equal(result.capabilities.canRestore, true);
  reader.accessRules.push(deny('counterparties.restore'), deny('counterparties.master_object.manage'));
  result = await service.getById(reader, row.id);
  assert.equal(result.capabilities.canRestore, false);
  assert.equal(result.capabilities.canManageMasterObject, false);
});

test('equipment lost action is not falsely disabled by a separate broken-action denial', async () => {
  const date = new Date('2026-11-01T00:00:00Z');
  const row = { id: 'equipment', status: 'in_storage', createdByUserId: 'other', currentObject: null, currentOneTimeOrder: null,
    createdAt: date, updatedAt: date, _count: { movements: 0 },
    catalogItem: { id: 'catalog', category: 'Fixture', name: 'Fixture', isActive: true, createdAt: date, updatedAt: date } };
  const service = new EquipmentService({ equipmentUnit: { findFirst: async () => row } } as never, {} as never);
  const reader = actor([deny('equipment.broken')], 'founder');
  let result = await service.getUnitById(reader, row.id);
  assert.equal(result.capabilities.canMarkBroken, false);
  assert.equal(result.capabilities.canMarkLost, true);
  reader.accessRules.push(deny('equipment.lost'));
  result = await service.getUnitById(reader, row.id);
  assert.equal(result.capabilities.canMarkLost, false);
});

test('visit day exposes visit/report leaf capabilities without broadening the public manage permission', async () => {
  const service = new VisitPlansService({ user: { findFirst: async () => ({ id: 'reader' }) },
    managerVisitPlan: { findUnique: async () => null } } as never, {} as never);
  // The public rule for Gorbachova/Lebedev is a permission, not a surname match.
  const reader = actor([], 'manager', ['visit_plans.manage']);
  let result = await service.getDay(reader, '2026-11-01');
  assert.equal(result.capabilities.canManageVisits, true);
  assert.equal(result.capabilities.canManageReports, true);
  reader.accessRules.push(deny('visit_plans.visits.manage'));
  result = await service.getDay(reader, '2026-11-01');
  assert.equal(result.capabilities.canManageVisits, false);
  assert.equal(result.capabilities.canManageReports, true);
  reader.permissionCodes = [];
  reader.accessRules = [];
  result = await service.getDay(reader, '2026-11-01');
  assert.equal(result.capabilities.canManage, false);
  assert.equal(result.capabilities.canManageVisits, false);
  assert.equal(result.capabilities.canManageReports, false);
});

test('mats initial non-null or zero cost requires cost.edit before any transaction', async () => {
  let transactions = 0;
  const service = new RubberMatAggregateService({ $transaction: async () => { transactions += 1; throw new Error('A denied cost must never reach writes'); } } as never);
  const reader = actor([deny('mats.cost.edit')], 'founder');
  for (const replacementCost of ['0', '100']) await assert.rejects(service.createSize(reader, { lengthCm: 80, widthCm: 120, replacementCost }), ForbiddenException);
  assert.equal(transactions, 0);
});

test('mat catalog top-level cost capability is independent from size creation capability', async () => {
  const tx = { $queryRaw: async (strings: TemplateStringsArray) => strings.join('').includes('RubberMatAggregateMigration')
    ? [{ id: 'fixture-ready-marker' }]
    : [{ id: 'size', lengthCm: new Prisma.Decimal(80), widthCm: new Prisma.Decimal(120), replacementCost: new Prisma.Decimal(100), version: 1 }] };
  const service = new RubberMatAggregateService({ $transaction: async <T>(handler: (client: typeof tx) => Promise<T>) => handler(tx) } as never);
  const reader = actor([deny('mats.cost.edit')], 'founder');
  const result = await service.catalog(reader);
  assert.equal(result.canManage, true);
  assert.equal(result.canEditCost, false);
  assert.equal(result.items[0].replacementCost, '100.00', 'Denying cost editing does not invent a zero read value');
});

for (const actionCode of ['objects.rates.read', 'objects.budget.read']) {
  test(`direct financial service mutation respects ${actionCode} inside transaction before effects`, async () => {
    const touched: string[] = [];
    const prohibited = async () => { touched.push('financial-repository'); throw new Error('Denied payload reached financial repository'); };
    const tx = {
      $queryRaw: async () => [{ id: 'object' }],
      object: { findFirst: async () => ({ id: 'object', status: 'active', deletedAt: null, createdByUserId: 'reader', assignments: [] }) },
      objectCompensationAdjustment: { findUnique: prohibited, findFirst: prohibited, create: prohibited, update: prohibited },
      objectPayrollCredit: { findUnique: prohibited, create: prohibited, update: prohibited, upsert: prohibited },
      auditEvent: { create: prohibited }, objectAuditLog: { create: prohibited },
    };
    const service = new ObjectCompensationService({ $transaction: async <T>(handler: (client: typeof tx) => Promise<T>) => handler(tx) } as never);
    const reader = actor([deny(actionCode)], 'founder');
    await assert.rejects(service.adjustment(reader, 'object', {
      requestKey: 'fixture-request', kind: 'extra_work', operationDate: '2026-11-01', reason: 'Denied read mutation', amount: 100,
    }, async () => { touched.push('after-apply'); }), ForbiddenException);
    await assert.rejects(service.correctExtraWork(reader, 'object', 'existing-adjustment', {
      requestKey: 'fixture-correction', expectedCreditUpdatedAt: '2026-11-01T00:00:00.000Z', reason: 'Denied read correction', amount: 0,
    }), ForbiddenException);
    assert.deepEqual(touched, [], 'Read denial must be enforced in the actual service, not only a DTO button');
  });
}
