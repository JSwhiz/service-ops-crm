import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { CounterpartyCardResponseDto } from '../src/modules/counterparties/dto/counterparty-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'selected' | 'all';
type MovementPage = { items: Array<{ id: string; relatedObject: { id: string } | null }>; total: number };

test('all counterparty actions enforce live selected/all rules, actual writes, audit and object boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const actions = ACCESS_ACTION_CATALOG.filter((action) => action.module === 'counterparties');
  assert.deepEqual(actions.map((action) => action.code).sort(), [
    'access', 'read', 'create', 'update', 'archive', 'restore', 'history',
    'objects.link', 'master_object.manage', 'inventory.read',
  ].map((suffix) => `counterparties.${suffix}`).sort());
  for (const action of actions) assert.deepEqual(action.allowedScopes, action.code === 'counterparties.create' ? ['all'] : ['selected', 'all']);

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
  const userIds = [founder.id, manager.id];
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: userIds } } }), 0);
  const marker = `acl-counterparty-${randomUUID()}`;
  let sequence = 0;
  const request = (path: string, method = 'GET', body?: unknown, cookie = managerCookie) => fetch(
    `${baseUrl}/api/v1${path}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    },
  );
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], userId = manager.id, module = 'counterparties') => {
    const actionCode = `${module}.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (suffix: string, userId = manager.id, module = 'counterparties') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId, actionCode: `${module}.${suffix}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: userIds },
    OR: [{ actionCode: { startsWith: 'counterparties.' } }, { actionCode: 'objects.read' }],
  } });
  const createInput = () => ({ name: `${marker}-${++sequence}`, legalName: 'Isolated legal name', notes: 'ACL fixture' });
  const a = await json<CounterpartyCardResponseDto>(await request('/counterparties', 'POST', createInput(), founderCookie), 201);
  const b = await json<CounterpartyCardResponseDto>(await request('/counterparties', 'POST', createInput(), founderCookie), 201);
  const objectFixture = (label: string, counterpartyId: string | null, visible: boolean, deleted = false) => prisma.object.create({ data: {
    id: randomUUID(), name: `${marker}-${label}`, address: 'Isolated counterparty object', status: 'active',
    createdByUserId: founder.id, counterpartyId, deletedAt: deleted ? new Date() : null,
    ...(visible ? { assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } });
  const visibleA = await objectFixture('visible-A', a.id, true);
  const hiddenA = await objectFixture('hidden-A', a.id, false);
  const visibleB = await objectFixture('visible-B', b.id, true);
  const looseA = await objectFixture('loose-A', null, true);
  const looseB = await objectFixture('loose-B', null, true);
  const deletedObject = await objectFixture('deleted', null, true, true);
  const objectIds = [visibleA.id, hiddenA.id, visibleB.id, looseA.id, looseB.id, deletedObject.id];
  for (const [counterpartyId, objectId] of [[a.id, visibleA.id], [b.id, visibleB.id]]) {
    await json(await request(`/counterparties/${counterpartyId}/master-object/${objectId}`, 'POST', undefined, founderCookie), 201);
  }
  const item = await prisma.inventoryItem.create({ data: {
    name: marker, category: 'Isolated ACL fixture', unit: 'шт.', createdByUserId: founder.id,
  } });
  const movements: Array<{ id: string; relatedObjectId: string | null }> = [];
  for (const object of [visibleA, hiddenA, visibleB]) {
    movements.push(await prisma.inventoryMovement.create({ data: {
      inventoryItemId: item.id, movementType: 'issue_to_object', status: 'applied', quantity: 1,
      unitPriceSnapshot: 10, totalAmountSnapshot: 10, relatedObjectId: object.id, createdByUserId: founder.id,
    } }));
  }
  const snapshot = async () => ({
    counterparties: await prisma.counterparty.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ where: { entityType: 'counterparty' }, orderBy: { id: 'asc' } }),
    objectEvents: await prisma.auditEvent.findMany({ where: { entityType: 'object', entityId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    objectAudits: await prisma.objectAuditLog.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { object: { name: { startsWith: marker } } }, orderBy: { id: 'asc' } }),
    item: await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id }, orderBy: { id: 'asc' } }),
  });
  const denied = async (path: string, method = 'GET', body?: unknown, status = 403, cookie = managerCookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, cookie);
    assert.equal(response.status, status, `${method} ${path}: ${await response.text()}`);
    assert.deepEqual(await snapshot(), before, 'Denied/invalid requests must preserve both sides, masters, inventory and both audit stores');
  };
  const card = (id: string, cookie = managerCookie) => request(`/counterparties/${id}`, 'GET', undefined, cookie)
    .then((response) => json<CounterpartyCardResponseDto>(response, 200));
  const noInventoryEffects = (before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) => {
    for (const key of ['item', 'movements', 'assignments'] as const) assert.deepEqual(after[key], before[key]);
  };
  const addedAudit = async (id: string, action: string, before: Awaited<ReturnType<typeof snapshot>>, actorUserId = manager.id) => {
    const added = (await snapshot()).audits.filter((event) => !before.audits.some((old) => old.id === event.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].entityId, id);
    assert.equal(added[0].action, action);
    assert.equal(added[0].actorUserId, actorUserId);
    return added[0];
  };

  await t.test('read default, additive selected/all grants, deny, revoke and filtered references do not expose hidden child objects', async () => {
    const check = async (ids: string[]) => {
      const before = await snapshot();
      const listing = await json<{ items: Array<{ id: string }>; total: number }>(
        await request(`/counterparties?q=${marker}&status=all&limit=1`), 200);
      assert.equal(listing.total, ids.length);
      assert.equal(listing.items.length, Math.min(1, ids.length));
      assert.ok(listing.items.every((entry) => ids.includes(entry.id)));
      const references = await json<Array<{ id: string }>>(await request(`/counterparties/references?q=${marker}&selectedId=${a.id}`), 200);
      assert.deepEqual(new Set(references.map((entry) => entry.id)), new Set(ids));
      for (const target of [a, b]) {
        if (!ids.includes(target.id)) await denied(`/counterparties/${target.id}`);
        else {
          const view = await card(target.id);
          const expectedObject = target.id === a.id ? visibleA.id : visibleB.id;
          assert.deepEqual(view.objects.map((object) => object.id), [expectedObject]);
          assert.equal(view.objectCount, 1);
          assert.equal(view.visibleObjectCount, 1);
          assert.equal(view.masterObject?.id, expectedObject);
        }
      }
      assert.deepEqual(await snapshot(), before);
    };
    await check([a.id, b.id]);
    await rule('read', 'allow', 'selected', [a.id]);
    await check([a.id, b.id]); // Seeded read access is additive; no role changes.
    await rule('read', 'deny', 'selected', [a.id]);
    await check([b.id]);
    await revoke('read');
    await check([a.id, b.id]);
    await rule('read', 'deny', 'all');
    await denied(`/counterparties?q=${marker}&status=all`);
    await denied(`/counterparties/references?q=${marker}`);
    await denied(`/counterparties/${a.id}`);
    await denied(`/counterparties/${b.id}`);
    await rule('read', 'allow', 'all');
    await check([a.id, b.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await check([b.id]);
    await rule('access', 'deny', 'all');
    // A global section deny must not be bypassed by aggregate read discovery.
    // Both collections and direct cards reject before any business effects.
    await denied(`/counterparties?q=${marker}&status=all&limit=1`);
    await denied(`/counterparties/references?q=${marker}&selectedId=${a.id}`);
    await denied(`/counterparties/${a.id}`);
    await denied(`/counterparties/${b.id}`);
    await reset();
    await check([a.id, b.id]);
    // The migration's CHECK constraint rejects an empty selected rule before
    // it can exist. Do not drop that invariant just to construct a fixture.
    const beforeInvalidRule = await snapshot();
    await assert.rejects(() => rule('read', 'deny', 'selected', []), /user_access_rules_selection_check/);
    assert.deepEqual(await snapshot(), beforeInvalidRule);
    await check([a.id, b.id]);
  });

  for (const leaf of ['history', 'inventory.read'] as const) {
    await t.test(`${leaf} selected/all rules gate real data without changing inventory or audit`, async () => {
      await reset();
      const paths = (id: string) => leaf === 'history'
        ? [`/counterparties/${id}/history`, `/counterparties/${id}/history-page?limit=1`]
        : [`/counterparties/${id}/inventory-movements?limit=1`];
      const readable = async (id: string) => {
        const before = await snapshot();
        for (const path of paths(id)) {
          const response = await request(path);
          if (leaf === 'history') {
            const body = await json<Array<{ id: string; action: string }> | { items: Array<{ id: string; action: string }>; total: number }>(response, 200);
            const entries = Array.isArray(body) ? body : body.items;
            assert.ok(entries.length);
            const persisted = before.audits.filter((event) => event.entityId === id);
            assert.ok(entries.every((entry) => persisted.some((event) => event.id === entry.id && event.action === entry.action)));
            if (!Array.isArray(body)) assert.equal(body.total, persisted.length);
          } else {
            const body = await json<MovementPage>(response, 200);
            const expected = movements.find((movement) => movement.relatedObjectId === (id === a.id ? visibleA.id : visibleB.id))!;
            assert.equal(body.total, 1);
            assert.deepEqual(body.items.map((movement) => movement.id), [expected.id]);
            assert.equal(body.items[0].relatedObject?.id, expected.relatedObjectId);
          }
        }
        assert.deepEqual(await snapshot(), before);
      };
      await readable(a.id);
      await rule(leaf, 'allow', 'selected', [a.id]);
      await readable(a.id);
      await readable(b.id);
      await rule(leaf, 'deny', 'selected', [a.id]);
      for (const path of paths(a.id)) await denied(path);
      await readable(b.id);
      await revoke(leaf);
      await readable(a.id);
      await rule(leaf, 'deny', 'all');
      for (const target of [a, b]) for (const path of paths(target.id)) await denied(path);
      await rule(leaf, 'allow', 'all');
      await readable(a.id);
      await readable(b.id);
      await rule('access', 'deny', 'selected', [a.id]);
      for (const path of paths(a.id)) await denied(path);
      await readable(b.id);
      await reset();
      if (leaf === 'inventory.read') {
        const before = await snapshot();
        const filtered = await json<MovementPage>(await request(`/counterparties/${a.id}/inventory-movements?objectId=${hiddenA.id}`), 200);
        assert.equal(filtered.total, 0);
        assert.deepEqual(filtered.items, []);
        await rule('inventory.read', 'allow', 'all');
        await rule('read', 'deny', 'selected', [visibleA.id], manager.id, 'objects');
        const blocked = await json<MovementPage>(await request(`/counterparties/${a.id}/inventory-movements`), 200);
        assert.equal(blocked.total, 0);
        assert.deepEqual(blocked.items, []);
        const projection = await card(a.id);
        assert.deepEqual(projection.objects, []);
        assert.equal(projection.objectCount, 0);
        assert.equal(projection.visibleObjectCount, 0);
        assert.equal(projection.masterObject, null);
        assert.deepEqual(await snapshot(), before);
      }
    });
  }

  await t.test('create all grant persists one author/audit and root allow alone grants no write', async () => {
    await reset();
    await denied('/counterparties', 'POST', createInput());
    await rule('access', 'allow', 'all');
    await denied('/counterparties', 'POST', createInput());
    await rule('create', 'allow', 'all');
    const before = await snapshot();
    const input = createInput();
    const created = await json<CounterpartyCardResponseDto>(await request('/counterparties', 'POST', input), 201);
    const after = await snapshot();
    const stored = after.counterparties.find((entry) => entry.id === created.id)!;
    assert.equal(after.counterparties.length, before.counterparties.length + 1);
    assert.equal(stored.createdByUserId, manager.id);
    assert.equal(stored.name, input.name);
    assert.equal(stored.status, 'active');
    assert.equal(created.objects.length, 0);
    assert.equal(created.masterObject, null);
    assert.deepEqual(after.counterparties.filter((entry) => entry.id !== created.id), before.counterparties);
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(after.objectAudits, before.objectAudits);
    assert.deepEqual(after.objectEvents, before.objectEvents);
    noInventoryEffects(before, after);
    const event = await addedAudit(created.id, 'counterparty.created', before);
    assert.equal((event.newValues as { name: string }).name, input.name);
    await rule('create', 'deny', 'all');
    await denied('/counterparties', 'POST', createInput());
    await revoke('create');
    await denied('/counterparties', 'POST', createInput());
    await rule('create', 'allow', 'all');
    await rule('access', 'deny', 'all');
    await denied('/counterparties', 'POST', createInput());
  });

  for (const operation of ['update', 'archive', 'restore'] as const) {
    await t.test(`${operation} selected/all is independent of other leaves, denies and revoke preserve control B`, async () => {
      await reset();
      const attempt = async (id: string, allowed: boolean, cookie = managerCookie) => {
        const required = operation === 'restore' ? 'archived' : 'active';
        if ((await card(id, founderCookie)).status !== required) {
          await json(await request(`/counterparties/${id}/${required === 'active' ? 'restore' : 'archive'}`, 'POST', undefined, founderCookie), 201);
        }
        const notes = `Scoped ${operation} ${++sequence}`;
        const path = `/counterparties/${id}${operation === 'update' ? '' : `/${operation}`}`;
        const method = operation === 'update' ? 'PATCH' : 'POST';
        const body = operation === 'update' ? { notes } : undefined;
        if (!allowed) { await denied(path, method, body, 403, cookie); return; }
        const before = await snapshot();
        const changed = await json<CounterpartyCardResponseDto>(await request(path, method, body, cookie), operation === 'update' ? 200 : 201);
        const after = await snapshot();
        const previous = before.counterparties.find((entry) => entry.id === id)!;
        const stored = after.counterparties.find((entry) => entry.id === id)!;
        assert.deepEqual(stored, { ...previous, updatedAt: stored.updatedAt,
          ...(operation === 'update' ? { notes } : { status: operation === 'archive' ? 'archived' : 'active' }),
        });
        assert.equal(changed.status, stored.status);
        assert.equal(changed.notes, stored.notes);
        assert.deepEqual(after.counterparties.filter((entry) => entry.id !== id), before.counterparties.filter((entry) => entry.id !== id));
        assert.deepEqual(after.objects, before.objects, 'Archive/restore must retain linked objects, their state and master designation');
        assert.deepEqual(after.objectAudits, before.objectAudits);
        assert.deepEqual(after.objectEvents, before.objectEvents);
        noInventoryEffects(before, after);
        await addedAudit(id, `counterparty.${operation === 'update' ? 'updated' : operation === 'archive' ? 'archived' : 'restored'}`, before,
          cookie === founderCookie ? founder.id : manager.id);
      };
      await attempt(a.id, false);
      if (operation === 'update') await rule('access', 'allow', 'selected', [a.id]);
      await rule(operation, 'allow', 'selected', [a.id]);
      await attempt(a.id, true);
      await attempt(b.id, false);
      if (operation === 'update') {
        await denied(`/counterparties/${a.id}/archive`, 'POST');
        await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'POST');
      }
      await rule(operation, 'deny', 'selected', [a.id]);
      await attempt(a.id, false);
      await revoke(operation);
      await attempt(a.id, false);
      await rule(operation, 'allow', 'all');
      await attempt(b.id, true);
      await rule('access', 'deny', 'selected', [a.id]);
      await attempt(a.id, false);
      await revoke('access');
      await attempt(a.id, true);
      await rule(operation, 'deny', 'selected', [a.id], founder.id);
      await attempt(a.id, false, founderCookie);
      await revoke(operation, founder.id);
      await attempt(a.id, true, founderCookie);
      await reset();
    });
  }

  await t.test('objects.link selected/all enforces visibility, both link directions, lifecycle and both audit stores', async () => {
    await reset();
    for (const target of [a, b]) await json(await request(`/counterparties/${target.id}/restore`, 'POST', undefined, founderCookie), 201);
    const link = async (counterpartyId: string, objectId: string, linked: boolean) => {
      const before = await snapshot();
      await json(await request(`/counterparties/${counterpartyId}/objects/${objectId}`, linked ? 'POST' : 'DELETE'), linked ? 201 : 200);
      const after = await snapshot();
      const stored = after.objects.find((object) => object.id === objectId)!;
      const previous = before.objects.find((object) => object.id === objectId)!;
      assert.deepEqual(stored, { ...previous, counterpartyId: linked ? counterpartyId : null, updatedAt: stored.updatedAt });
      assert.deepEqual(after.objects.filter((object) => object.id !== objectId), before.objects.filter((object) => object.id !== objectId));
      assert.deepEqual(after.counterparties, before.counterparties);
      noInventoryEffects(before, after);
      const event = await addedAudit(counterpartyId, linked ? 'counterparty.object_linked' : 'counterparty.object_unlinked', before);
      assert.equal(((linked ? event.newValues : event.oldValues) as { objectId: string }).objectId, objectId);
      const objectEvents = after.objectAudits.filter((entry) => !before.objectAudits.some((old) => old.id === entry.id));
      assert.equal(objectEvents.length, 1);
      assert.equal(objectEvents[0].objectId, objectId);
      assert.equal(objectEvents[0].actorUserId, manager.id);
      assert.equal(objectEvents[0].actionCode, 'object.counterparty_changed');
      assert.deepEqual(objectEvents[0].payload, { oldCounterpartyId: linked ? null : counterpartyId, newCounterpartyId: linked ? counterpartyId : null });
      const genericEvents = after.objectEvents.filter((entry) => !before.objectEvents.some((old) => old.id === entry.id));
      assert.equal(genericEvents.length, 1);
      assert.equal(genericEvents[0].entityId, objectId);
      assert.equal(genericEvents[0].action, 'object.counterparty_changed');
      assert.equal(genericEvents[0].actorUserId, manager.id);
      assert.deepEqual(genericEvents[0].metadata, objectEvents[0].payload);
    };
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'POST');
    await rule('objects.link', 'allow', 'selected', [a.id]);
    await link(a.id, looseA.id, true);
    await denied(`/counterparties/${b.id}/objects/${looseB.id}`, 'POST');
    await denied(`/counterparties/${a.id}/master-object/${looseA.id}`, 'POST');
    await denied(`/counterparties/${a.id}/objects/${hiddenA.id}`, 'DELETE', undefined, 404);
    await denied(`/counterparties/${a.id}/objects/${deletedObject.id}`, 'POST', undefined, 404);
    await rule('read', 'deny', 'selected', [looseA.id], manager.id, 'objects');
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'DELETE', undefined, 404);
    await revoke('read', manager.id, 'objects');
    await revoke('objects.link');
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'DELETE');
    await rule('objects.link', 'allow', 'selected', [a.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'DELETE');
    await revoke('access');
    await link(a.id, looseA.id, false);
    await rule('objects.link', 'deny', 'selected', [a.id]);
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'POST');
    await rule('objects.link', 'allow', 'all');
    await link(b.id, looseB.id, true);
    await link(b.id, looseB.id, false);
    await json(await request(`/counterparties/${a.id}/archive`, 'POST', undefined, founderCookie), 201);
    await denied(`/counterparties/${a.id}/objects/${looseA.id}`, 'POST', undefined, 400);
    await json(await request(`/counterparties/${a.id}/restore`, 'POST', undefined, founderCookie), 201);
  });

  await t.test('master_object.manage selected/all replaces one master, clears safely and cannot grant linking', async () => {
    await reset();
    await json(await request(`/counterparties/${a.id}/objects/${looseA.id}`, 'POST', undefined, founderCookie), 201);
    const master = async (id: string, objectId: string | null) => {
      const before = await snapshot();
      const previous = before.objects.find((object) => object.masterForCounterpartyId === id);
      const result = await json<CounterpartyCardResponseDto>(await request(`/counterparties/${id}/master-object${objectId ? `/${objectId}` : ''}`,
        objectId ? 'POST' : 'DELETE'), objectId ? 201 : 200);
      const after = await snapshot();
      assert.equal(result.masterObject?.id ?? null, objectId);
      assert.deepEqual(after.objects.filter((object) => object.masterForCounterpartyId === id).map((object) => object.id), objectId ? [objectId] : []);
      for (const object of after.objects) {
        const old = before.objects.find((entry) => entry.id === object.id)!;
        const affected = object.id === previous?.id || object.id === objectId;
        assert.deepEqual(object, affected ? { ...old, updatedAt: object.updatedAt,
          masterForCounterpartyId: object.id === objectId ? id : null } : old);
      }
      assert.deepEqual(after.counterparties, before.counterparties);
      assert.deepEqual(after.objectAudits, before.objectAudits);
      assert.deepEqual(after.objectEvents, before.objectEvents);
      noInventoryEffects(before, after);
      const event = await addedAudit(id, objectId ? 'counterparty.master_object_changed' : 'counterparty.master_object_cleared', before);
      assert.deepEqual(event.oldValues, { objectId: previous?.id ?? null });
      assert.deepEqual(event.newValues, objectId ? { objectId } : null);
    };
    await denied(`/counterparties/${a.id}/master-object/${looseA.id}`, 'POST');
    await rule('master_object.manage', 'allow', 'selected', [a.id]);
    await master(a.id, looseA.id);
    await denied(`/counterparties/${b.id}/master-object`, 'DELETE');
    await denied(`/counterparties/${a.id}/objects/${looseB.id}`, 'POST');
    await denied(`/counterparties/${a.id}/master-object/${looseB.id}`, 'POST', undefined, 400);
    await denied(`/counterparties/${a.id}/master-object/${hiddenA.id}`, 'POST', undefined, 404);
    await revoke('master_object.manage');
    await denied(`/counterparties/${a.id}/master-object`, 'DELETE');
    await rule('master_object.manage', 'allow', 'selected', [a.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await denied(`/counterparties/${a.id}/master-object`, 'DELETE');
    await revoke('access');
    await master(a.id, null);
    await rule('master_object.manage', 'deny', 'selected', [a.id]);
    await denied(`/counterparties/${a.id}/master-object/${visibleA.id}`, 'POST');
    await rule('master_object.manage', 'allow', 'all');
    await master(b.id, null);
    await master(b.id, visibleB.id);
    await master(a.id, visibleA.id);
    const beforeReplay = await snapshot();
    await json(await request(`/counterparties/${a.id}/master-object/${visibleA.id}`, 'POST'), 201);
    assert.deepEqual(await snapshot(), beforeReplay, 'Idempotent designation adds neither another master nor audit');
    await json(await request(`/counterparties/${a.id}/archive`, 'POST', undefined, founderCookie), 201);
    await denied(`/counterparties/${a.id}/master-object/${looseA.id}`, 'POST', undefined, 400);
    await json(await request(`/counterparties/${a.id}/restore`, 'POST', undefined, founderCookie), 201);
  });

  await t.test('all-scope relink clears the old master with both counterparty audits, while movement facts stay on the physical object', async () => {
    await reset();
    await rule('objects.link', 'allow', 'all');
    const before = await snapshot();
    const original = before.objects.find((object) => object.id === visibleB.id)!;
    assert.equal(original.counterpartyId, b.id);
    assert.equal(original.masterForCounterpartyId, b.id);
    await json(await request(`/counterparties/${a.id}/objects/${visibleB.id}`, 'POST'), 201);
    const after = await snapshot();
    const moved = after.objects.find((object) => object.id === visibleB.id)!;
    assert.deepEqual(moved, { ...original, counterpartyId: a.id, masterForCounterpartyId: null, updatedAt: moved.updatedAt });
    assert.deepEqual(after.objects.filter((object) => object.id !== visibleB.id), before.objects.filter((object) => object.id !== visibleB.id));
    assert.deepEqual(after.counterparties, before.counterparties);
    noInventoryEffects(before, after);
    const events = after.audits.filter((event) => !before.audits.some((old) => old.id === event.id));
    assert.deepEqual(new Set(events.map((event) => `${event.entityId}:${event.action}`)), new Set([
      `${a.id}:counterparty.object_linked`, `${b.id}:counterparty.object_unlinked_by_relink`, `${b.id}:counterparty.master_object_cleared`,
    ]));
    assert.equal(events.length, 3);
    assert.ok(events.every((event) => event.actorUserId === manager.id));
    assert.equal(after.objectAudits.length, before.objectAudits.length + 1);
    const objectEvents = after.objectEvents.filter((event) => !before.objectEvents.some((old) => old.id === event.id));
    assert.equal(objectEvents.length, 1);
    assert.equal(objectEvents[0].entityId, visibleB.id);
    assert.equal(objectEvents[0].action, 'object.counterparty_changed');
    assert.equal(objectEvents[0].actorUserId, manager.id);
    assert.deepEqual(objectEvents[0].metadata, { oldCounterpartyId: b.id, newCounterpartyId: a.id });
    const inventory = await json<MovementPage>(await request(`/counterparties/${a.id}/inventory-movements`), 200);
    assert.deepEqual(new Set(inventory.items.map((movement) => movement.id)), new Set(movements.filter((movement) => movement.relatedObjectId !== hiddenA.id).map((movement) => movement.id)));
    const control = await json<MovementPage>(await request(`/counterparties/${b.id}/inventory-movements`), 200);
    assert.equal(control.total, 0);
    await reset();
  });

  for (const leaf of ['update', 'objects.link'] as const) {
    await t.test(`selected read deny A overrides ${leaf} allow A before any write or audit`, async () => {
      await reset();
      // Run these regressions last, independently: a failing zero-effect assertion
      // must not contaminate the earlier successful link/master lifecycle scenarios.
      const object = leaf === 'objects.link'
        ? await objectFixture('read-denied-link-target', null, true) : undefined;
      if (object) objectIds.push(object.id);
      try {
        await rule(leaf, 'allow', 'selected', [a.id]);
        await rule('read', 'deny', 'selected', [a.id]);
        await denied(`/counterparties/${a.id}`);
        await card(b.id); // The deny is selected A, not a global/module denial.
        if (leaf === 'update') {
          await denied(`/counterparties/${b.id}`, 'PATCH', { notes: 'No write grant for control B' });
        } else {
          assert.ok(object);
          assert.equal(object.counterpartyId, null);
          assert.equal(object.deletedAt, null);
          await denied(`/counterparties/${b.id}/objects/${object.id}`, 'POST');
        }

        const before = await snapshot();
        const path = leaf === 'update' ? `/counterparties/${a.id}`
          : `/counterparties/${a.id}/objects/${object!.id}`;
        const method = leaf === 'update' ? 'PATCH' : 'POST';
        const response = await request(path, method,
          leaf === 'update' ? { notes: `${marker}-read-denied-update` } : undefined);
        const body = await response.text();
        const after = await snapshot();
        assert.equal(response.status, 403, `${method} ${path}: ${body}`);
        assert.deepEqual(after, before,
          `Read-denied ${leaf} must fail before persistence: no counterparty/object change, link, master change, inventory effect or audit`);
      } finally {
        await reset();
      }
      // Isolated runner owns the fixtures; no shared-schema cleanup is performed.
    });
  }
});
