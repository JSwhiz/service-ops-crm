import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// The requested seven-action module is mats (rubber carpets), not the two
// objects.materials leaves, consumable inventory, or specification_catalog.
interface SizeDto { id: string; lengthCm: number; widthCm: number; replacementCost: string | null; version: number; createdAt: string; updatedAt: string }
interface CatalogDto { items: SizeDto[]; canManage: boolean; canEditCost: boolean; canReadHistory: boolean }
interface AggregateDto {
  canManage: boolean;
  canReadHistory: boolean;
  items: Array<SizeDto & { quantity: number; quantityVersion: number }>;
  totalReplacementCost: string | null; knownReplacementCost: string;
}

test('all seven mats actions enforce actual HTTP aggregate/catalog grants without reopening legacy unit accounting', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definitions = ACCESS_ACTION_CATALOG.filter(({ module }) => module === 'mats');
  assert.deepEqual(definitions.map(({ code }) => code).sort(), [
    'mats.access', 'mats.read', 'mats.catalog.read', 'mats.catalog.create', 'mats.cost.edit', 'mats.quantity.edit', 'mats.history',
  ].sort());
  const globalCodes = ['mats.catalog.read', 'mats.catalog.create', 'mats.cost.edit'];
  for (const definition of definitions) {
    assert.equal(definition.manageable, true);
    assert.deepEqual(definition.allowedScopes, globalCodes.includes(definition.code) ? ['all'] : ['own', 'assigned', 'selected', 'all']);
  }
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
  assert.ok(await prisma.rubberMatAggregateMigration.findUnique({ where: { id: 'legacy-v1' } }),
    'Use the real migrated aggregate schema; never replay conversion, delete tables or invent a ready marker');
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { include: {
    roles: { orderBy: { id: 'asc' }, include: { role: true } }, permissions: { orderBy: { id: 'asc' } },
  } } as const;
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, ...actorQuery });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, ...actorQuery });
  assert.deepEqual(manager.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [manager.id, founder.id] }, actionCode: { startsWith: 'mats.' } } }), 0);
  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const marker = `mats-grants-${randomUUID()}`;
  const request = (path: string, method = 'GET', body?: unknown, cookie = managerCookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    assert.equal(response.status, expected, await response.clone().text());
    return await response.json() as T;
  };
  type Scope = 'own' | 'assigned' | 'selected' | 'all';
  const rule = async (code: string, effect: 'allow' | 'deny', scope: Scope = 'all', selectedIds: string[] = [], userId = manager.id) => {
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === code)?.allowedScopes.includes(scope));
    const saved = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode: code } },
      create: { userId, actionCode: code, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
    ruleIds.add(saved.id);
    return saved;
  };
  const revoke = async (code: string, userId = manager.id) => {
    const row = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId, actionCode: code } } });
    ruleIds.delete(row.id);
  };
  const objectFixture = (suffix: string, assigned: boolean, own = false) => prisma.object.create({ data: {
    name: `${marker}-${suffix}`, address: 'Isolated carpet fixture', status: 'active', createdByUserId: own ? manager.id : founder.id,
    ...(assigned ? { assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } });
  const [a, b, foreignA, foreignB, own] = await Promise.all([
    objectFixture('assigned-A', true), objectFixture('assigned-B', true),
    objectFixture('foreign-A', false), objectFixture('foreign-B', false), objectFixture('owned', false, true),
  ]);
  const objects = [a, b, foreignA, foreignB, own];
  const objectIds = objects.map(({ id }) => id);
  const aggregatePath = (id: string) => `/objects/${id}/rubber-mats/aggregate`;
  const aggregate = (id: string) => request(aggregatePath(id)).then((response) => json<AggregateDto>(response));
  const catalog = () => request('/rubber-mats/catalog').then((response) => json<CatalogDto>(response));
  let dimension = 100_000 + Number.parseInt(randomUUID().slice(0, 6), 16);
  const sizeInput = (replacementCost?: string | null) => ({ lengthCm: ++dimension, widthCm: 80,
    ...(replacementCost === undefined ? {} : { replacementCost }) });
  const size = await json<SizeDto>(await request('/rubber-mats/catalog', 'POST', sizeInput('10.25'), founderCookie), 201);
  for (const object of objects) {
    await prisma.objectRubberMatQuantity.create({ data: { objectId: object.id, sizeId: size.id, quantity: 2 } });
    await prisma.objectRubberMatQuantityChange.create({ data: {
      objectId: object.id, sizeId: size.id, version: 1, beforeQuantity: 0, afterQuantity: 2,
      replacementCostSnapshot: '10.25', actorUserId: founder.id, source: 'user',
    } });
  }
  const legacy = await prisma.rubberMat.create({ data: {
    objectId: a.id, lengthCm: 120, widthCm: 80, condition: 'good', zone: marker, createdByUserId: founder.id,
  } });
  await prisma.rubberMatEvent.create({ data: {
    rubberMatId: legacy.id, action: 'assigned', toObjectId: a.id, note: marker, actorUserId: founder.id,
  } });
  const capture = async () => ({
    sizes: await prisma.rubberMatSize.findMany({ orderBy: { id: 'asc' } }),
    costs: await prisma.rubberMatSizeChange.findMany({ orderBy: { id: 'asc' } }),
    quantities: await prisma.objectRubberMatQuantity.findMany({ orderBy: [{ objectId: 'asc' }, { sizeId: 'asc' }] }),
    quantityHistory: await prisma.objectRubberMatQuantityChange.findMany({ orderBy: { id: 'asc' } }),
    legacy: await prisma.rubberMat.findMany({ orderBy: { id: 'asc' } }),
    legacyHistory: await prisma.rubberMatEvent.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectLogs: await prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
  });
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403, cookie = managerCookie) => {
    const before = await capture();
    const response = await request(path, method, body, cookie);
    assert.equal(response.status, expected, await response.text());
    assert.deepEqual(await capture(), before, 'Rejected request must not alter aggregate/legacy rows, versions, snapshots, audit or inventory');
  };
  const listing = async (ids: string[]) => {
    const result = await json<{ items: Array<{ object: { id: string }; quantity: number }>; total: number }>(
      await request(`/rubber-mats/aggregate?${new URLSearchParams({ q: marker, limit: '100' })}`));
    assert.equal(result.total, ids.length);
    assert.deepEqual(result.items.map(({ object }) => object.id).sort(), [...ids].sort());
  };
  const setQuantity = async (objectId: string, quantity: number) => {
    const before = await capture();
    const previous = before.quantities.find((row) => row.objectId === objectId && row.sizeId === size.id)!;
    const price = before.sizes.find(({ id }) => id === size.id)!.replacementCost;
    const result = await json<{ quantity: number; version: number }>(await request(`${aggregatePath(objectId)}/${size.id}`, 'PUT', { version: previous.version, quantity }));
    assert.deepEqual(result, { quantity, version: previous.version + 1 });
    const after = await capture();
    const changed = after.quantities.find((row) => row.objectId === objectId && row.sizeId === size.id)!;
    assert.deepEqual(changed, { ...previous, quantity, version: result.version, updatedAt: changed.updatedAt });
    assert.deepEqual(after.quantities.filter((row) => row !== changed), before.quantities.filter((row) => row.objectId !== objectId || row.sizeId !== size.id));
    const added = after.quantityHistory.filter((row) => !before.quantityHistory.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.deepEqual({ objectId: added[0]!.objectId, sizeId: added[0]!.sizeId, version: added[0]!.version,
      beforeQuantity: added[0]!.beforeQuantity, afterQuantity: added[0]!.afterQuantity, actorUserId: added[0]!.actorUserId,
      replacementCostSnapshot: added[0]!.replacementCostSnapshot?.toFixed(2), source: added[0]!.source },
    { objectId, sizeId: size.id, version: result.version, beforeQuantity: previous.quantity, afterQuantity: quantity,
      actorUserId: manager.id, replacementCostSnapshot: price?.toFixed(2), source: 'user' });
    for (const key of ['sizes', 'costs', 'legacy', 'legacyHistory', 'objects', 'assignments', 'audit', 'objectLogs', 'inventory'] as const) assert.deepEqual(after[key], before[key]);
  };

  for (const code of ['mats.access', 'mats.read']) await t.test(`${code}: selected/all allow, deny and live revoke retain unrelated object B`, async (suite) => {
    suite.after(reset);
    const before = await capture();
    await listing([a.id, b.id, own.id]);
    await rule(code, 'allow', 'selected', [foreignA.id]);
    await listing([a.id, b.id, own.id, ...(code === 'mats.read' ? [foreignA.id] : [])]);
    if (code === 'mats.read') assert.equal((await aggregate(foreignA.id)).canManage, false);
    else await rejected(aggregatePath(foreignA.id)); // Root allow never manufactures leaf read.
    await rejected(aggregatePath(foreignB.id));
    await rule(code, 'allow');
    await listing(code === 'mats.read' ? objectIds : [a.id, b.id, own.id]);
    await rule(code, 'deny', 'selected', [a.id]);
    await listing([b.id, own.id]);
    await rejected(aggregatePath(a.id));
    await rejected(`${aggregatePath(a.id)}/history`);
    await rejected(`${aggregatePath(a.id)}/${size.id}`, 'PUT', { version: 1, quantity: 9 });
    assert.equal((await aggregate(b.id)).canManage, true);
    await catalog(); // A selected object denial is not a global catalog denial.
    await rule(code, 'deny');
    await listing([]);
    await rejected(aggregatePath(b.id));
    if (code === 'mats.access') await rejected('/rubber-mats/catalog');
    else await catalog(); // Object read and global catalog read are separate leaves.
    await revoke(code);
    await listing([a.id, b.id, own.id]);
    await aggregate(a.id);
    assert.deepEqual(await capture(), before);
  });

  await t.test('mats.read own/assigned scope subtracts only the matching baseline and revoke restores it', async (suite) => {
    suite.after(reset);
    const before = await capture();
    for (const scope of ['own', 'assigned'] as const) {
      await rule('mats.read', 'allow', scope);
      await listing([a.id, b.id, own.id]); // Additive default, not a restricted-role fixture.
      await rule('mats.read', 'deny', scope);
      await listing(scope === 'own' ? [a.id, b.id] : [own.id]);
      await rejected(aggregatePath(scope === 'own' ? own.id : a.id));
      await revoke('mats.read');
      await listing([a.id, b.id, own.id]);
    }
    assert.deepEqual(await capture(), before);
  });

  await t.test('mats.catalog.read global deny gates catalog and cost history, not readable object quantities', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('mats.catalog.read', 'allow');
    const readable = await catalog();
    assert.ok(readable.items.some(({ id }) => id === size.id));
    assert.equal(readable.canReadHistory, true);
    await json(await request(`/rubber-mats/catalog/${size.id}/history`));
    await rule('mats.catalog.read', 'deny');
    await rejected('/rubber-mats/catalog');
    await rejected(`/rubber-mats/catalog/${size.id}/history`);
    assert.ok((await aggregate(a.id)).items.some(({ id }) => id === size.id));
    assert.equal((await aggregate(a.id)).canReadHistory, true, 'Object quantity history does not require global catalog read');
    await revoke('mats.catalog.read');
    await catalog();
    assert.deepEqual(await capture(), before);
  });

  await t.test('mats.catalog.create grants only size creation; initial non-null/zero cost independently requires cost.edit', async (suite) => {
    suite.after(reset);
    await rejected('/rubber-mats/catalog', 'POST', sizeInput());
    await rule('mats.catalog.create', 'allow');
    assert.equal((await catalog()).canManage, true);
    assert.equal((await catalog()).canEditCost, false);
    const before = await capture();
    const payload = sizeInput();
    const created = await json<SizeDto>(await request('/rubber-mats/catalog', 'POST', payload), 201);
    for (const timestamp of [created.createdAt, created.updatedAt]) {
      assert.equal(typeof timestamp, 'string');
      assert.equal(new Date(timestamp).toISOString(), timestamp, 'DTO timestamps must be valid canonical ISO dates');
    }
    assert.deepEqual(created, {
      ...payload, id: created.id, replacementCost: null, version: 1,
      createdAt: created.createdAt, updatedAt: created.updatedAt,
    });
    const after = await capture();
    const persisted = after.sizes.find(({ id }) => id === created.id)!;
    assert.ok(persisted);
    assert.equal(created.createdAt, persisted.createdAt.toISOString());
    assert.equal(created.updatedAt, persisted.updatedAt.toISOString());
    assert.equal(after.sizes.length, before.sizes.length + 1);
    assert.deepEqual(after.sizes.filter(({ id }) => id !== created.id), before.sizes);
    const events = after.costs.filter((row) => !before.costs.some(({ id }) => id === row.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.sizeId, created.id);
    assert.equal(events[0]!.actorUserId, manager.id);
    assert.equal(events[0]!.version, 1);
    assert.equal(events[0]!.afterCost, null);
    for (const key of ['quantities', 'quantityHistory', 'legacy', 'legacyHistory', 'objects', 'assignments', 'audit', 'objectLogs', 'inventory'] as const) assert.deepEqual(after[key], before[key]);
    for (const price of ['0', '12.30']) await rejected('/rubber-mats/catalog', 'POST', sizeInput(price));
    await rule('mats.cost.edit', 'allow');
    const zero = await json<SizeDto>(await request('/rubber-mats/catalog', 'POST', sizeInput('0')), 201);
    assert.equal(zero.replacementCost, '0.00');
    await rule('mats.catalog.create', 'deny');
    assert.equal((await catalog()).canManage, false);
    assert.equal((await catalog()).canEditCost, true);
    await rejected('/rubber-mats/catalog', 'POST', sizeInput());
    await revoke('mats.catalog.create');
    await rejected('/rubber-mats/catalog', 'POST', sizeInput());
  });

  await t.test('mats.cost.edit is independent of creation; exact cost revision never rewrites quantity snapshots', async (suite) => {
    suite.after(reset);
    const current = await prisma.rubberMatSize.findUniqueOrThrow({ where: { id: size.id } });
    const body = { version: current.version, replacementCost: '20.50' };
    await rejected(`/rubber-mats/catalog/${size.id}`, 'PATCH', body);
    await rule('mats.cost.edit', 'allow');
    const capabilities = await catalog();
    assert.equal(capabilities.canManage, false);
    assert.equal(capabilities.canEditCost, true);
    await rejected('/rubber-mats/catalog', 'POST', sizeInput());
    const before = await capture();
    const updated = await json<SizeDto>(await request(`/rubber-mats/catalog/${size.id}`, 'PATCH', body));
    assert.equal(updated.replacementCost, '20.50');
    assert.equal(updated.version, current.version + 1);
    const after = await capture();
    const events = after.costs.filter((row) => !before.costs.some(({ id }) => id === row.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.sizeId, size.id);
    assert.equal(events[0]!.actorUserId, manager.id);
    assert.equal(events[0]!.beforeCost?.toFixed(2), '10.25');
    assert.equal(events[0]!.afterCost?.toFixed(2), '20.50');
    assert.equal(events[0]!.version, updated.version);
    assert.deepEqual(after.sizes.filter(({ id }) => id !== size.id), before.sizes.filter(({ id }) => id !== size.id));
    for (const key of ['quantities', 'quantityHistory', 'legacy', 'legacyHistory', 'objects', 'assignments', 'audit', 'objectLogs', 'inventory'] as const) assert.deepEqual(after[key], before[key]);
    await rejected(`/rubber-mats/catalog/${size.id}`, 'PATCH', body, 409);
    await rule('mats.cost.edit', 'deny');
    assert.equal((await catalog()).canEditCost, false);
    await rejected(`/rubber-mats/catalog/${size.id}`, 'PATCH', { version: updated.version, replacementCost: null });
    await revoke('mats.cost.edit');
    await rejected(`/rubber-mats/catalog/${size.id}`, 'PATCH', { version: updated.version, replacementCost: '30' });
    await rule('mats.cost.edit', 'deny', 'all', [], founder.id);
    await rejected(`/rubber-mats/catalog/${size.id}`, 'PATCH', { version: updated.version, replacementCost: '30' }, 403, founderCookie);
  });

  await t.test('mats.quantity.edit selected/all grant A/control B, deny and revoke honor independent read and store exact history', async (suite) => {
    suite.after(reset);
    await rule('mats.read', 'allow', 'selected', [foreignA.id, foreignB.id]);
    assert.equal((await aggregate(foreignA.id)).canManage, false);
    await rejected(`${aggregatePath(foreignA.id)}/${size.id}`, 'PUT', { version: 1, quantity: 4 });
    await rule('mats.quantity.edit', 'allow', 'selected', [foreignA.id]);
    assert.equal((await aggregate(foreignA.id)).canManage, true);
    assert.equal((await aggregate(foreignB.id)).canManage, false);
    await setQuantity(foreignA.id, 4);
    await rejected(`${aggregatePath(foreignB.id)}/${size.id}`, 'PUT', { version: 1, quantity: 4 });
    await revoke('mats.quantity.edit');
    assert.equal((await aggregate(foreignA.id)).canManage, false);
    await rejected(`${aggregatePath(foreignA.id)}/${size.id}`, 'PUT', { version: 2, quantity: 5 });
    await rule('mats.quantity.edit', 'allow');
    await setQuantity(foreignB.id, 3);
    await rule('mats.quantity.edit', 'deny', 'selected', [a.id]);
    assert.equal((await aggregate(a.id)).canManage, false);
    assert.equal((await aggregate(b.id)).canManage, true);
    await rejected(`${aggregatePath(a.id)}/${size.id}`, 'PUT', { version: 1, quantity: 8 });
    await rule('mats.quantity.edit', 'deny');
    await rejected(`${aggregatePath(b.id)}/${size.id}`, 'PUT', { version: 1, quantity: 8 });
    await revoke('mats.quantity.edit');
    assert.equal((await aggregate(b.id)).canManage, true);
    await rule('mats.quantity.edit', 'allow', 'own');
    await setQuantity(own.id, 5);
    await revoke('mats.quantity.edit');
    assert.equal((await aggregate(own.id)).canManage, false);
  });

  await t.test('mats.history selected/all grant does not grant read or writes; denial covers actual object/cost histories', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('mats.history', 'allow', 'selected', [foreignA.id]);
    await rejected(`${aggregatePath(foreignA.id)}/history`); // Missing read prerequisite.
    await rule('mats.read', 'allow', 'selected', [foreignA.id, foreignB.id]);
    assert.equal((await aggregate(foreignA.id)).canReadHistory, true);
    assert.equal((await aggregate(foreignB.id)).canReadHistory, false, 'Read alone does not authorize foreign quantity history');
    const history = await json<Array<{ objectId: string; actorUserId: string; afterQuantity: number }>>(await request(`${aggregatePath(foreignA.id)}/history`));
    assert.ok(history.some((row) => row.objectId === foreignA.id && row.actorUserId === manager.id && row.afterQuantity === 4));
    await rejected(`${aggregatePath(foreignB.id)}/history`);
    await revoke('mats.history');
    assert.equal((await aggregate(foreignA.id)).canReadHistory, false);
    await rejected(`${aggregatePath(foreignA.id)}/history`);
    await rule('mats.history', 'allow');
    assert.equal((await aggregate(foreignB.id)).canReadHistory, true);
    await json(await request(`${aggregatePath(foreignB.id)}/history`));
    await rule('mats.history', 'deny', 'selected', [a.id]);
    assert.equal((await aggregate(a.id)).canReadHistory, false);
    assert.equal((await aggregate(b.id)).canReadHistory, true);
    assert.equal((await catalog()).canReadHistory, true, 'Cost history uses its exact global authorization, not object A scope');
    await json(await request(`/rubber-mats/catalog/${size.id}/history`));
    await rejected(`${aggregatePath(a.id)}/history`);
    await aggregate(a.id);
    await json(await request(`${aggregatePath(b.id)}/history`));
    await rule('mats.history', 'deny');
    assert.equal((await aggregate(b.id)).canReadHistory, false);
    assert.equal((await catalog()).canReadHistory, false);
    await rejected(`${aggregatePath(b.id)}/history`);
    await rejected(`/rubber-mats/catalog/${size.id}/history`);
    await revoke('mats.history');
    assert.equal((await aggregate(b.id)).canReadHistory, true);
    assert.equal((await catalog()).canReadHistory, true);
    await json(await request(`${aggregatePath(b.id)}/history`));
    await json(await request(`/rubber-mats/catalog/${size.id}/history`));
    assert.deepEqual(await capture(), before);
  });

  await t.test('parent denies and object lifecycle still win over positive quantity grants; legacy writes remain 410', async (suite) => {
    suite.after(reset);
    await rule('mats.read', 'allow');
    await rule('mats.quantity.edit', 'allow');
    for (const code of ['objects.read', 'objects.access']) {
      await rule(code, 'deny', 'selected', [a.id]);
      await rejected(aggregatePath(a.id));
      await rejected(`${aggregatePath(a.id)}/${size.id}`, 'PUT', { version: 1, quantity: 10 });
      await aggregate(b.id);
      await revoke(code);
    }
    for (const status of ['frozen', 'archived'] as const) {
      await prisma.object.update({ where: { id: a.id }, data: { status } });
      try {
        assert.equal((await aggregate(a.id)).canManage, false);
        await rejected(`${aggregatePath(a.id)}/${size.id}`, 'PUT', { version: 1, quantity: 10 });
        if (status === 'archived') await rejected(`${aggregatePath(a.id)}/${size.id}`, 'PUT', { version: 1, quantity: 10 }, 403, founderCookie);
      } finally { await prisma.object.update({ where: { id: a.id }, data: { status: 'active' } }); }
    }
    await rejected(`/objects/${a.id}/rubber-mats/${legacy.id}`, 'PATCH', { condition: 'worn', note: 'Legacy remains closed' }, 410);
    await rejected(`/objects/${a.id}/rubber-mats/${legacy.id}/service`, 'POST', { note: 'Legacy remains closed' }, 410);
    await rejected('/rubber-mats', 'POST', { lengthCm: 80, widthCm: 120, note: 'No individual registration' }, 410, founderCookie);
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: manager.id }, ...actorQuery }), manager);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: founder.id }, ...actorQuery }), founder);
  // Main owns execution and isolated-schema cleanup. Global catalog/cost actions
  // do not have selected-size scopes. No legacy 410 operation, inventory/spec
  // catalog, browser/admin-save, migration replay or delegation proof is claimed.
});
