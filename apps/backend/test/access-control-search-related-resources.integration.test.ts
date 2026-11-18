import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { CounterpartyCardResponseDto } from '../src/modules/counterparties/dto/counterparty-response.dto';
import type { GlobalSearchItemDto, GlobalSearchResponseDto } from '../src/modules/search/dto/global-search-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('search/recent equipment respects current parents and counterparty counts match visible card objects', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds = new Set<string>();
  const reset = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await reset(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { include: {
    roles: { orderBy: { id: 'asc' }, include: { role: { include: { permissions: { orderBy: { id: 'asc' } } } } } },
    permissions: { orderBy: { id: 'asc' } },
  } } as const;
  const reader = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, ...actorQuery });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(reader.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: reader.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const marker = `search-related-${randomUUID()}`;
  const equipmentQuery = `${marker}-equipment`;
  const request = (path: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response): Promise<T> => {
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as T;
  };
  const search = async (q: string) => {
    const result = await json<GlobalSearchResponseDto>(await request(`/search?${new URLSearchParams({ q, limit: '8' })}`));
    assert.equal(result.query, q);
    return result.items; // Query is public input, not evidence of a domain leak.
  };
  const recent = (refs: Array<{ type: GlobalSearchItemDto['type']; id: string }>) =>
    request('/search/recent', { refs }).then((response) => json<GlobalSearchItemDto[]>(response));
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const scope = selectedIds ? 'selected' : 'all';
    assert.ok(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)?.allowedScopes.includes(scope));
    const saved = await prisma.userAccessRule.create({ data: {
      userId: reader.id, actionCode, effect, scope, selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const remove = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const objectFixture = (label: string, assigned = true, counterpartyId?: string, deleted = false, master = false) => prisma.object.create({ data: {
    name: `Private-object-${label}-${randomUUID()}`, address: `Address-${randomUUID()}`, status: 'active',
    createdByUserId: founder.id, counterpartyId, deletedAt: deleted ? new Date() : null,
    ...(master ? { masterForCounterpartyId: counterpartyId } : {}),
    ...(assigned ? { assignments: { create: { userId: reader.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } });
  const equipmentObjects = await Promise.all(['A', 'B'].map((label) => objectFixture(`equipment-${label}`)));
  const equipmentOrders = await Promise.all(['A', 'B'].map((label) => prisma.oneTimeOrder.create({ data: {
    title: `Private-order-${label}-${randomUUID()}`, executionAddress: `Order-address-${randomUUID()}`,
    status: 'new', contactName: 'Fixture', createdByUserId: founder.id,
    assignments: { create: { userId: reader.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } })));
  const equipmentLabels = ['object-A', 'object-B', 'order-A', 'order-B', 'storage'];
  const units = await Promise.all(equipmentLabels.map(async (label, index) => {
    const catalog = await prisma.equipmentCatalogItem.create({ data: {
      name: `${equipmentQuery}-${label}`, category: 'Search fixture', createdByUserId: founder.id,
    } });
    return prisma.equipmentUnit.create({ data: {
      inventoryNumber: `${equipmentQuery}-inventory-${label}`, serialNumber: `Private-serial-${randomUUID()}`,
      catalogItemId: catalog.id, createdByUserId: founder.id,
      status: index < 2 ? 'assigned_to_object' : index < 4 ? 'assigned_to_one_time_order' : 'in_storage',
      currentObjectId: index < 2 ? equipmentObjects[index]!.id : null,
      currentOneTimeOrderId: index >= 2 && index < 4 ? equipmentOrders[index - 2]!.id : null,
    } });
  }));
  const counterparty = await prisma.counterparty.create({ data: { name: `${marker}-counterparty`, createdByUserId: founder.id } });
  const visibleA = await objectFixture('counterparty-visible-A', true, counterparty.id, false, true);
  const visibleB = await objectFixture('counterparty-visible-B', true, counterparty.id);
  const hidden = await objectFixture('counterparty-unassigned', false, counterparty.id);
  const deleted = await objectFixture('counterparty-deleted', true, counterparty.id, true);
  const objectIds = [...equipmentObjects.map(({ id }) => id), visibleA.id, visibleB.id, hidden.id, deleted.id];
  const orderIds = equipmentOrders.map(({ id }) => id);
  const unitIds = units.map(({ id }) => id);
  const capture = async () => ({
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: 'asc' } }),
    units: await prisma.equipmentUnit.findMany({ where: { id: { in: unitIds } }, orderBy: { id: 'asc' } }),
    catalog: await prisma.equipmentCatalogItem.findMany({ where: { id: { in: units.map(({ catalogItemId }) => catalogItemId) } }, orderBy: { id: 'asc' } }),
    equipmentMovements: await prisma.equipmentMovement.findMany({ where: { equipmentUnitId: { in: unitIds } }, orderBy: { id: 'asc' } }),
    inventoryMovements: await prisma.inventoryMovement.findMany({ where: { relatedObjectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    counterparty: await prisma.counterparty.findUniqueOrThrow({ where: { id: counterparty.id } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } }),
    objectLogs: await prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    events: await prisma.auditEvent.findMany({ where: { entityId: { in: [...objectIds, ...orderIds, ...unitIds, counterparty.id] } }, orderBy: { id: 'asc' } }),
  });
  const before = await capture();
  const noEffects = async () => assert.deepEqual(await capture(), before, 'Search/recent/card must not mutate sources, links, assignments, movements or audit');
  const absent = (items: GlobalSearchItemDto[], values: string[]) => {
    const wire = JSON.stringify(items);
    for (const value of values) assert.equal(wire.includes(value), false, `Forbidden domain value leaked: ${value}; ${wire}`);
  };
  const equipmentRefs: Array<{ type: GlobalSearchItemDto['type']; id: string }> = [
    ...units.map(({ id }) => ({ type: 'equipment_unit' as const, id })),
    { type: 'object', id: equipmentObjects[0]!.id },
    { type: 'one_time_order', id: equipmentOrders[0]!.id },
  ];
  const checkEquipment = async (blockedIndices: number[]) => {
    const expected = units.filter((_row, index) => !blockedIndices.includes(index)).map(({ id }) => id).sort();
    for (const items of [await search(equipmentQuery), await recent(equipmentRefs)]) {
      assert.deepEqual(items.filter(({ type }) => type === 'equipment_unit').map(({ id }) => id).sort(), expected,
        'Positive controls and storage remain visible, not merely an empty result');
      for (const [index, unit] of units.entries()) {
        if (blockedIndices.includes(index)) continue;
        const item = items.find(({ type, id }) => type === 'equipment_unit' && id === unit.id)!;
        assert.equal(item.label, `${equipmentQuery}-${equipmentLabels[index]}`);
        assert.equal(item.href, `/equipment/${unit.id}`);
        assert.ok(item.description?.includes(unit.inventoryNumber));
        if (index < 4) {
          const parentName = index < 2 ? equipmentObjects[index]!.name : equipmentOrders[index - 2]!.title;
          assert.ok(item.description?.includes(parentName), 'Positive control must really resolve the current parent location');
        }
      }
      for (const index of blockedIndices) {
        const unit = units[index]!;
        const parent = index < 2 ? equipmentObjects[index]! : equipmentOrders[index - 2]!;
        absent(items, [unit.id, unit.inventoryNumber, unit.serialNumber!, `${equipmentQuery}-${equipmentLabels[index]}`,
          parent.id, 'name' in parent ? parent.name : parent.title]);
      }
      for (const index of [0, 2]) {
        const type = index === 0 ? 'object' : 'one_time_order';
        const parentId = index === 0 ? equipmentObjects[0]!.id : equipmentOrders[0]!.id;
        if (blockedIndices.includes(index)) assert.equal(items.some(({ id }) => id === parentId), false);
        else if (items.some(({ type: itemType }) => itemType !== 'equipment_unit')) assert.ok(items.some(({ id, type: itemType }) => id === parentId && itemType === type));
      }
    }
    await noEffects();
  };

  for (const [module, start] of [['objects', 0], ['one_time_orders', 2]] as const) {
    for (const suffix of ['read', 'access']) await t.test(`equipment ${module}.${suffix} selected/all deny wins in normal query and recent with the old cookie`, async (suite) => {
      suite.after(reset);
      await rule('equipment.read', 'allow'); // A positive leaf cannot bypass a negative parent.
      await checkEquipment([]);
      const selectedId = start === 0 ? equipmentObjects[0]!.id : equipmentOrders[0]!.id;
      const deny = await rule(`${module}.${suffix}`, 'deny', [selectedId]);
      await checkEquipment([start]);
      await prisma.userAccessRule.update({ where: { id: deny.id }, data: { scope: 'all', selectedIds: [] } });
      await checkEquipment([start, start + 1]);
      await remove(deny.id);
      await checkEquipment([]); // Live revoke restores the same records, not recreated fixtures.
    });
  }

  const checkCounterparty = async (expectedIds: string[]) => {
    const card = await json<CounterpartyCardResponseDto>(await request(`/counterparties/${counterparty.id}`));
    assert.deepEqual(card.objects.map(({ id }) => id).sort(), [...expectedIds].sort());
    assert.equal(card.objectCount, expectedIds.length);
    assert.equal(card.visibleObjectCount, expectedIds.length);
    assert.equal(card.masterObject?.id ?? null, expectedIds.includes(visibleA.id) ? visibleA.id : null);
    const description = expectedIds.length === 1 ? '1 объект' : expectedIds.length === 2 ? '2 объекта' : '0 объектов';
    for (const items of [await search(counterparty.name), await recent([{ type: 'counterparty', id: counterparty.id }])]) {
      assert.deepEqual(items.map(({ id, type }) => ({ id, type })), [{ id: counterparty.id, type: 'counterparty' }]);
      assert.equal(items[0]!.label, counterparty.name);
      assert.equal(items[0]!.description, description, 'Search count must equal card visible count, never raw linked-row count');
      assert.equal(items[0]!.href, `/counterparties/${counterparty.id}`);
      absent(items, [hidden.id, hidden.name, deleted.id, deleted.name]);
    }
    for (const object of [hidden, deleted, ...[visibleA, visibleB].filter(({ id }) => !expectedIds.includes(id))]) {
      const matches = await search(object.name);
      assert.equal(matches.some(({ id }) => id === counterparty.id), false, 'Hidden object names cannot make their visible counterparty a search hit');
      absent(matches, [object.id, object.name]);
    }
    await noEffects();
  };
  await t.test('counterparty normal/recent counts exclude nonassigned and deleted rows before any explicit deny', async () => {
    assert.equal(await prisma.object.count({ where: { counterpartyId: counterparty.id } }), 4);
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: hidden.id, userId: reader.id, isActive: true } }), 0);
    await checkCounterparty([visibleA.id, visibleB.id]);
    for (const object of [hidden, deleted]) {
      const response = await request(`/objects/${object.id}`);
      assert.ok([403, 404].includes(response.status), await response.text());
    }
    await noEffects();
  });
  for (const actionCode of ['objects.read', 'objects.access']) await t.test(`counterparty counts follow ${actionCode} selected deny 2 -> 1 -> 0 -> restored`, async (suite) => {
    suite.after(reset);
    await checkCounterparty([visibleA.id, visibleB.id]);
    const deny = await rule(actionCode, 'deny', [visibleA.id]);
    await checkCounterparty([visibleB.id]);
    await prisma.userAccessRule.update({ where: { id: deny.id }, data: { selectedIds: [visibleA.id, visibleB.id] } });
    await checkCounterparty([]);
    await remove(deny.id);
    await checkCounterparty([visibleA.id, visibleB.id]);
  });
  await noEffects();
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: reader.id }, ...actorQuery }), reader);
  // Main owns execution and disposable-schema cleanup. This is direct HTTP/DB
  // coverage of current relationships/counts, not browser/admin-save or historical-movement certification.
});
