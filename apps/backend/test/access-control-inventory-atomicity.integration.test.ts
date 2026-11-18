import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type Prisma } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import type { InventoryItemResponseDto } from '../src/modules/inventory/dto/inventory-item-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type AuditInput = Parameters<AuditService['writeAuditEvent']>[0];

test('inventory HTTP atomicity: catalog create/update and receipt roll back real audit failures; unreadable generated IDs never leak', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.equal(database.port, '55432');
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreAudit = () => {};
  const ruleIds = new Set<string>();
  const resetRules = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    restoreAudit();
    try { await resetRules(); } finally {
      try { await closeApp?.(); } finally { await prisma.$disconnect(); }
    }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, include: { roles: { include: { role: true } } } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'inventory.' } } }), 0);
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const marker = `acl-inventory-atomicity-${randomUUID()}`;
  let sequence = 0;
  const input = () => ({ name: `${marker}-${++sequence}`, category: 'Atomicity fixture', unit: 'шт', notes: marker });
  const request = (path: string, method = 'GET', body?: unknown, asFounder = false) => fetch(`${baseUrl}/api/v1/inventory${path}`, {
    method, headers: { Cookie: asFounder ? founderCookie : actorCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)!;
    assert.equal(definition.manageable, true);
    assert.ok(definition.allowedScopes.includes(selectedIds ? 'selected' : 'all'));
    if (selectedIds) assert.ok(selectedIds.length > 0);
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved.id;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const read = (id: string) => request(`/items/${id}`).then((response) => json<InventoryItemResponseDto>(response, 200));
  const stocked = async () => {
    const item = await json<InventoryItemResponseDto>(await request('/items', 'POST', input(), true), 201);
    await json(await request('/movements', 'POST', {
      inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 10, comment: marker,
    }, true), 201);
    return item;
  };
  // Snapshot the whole small isolated inventory namespace, not just known IDs:
  // failed creates/receipts generate IDs that must not survive outside the tx.
  const capture = async () => {
    const [items, movements, approvals, events, attachments, roles, permissions, rules] = await Promise.all([
      prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['inventory_item', 'inventory_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
      prisma.userPermission.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
      prisma.userAccessRule.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    ]);
    return { items, movements, approvals, events, attachments, roles, permissions, rules };
  };
  type State = Awaited<ReturnType<typeof capture>>;
  const auditService = app.get(AuditService);
  const originalAudit = auditService.writeAuditEvent;
  restoreAudit = () => { auditService.writeAuditEvent = originalAudit; };
  const failAudit = async (
    action: string,
    related: (entry: AuditInput) => boolean,
    verifyBusinessWrite: (tx: Prisma.TransactionClient, entityId: string) => Promise<void>,
    send: () => Promise<Response>,
  ) => {
    const before = await capture();
    let injections = 0;
    let insertedId: string | undefined;
    auditService.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
      await originalAudit.apply(auditService, args);
      const [entry, tx] = args;
      if (entry.actorUserId !== actor.id || entry.action !== action || !related(entry)) return;
      assert.ok(tx, 'Audit writer must receive the business transaction client');
      assert.ok('inventoryItem' in tx && 'inventoryMovement' in tx, 'Use the real inventory transaction, not a mocked audit adapter');
      assert.equal(await tx.auditEvent.count({ where: {
        entityType: entry.entityType, entityId: entry.entityId, action, actorUserId: actor.id,
      } }), 1, 'The actual audit INSERT must precede the injected exception');
      await verifyBusinessWrite(tx as Prisma.TransactionClient, entry.entityId);
      insertedId = entry.entityId;
      injections += 1;
      throw new Error('Controlled inventory audit failure after real INSERT');
    };
    let response: Response;
    try { response = await send(); } finally { restoreAudit(); }
    const text = await response.text();
    assert.equal(injections, 1, 'An unrelated 500, transaction timeout or authorization denial is not rollback proof');
    assert.equal(response.status, 500, text);
    assert.deepEqual(await capture(), before, 'Audit failure must roll back item/version/price, ledger, approvals and audit while retaining ACL sources');
    assert.ok(insertedId);
    return { before, insertedId };
  };
  const assertSingleAudit = (before: State, after: State, entityId: string, action: string) => {
    const added = after.events.filter((entry) => !before.events.some((old) => old.id === entry.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].entityId, entityId);
    assert.equal(added[0].action, action);
    assert.equal(added[0].actorUserId, actor.id);
    assert.deepEqual(after.events.filter((entry) => entry.id !== added[0].id), before.events);
    for (const key of ['approvals', 'attachments', 'roles', 'permissions', 'rules'] as const) assert.deepEqual(after[key], before[key]);
  };

  await t.test('catalog create: real row plus audit roll back together; same-payload explicit retry creates once', async (suite) => {
    suite.after(resetRules);
    await stocked();
    await rule('inventory.catalog.create', 'allow');
    const body = input();
    const { before, insertedId } = await failAudit('inventory.item.created',
      (entry) => entry.entityType === 'inventory_item' && (entry.newValues as { name?: string })?.name === body.name,
      async (tx, id) => {
        const saved = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
        assert.equal(saved.name, body.name);
        assert.equal(saved.createdByUserId, actor.id);
        assert.equal(saved.version, 1);
      }, () => request('/items', 'POST', body));
    assert.equal(await prisma.inventoryItem.findUnique({ where: { id: insertedId } }), null);
    const created = await json<InventoryItemResponseDto>(await request('/items', 'POST', body), 201);
    const after = await capture();
    assert.equal(created.name, body.name);
    assert.equal(created.currentStock, 0);
    assert.equal(created.createdBy.id, actor.id);
    assert.equal(after.items.length, before.items.length + 1);
    assert.equal(after.items.find((entry) => entry.id === created.id)?.name, body.name);
    assert.deepEqual(after.items.filter((entry) => entry.id !== created.id), before.items);
    assert.deepEqual(after.movements, before.movements);
    assertSingleAudit(before, after, created.id, 'inventory.item.created');
    assert.equal((await read(created.id)).id, created.id);
  });

  await t.test('catalog update: version/fields and audit roll back; retry accepts the original expectedVersion once', async (suite) => {
    suite.after(resetRules);
    const a = await stocked();
    await stocked();
    await rule('inventory.catalog.update', 'allow', [a.id]);
    const body = { expectedVersion: a.version, notes: `${marker}-updated` };
    const { before } = await failAudit('inventory.item.updated', (entry) => entry.entityType === 'inventory_item' && entry.entityId === a.id,
      async (tx, id) => {
        const saved = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
        assert.equal(saved.notes, body.notes);
        assert.equal(saved.version, a.version + 1);
      }, () => request(`/items/${a.id}`, 'PATCH', body));
    const changed = await json<InventoryItemResponseDto>(await request(`/items/${a.id}`, 'PATCH', body), 200);
    const after = await capture();
    assert.equal(changed.version, a.version + 1);
    assert.equal(changed.notes, body.notes);
    assert.equal(changed.currentStock, 10);
    const original = before.items.find((entry) => entry.id === a.id)!;
    const saved = after.items.find((entry) => entry.id === a.id)!;
    assert.deepEqual(saved, { ...original, notes: body.notes, version: original.version + 1, updatedAt: saved.updatedAt });
    assert.deepEqual(after.items.filter((entry) => entry.id !== a.id), before.items.filter((entry) => entry.id !== a.id));
    assert.deepEqual(after.movements, before.movements);
    assertSingleAudit(before, after, a.id, 'inventory.item.updated');
    const stale = await request(`/items/${a.id}`, 'PATCH', body);
    assert.equal(stale.status, 409, await stale.text());
    assert.deepEqual(await capture(), after);
  });

  await t.test('receipt: movement, current price and audit roll back together; retry adds stock once and preserves old snapshots', async (suite) => {
    suite.after(resetRules);
    const a = await stocked();
    const b = await stocked();
    await rule('inventory.receipt', 'allow', [a.id]);
    const body = { inventoryItemId: a.id, movementType: 'receipt', quantity: 2, unitPrice: 20, comment: marker };
    const { before, insertedId } = await failAudit('inventory.movement.created',
      (entry) => entry.entityType === 'inventory_movement' && (entry.newValues as { inventoryItemId?: string })?.inventoryItemId === a.id,
      async (tx, id) => {
        const row = await tx.inventoryMovement.findUniqueOrThrow({ where: { id } });
        assert.equal(row.inventoryItemId, a.id);
        assert.equal(row.movementType, 'receipt');
        assert.equal(row.status, 'applied');
        assert.equal(row.quantity.toNumber(), 2);
        assert.equal(row.unitPriceSnapshot.toNumber(), 20);
        assert.equal(row.totalAmountSnapshot.toNumber(), 40);
        assert.equal((await tx.inventoryItem.findUniqueOrThrow({ where: { id: a.id } })).currentUnitPrice?.toNumber(), 20);
      }, () => request('/movements', 'POST', body));
    assert.equal(await prisma.inventoryMovement.findUnique({ where: { id: insertedId } }), null);
    assert.equal((await read(a.id)).currentStock, 10);
    const movement = await json<{ id: string }>(await request('/movements', 'POST', body), 201);
    const after = await capture();
    assert.equal(after.movements.length, before.movements.length + 1);
    assert.deepEqual(after.movements.filter((entry) => entry.id !== movement.id), before.movements);
    const savedMovement = after.movements.find((entry) => entry.id === movement.id)!;
    assert.equal(savedMovement.createdByUserId, actor.id);
    assert.equal(savedMovement.quantity.toNumber(), 2);
    assert.equal(savedMovement.unitPriceSnapshot.toNumber(), 20);
    assert.equal(savedMovement.totalAmountSnapshot.toNumber(), 40);
    const original = before.items.find((entry) => entry.id === a.id)!;
    const savedItem = after.items.find((entry) => entry.id === a.id)!;
    assert.deepEqual(savedItem, { ...original, currentUnitPrice: savedItem.currentUnitPrice, updatedAt: savedItem.updatedAt });
    assert.equal(savedItem.currentUnitPrice?.toNumber(), 20);
    assert.deepEqual(after.items.filter((entry) => entry.id !== a.id), before.items.filter((entry) => entry.id !== a.id));
    assertSingleAudit(before, after, movement.id, 'inventory.movement.created');
    assert.equal((await read(a.id)).currentStock, 12);
    assert.equal((await read(b.id)).currentStock, 10);
  });

  await t.test('catalog create all plus read deny all cannot persist or return a generated-ID card; removing deny permits one retry', async (suite) => {
    suite.after(resetRules);
    const control = await stocked();
    await rule('inventory.catalog.create', 'allow');
    const denyId = await rule('inventory.read', 'deny');
    const hidden = await request(`/items/${control.id}`);
    assert.equal(hidden.status, 404, await hidden.text());
    const before = await capture();
    const body = input();
    let creationAudits = 0;
    auditService.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
      if (args[0].actorUserId === actor.id && args[0].action === 'inventory.item.created') creationAudits += 1;
      await originalAudit.apply(auditService, args);
    };
    let response: Response;
    try { response = await request('/items', 'POST', body); } finally { restoreAudit(); }
    const text = await response.text();
    assert.deepEqual(await capture(), before, '403 must not conceal a committed unreadable row, orphaned audit or changed stock');
    assert.equal(response.status, 403, text);
    assert.equal(creationAudits, 0, 'Reject the generated ID inside the transaction before creation audit');
    const errorBody = JSON.parse(text) as Record<string, unknown>;
    for (const field of ['id', 'name', 'category', 'unit', 'createdBy', 'currentStock']) assert.equal(Object.hasOwn(errorBody, field), false, `Error response must not leak card field ${field}`);
    assert.equal(text.includes(body.name), false);
    await removeRule(denyId);
    const beforeRetry = await capture();
    const created = await json<InventoryItemResponseDto>(await request('/items', 'POST', body), 201);
    const after = await capture();
    assert.equal(after.items.length, beforeRetry.items.length + 1);
    assert.equal(after.items.filter((entry) => entry.name === body.name).length, 1);
    assert.equal(created.createdBy.id, actor.id);
    assert.equal(created.currentStock, 0);
    assert.deepEqual(after.items.filter((entry) => entry.id !== created.id), beforeRetry.items);
    assert.deepEqual(after.movements, beforeRetry.movements);
    assertSingleAudit(beforeRetry, after, created.id, 'inventory.item.created');
    assert.equal((await read(created.id)).id, created.id, 'Same cookie sees the retry after deny removal');
  });
});
