import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EquipmentUnitResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Bounded coverage of 11/17 catalog actions: access, read, catalog.read,
// catalog.create, catalog.delete, unit.create, unit.delete, history, broken,
// repair, repair_return. Not an acceptance claim for the other six actions.
test('equipment personal grants enforce selected units and preserve catalog/lifecycle effects', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const permissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissions.includes('equipment.unit.delete'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'equipment.' } } }), 0);
  // One seeded actor, one session; no role/permission or object/order grants.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-equipment-${randomUUID()}`;
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    category: 'Acceptance fixture', name: `${marker}-model`, createdByUserId: founder.id,
  } });
  const unit = (label: string) => prisma.equipmentUnit.create({ data: {
    catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, createdByUserId: founder.id,
  } });
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1/equipment${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const read = async (id: string) => {
    const response = await request(`/units/${id}`);
    await status(response, 200);
    return await response.json() as EquipmentUnitResponseDto;
  };
  const capture = async () => {
    // Small isolated schema only. Include seeded equipment too, so a denied
    // request cannot silently change a row outside the A/B fixtures.
    const [catalogs, units, movements, audit, approvals, attachments] = await Promise.all([
      prisma.equipmentCatalogItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
      prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['equipment_catalog_item', 'equipment_unit', 'equipment_movement'] } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
    ]);
    return { catalogs, units, movements, audit, approvals, attachments };
  };
  const rejected = async (path: string, method: string, body?: unknown, expected = 403, code?: string) => {
    const before = await capture();
    const response = await request(path, method, body);
    await status(response, expected);
    if (code) assert.equal((await response.json() as { code: string }).code, code);
    assert.deepEqual(await capture(), before, `${method} ${path}: rejected request changes neither data nor audit`);
  };
  const addedAudit = (before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>, action: string, entityId: string) => {
    const added = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
    assert.equal(added.length, 1);
    assert.equal(added[0].action, action);
    assert.equal(added[0].entityId, entityId);
    assert.equal(added[0].actorUserId, actor.id);
    assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
    return added[0];
  };
  const noOtherEffects = (before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>) => {
    for (const key of ['movements', 'approvals', 'attachments'] as const) assert.deepEqual(after[key], before[key]);
  };

  await t.test('global catalog read/create, unit create and catalog delete remain independent grants', async (suite) => {
    suite.after(resetRules);
    const initial = await capture();
    await status(await request('/catalog'), 200); // Manager's existing read baseline.
    const readDeny = await rule('equipment.catalog.read', 'deny');
    await rejected('/catalog', 'GET');
    await removeRule(readDeny.id);
    await status(await request('/catalog'), 200);
    const readAllow = await rule('equipment.catalog.read', 'allow');
    await status(await request('/catalog'), 200);
    await removeRule(readAllow.id);
    assert.deepEqual(await capture(), initial, 'Catalog reads and grants create no business records');

    const catalogBody = { category: 'Acceptance fixture', name: `${marker}-created`, brand: 'Fixture', notes: marker };
    const unitBody = { catalogItemId: catalog.id, inventoryNumber: `${marker}-created-unit`, serialNumber: marker };
    const empty = await prisma.equipmentCatalogItem.create({ data: {
      category: 'Acceptance fixture', name: `${marker}-empty`, createdByUserId: founder.id,
    } });
    const operations = [
      { code: 'equipment.catalog.create', path: '/catalog', method: 'POST', body: catalogBody },
      { code: 'equipment.unit.create', path: '/units', method: 'POST', body: unitBody },
      { code: 'equipment.catalog.delete', path: `/catalog/${empty.id}`, method: 'DELETE', body: undefined },
    ] as const;
    for (const operation of operations) {
      await rejected(operation.path, operation.method, operation.body);
      // Catalog read/create/delete and unit.create have scope=all in the catalog.
      let allow = await rule(operation.code, 'allow');
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      await rejected(operation.path, operation.method, operation.body);
      await removeRule(allow.id); // default/revoke, no new login
      await rejected(operation.path, operation.method, operation.body);
      allow = await rule(operation.code, 'allow');
      const parent = await rule('equipment.access', 'deny');
      await rejected(operation.path, operation.method, operation.body);
      await removeRule(parent.id);
      if (operation.code === 'equipment.catalog.delete') await rejected(`/catalog/${catalog.id}`, 'DELETE', undefined, 409, 'EQUIPMENT_CATALOG_DELETE_BLOCKED');
      const before = await capture();
      const response = await request(operation.path, operation.method, operation.body);
      await status(response, operation.method === 'POST' ? 201 : 200);
      const result = await response.json() as { id: string };
      const after = await capture();
      noOtherEffects(before, after);
      if (operation.code === 'equipment.catalog.create') {
        const saved = await prisma.equipmentCatalogItem.findUniqueOrThrow({ where: { id: result.id } });
        assert.equal(saved.name, catalogBody.name);
        assert.equal(saved.createdByUserId, actor.id);
        assert.equal(saved.brand, catalogBody.brand);
        assert.deepEqual(after.catalogs.filter(({ id }) => id !== saved.id), before.catalogs);
        assert.deepEqual(after.units, before.units);
        addedAudit(before, after, 'equipment.catalog_item.created', saved.id);
        await rejected('/units', 'POST', unitBody);
        await rejected(`/catalog/${empty.id}`, 'DELETE');
      } else if (operation.code === 'equipment.unit.create') {
        const saved = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: result.id } });
        assert.equal(saved.catalogItemId, catalog.id);
        assert.equal(saved.inventoryNumber, unitBody.inventoryNumber);
        assert.equal(saved.createdByUserId, actor.id);
        assert.equal(saved.status, 'in_storage');
        assert.equal(saved.currentObjectId, null);
        assert.equal(saved.currentOneTimeOrderId, null);
        assert.deepEqual(after.units.filter(({ id }) => id !== saved.id), before.units);
        assert.deepEqual(after.catalogs, before.catalogs);
        addedAudit(before, after, 'equipment.unit.created', saved.id);
        assert.equal((await read(saved.id)).capabilities.canDelete, false);
        await rejected(`/units/${saved.id}`, 'DELETE');
        await rejected('/catalog', 'POST', { ...catalogBody, name: `${marker}-unrelated-create` });
      } else {
        assert.deepEqual(result, { id: empty.id });
        assert.equal(await prisma.equipmentCatalogItem.findUnique({ where: { id: empty.id } }), null);
        assert.deepEqual(after.catalogs, before.catalogs.filter(({ id }) => id !== empty.id));
        assert.deepEqual(after.units, before.units);
        addedAudit(before, after, 'equipment.catalog_item.deleted_permanently', empty.id);
      }
      await removeRule(allow.id);
      // Existing targets for revoke checks; do not confuse missing/deleted IDs
      // or duplicate inventory numbers with an authorization failure.
      await rejected(operation.code === 'equipment.catalog.delete' ? `/catalog/${catalog.id}` : operation.path,
        operation.method, operation.code === 'equipment.unit.create' ? { ...unitBody, inventoryNumber: `${marker}-revoked-unit` }
          : operation.code === 'equipment.catalog.create' ? { ...catalogBody, name: `${marker}-revoked-model` } : undefined);
    }
  });

  await t.test('selected unit delete respects control B, live revoke, section deny and movement-history blockers', async (suite) => {
    suite.after(resetRules);
    const a = await unit('delete-A');
    const b = await unit('delete-B');
    const used = await unit('delete-used-A');
    await prisma.equipmentMovement.create({ data: {
      equipmentUnitId: used.id, movementType: 'return_from_repair', fromStatus: 'under_repair', toStatus: 'in_storage', createdByUserId: founder.id,
    } });
    const path = (id: string) => `/units/${id}`;
    for (const person of [a, b]) {
      assert.equal((await read(person.id)).capabilities.canDelete, false);
      await rejected(path(person.id), 'DELETE');
    }
    let allow = await rule('equipment.unit.delete', 'allow', [a.id, used.id]);
    assert.equal((await read(a.id)).deletionState.canDelete, true);
    assert.equal((await read(b.id)).capabilities.canDelete, false);
    await rejected(path(b.id), 'DELETE');
    const blocked = await read(used.id);
    assert.equal(blocked.capabilities.canDelete, true);
    assert.equal(blocked.deletionState.canDelete, false);
    assert.deepEqual(blocked.deletionState.blockerCodes, ['movement_history']);
    await rejected(path(used.id), 'DELETE', undefined, 409, 'EQUIPMENT_UNIT_DELETE_BLOCKED');
    await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
    assert.equal((await read(a.id)).capabilities.canDelete, false);
    await rejected(path(a.id), 'DELETE');
    await removeRule(allow.id);
    await rejected(path(a.id), 'DELETE');
    allow = await rule('equipment.unit.delete', 'allow', [a.id]);
    const parent = await rule('equipment.access', 'deny', [a.id]);
    await rejected(path(a.id), 'DELETE');
    await rejected(path(a.id), 'GET');
    await read(b.id);
    await removeRule(parent.id);
    const globalParent = await rule('equipment.access', 'deny');
    await rejected(path(a.id), 'DELETE');
    await rejected(path(randomUUID()), 'DELETE'); // Global deny precedes even a missing-unit lookup.
    await removeRule(globalParent.id);
    const before = await capture();
    const response = await request(path(a.id), 'DELETE');
    await status(response, 200);
    assert.deepEqual(await response.json(), { id: a.id, mode: 'hard' });
    const after = await capture();
    assert.deepEqual(after.units, before.units.filter(({ id }) => id !== a.id));
    assert.deepEqual(after.catalogs, before.catalogs);
    noOtherEffects(before, after);
    assert.equal((addedAudit(before, after, 'equipment.unit.deleted_permanently', a.id).oldValues as { inventoryNumber: string }).inventoryNumber, a.inventoryNumber);
    await removeRule(allow.id);
    await rejected(path(a.id), 'DELETE'); // Revoked successful-request replay.
  });

  await t.test('selected break/repair/repair-return grants change only A and create exactly one movement plus audit each', async (suite) => {
    suite.after(resetRules);
    const a = await unit('cycle-A');
    const b = await unit('cycle-B');
    const baseline = await capture();
    const steps = [
      { code: 'equipment.broken', movementType: 'mark_broken', from: 'in_storage', to: 'broken', capability: 'canMarkBroken' },
      { code: 'equipment.repair', movementType: 'send_to_repair', from: 'broken', to: 'under_repair', capability: 'canSendToRepair' },
      { code: 'equipment.repair_return', movementType: 'return_from_repair', from: 'under_repair', to: 'in_storage', capability: 'canReturnFromRepair' },
    ] as const;
    for (const step of steps) {
      const body = { movementType: step.movementType, comment: `${marker}-${step.code}` };
      const path = (id: string) => `/units/${id}/movements`;
      assert.equal((await read(a.id)).capabilities[step.capability], false);
      await rejected(path(a.id), 'POST', body);
      let allow = await rule(step.code, 'allow', [a.id]);
      const view = await read(a.id);
      assert.equal(view.capabilities[step.capability], true);
      assert.equal(view.capabilities.canCreateMovement, true);
      for (const key of ['canAssignToObject', 'canAssignToOneTimeOrder', 'canReturn', 'canMove', 'canDelete', 'canWriteoff'] as const)
        assert.equal(view.capabilities[key], false, `${step.code} must not grant ${key}`);
      assert.equal((await read(b.id)).capabilities[step.capability], false);
      await rejected(path(b.id), 'POST', body);
      await rejected(path(a.id), 'POST', { movementType: 'mark_lost', comment: marker });
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      assert.equal((await read(a.id)).capabilities[step.capability], false);
      await rejected(path(a.id), 'POST', body);
      await removeRule(allow.id);
      await rejected(path(a.id), 'POST', body);
      allow = await rule(step.code, 'allow', [a.id]);
      const parent = await rule('equipment.access', 'deny', [a.id]);
      await rejected(path(a.id), 'POST', body);
      await read(b.id);
      await removeRule(parent.id);
      const before = await capture();
      const response = await request(path(a.id), 'POST', body);
      await status(response, 201);
      const result = await response.json() as { id: string; equipmentUnitId: string; approvalRequest: unknown };
      assert.equal(result.equipmentUnitId, a.id);
      assert.equal(result.approvalRequest, null);
      const after = await capture();
      const movement = await prisma.equipmentMovement.findUniqueOrThrow({ where: { id: result.id } });
      assert.equal(movement.movementType, step.movementType);
      assert.equal(movement.createdByUserId, actor.id);
      assert.equal(movement.fromStatus, step.from);
      assert.equal(movement.toStatus, step.to);
      assert.equal(movement.status, 'applied');
      assert.equal(movement.comment, body.comment);
      assert.deepEqual(after.movements.filter(({ id }) => id !== movement.id), before.movements);
      const oldUnit = before.units.find(({ id }) => id === a.id)!;
      const saved = after.units.find(({ id }) => id === a.id)!;
      assert.deepEqual(saved, { ...oldUnit, status: step.to, updatedAt: saved.updatedAt });
      assert.deepEqual(after.units.filter(({ id }) => id !== a.id), before.units.filter(({ id }) => id !== a.id));
      assert.deepEqual(after.catalogs, before.catalogs);
      assert.deepEqual(after.approvals, before.approvals);
      assert.deepEqual(after.attachments, before.attachments);
      addedAudit(before, after, `equipment.${step.movementType}`, movement.id);
      await removeRule(allow.id);
      assert.equal((await read(a.id)).capabilities[step.capability], false);
      await rejected(path(a.id), 'POST', body); // Same cookie after success.
    }
    // Read/history denies subtract only A from manager's existing read baseline.
    const historyBefore = await capture();
    const historyResponse = await request(`/units/${a.id}/movements`);
    await status(historyResponse, 200);
    const rows = await historyResponse.json() as Array<{ id: string; equipmentUnitId: string }>;
    assert.equal(rows.length, 3);
    assert.ok(rows.every(({ equipmentUnitId }) => equipmentUnitId === a.id));
    for (const code of ['equipment.history', 'equipment.read']) {
      const deny = await rule(code, 'deny', [a.id]);
      await rejected(`/units/${a.id}/movements`, 'GET');
      await status(await request(`/units/${b.id}/movements`), 200);
      if (code === 'equipment.history') assert.equal((await read(a.id)).capabilities.canViewHistory, false);
      else {
        await rejected(`/units/${a.id}`, 'GET');
        const list = await request(`/units?search=${encodeURIComponent(`${marker}-cycle-`)}`);
        await status(list, 200);
        assert.deepEqual((await list.json() as Array<{ id: string }>).map(({ id }) => id), [b.id]);
      }
      await removeRule(deny.id);
      assert.equal((await read(a.id)).capabilities.canViewHistory, true);
      await status(await request(`/units/${a.id}/movements`), 200);
    }
    assert.deepEqual(await capture(), historyBefore, 'History and registry reads create no data or audit');
    const final = await capture();
    assert.deepEqual(final.units.find(({ id }) => id === b.id), baseline.units.find(({ id }) => id === b.id));
    assert.equal(final.movements.filter(({ equipmentUnitId }) => equipmentUnitId === b.id).length, 0);
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No role or legacy permission changes');
  // Main's sequential runner owns and drops integration_PID_index and fixtures.
});
