import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { InventoryItemResponseDto } from '../src/modules/inventory/dto/inventory-item-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';
type Movement = { id: string; status: string };

// Deliberately bounded: movement.correct, movement.photos.create,
// resolve_missing_photo and references.read need separate lifecycle/photo fixtures.
// No websocket, concurrency or delivery claims.
test('inventory grants preserve ledger, source boundaries and approval invariants over real HTTP', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.deepEqual(ACCESS_ACTION_CATALOG.filter((action) => action.module === 'inventory').map((action) => action.code).sort(), [
    'access', 'read', 'catalog.create', 'catalog.update', 'catalog.delete', 'catalog.restore',
    'movements.read', 'reports', 'receipt', 'issue_to_object', 'issue_to_one_time_order',
    'return', 'writeoff', 'adjustment', 'movement.correct', 'movement.photos.create', 'resolve_missing_photo', 'references.read',
  ].map((suffix) => `inventory.${suffix}`).sort());
  const ownPhoto = ACCESS_ACTION_CATALOG.find(action => action.code === 'inventory.movement.photos.create');
  assert.ok(ownPhoto);
  assert.equal(ownPhoto.manageable, true);
  assert.deepEqual(ownPhoto.allowedScopes, ['own']);

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const users = new Map<string, string>();
  const cookies = new Map<string, string>();
  for (const [login, password] of [['founder', 'founder123'], ['manager1', 'manager123'], ['director', 'director123']]) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const actorId = users.get('manager1')!;
  const founderId = users.get('founder')!;
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [...users.values()] } } }), 0);
  const marker = `acl-inventory-${randomUUID()}`;
  const itemIds: string[] = [];
  let sequence = 0;
  const request = (path: string, method = 'GET', body?: unknown, login = 'manager1') => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], login = 'manager1') => {
    const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)!;
    assert.equal(definition.manageable, true);
    assert.ok(definition.allowedScopes.includes(scope), `${actionCode}: unsupported ${scope}`);
    const userId = users.get(login)!;
    await prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (actionCode: string, login = 'manager1') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: users.get(login)!, actionCode } },
  });
  // Only rules created by this file, on seeded accounts in the isolated schema.
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: [...users.values()] }, OR: [
    { actionCode: { startsWith: 'inventory.' } }, { actionCode: { in: ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'] } },
  ] } });
  const itemInput = () => ({ name: `${marker}-${++sequence}`, category: 'ACL isolated inventory', unit: 'шт' });
  const createItem = async (login = 'founder') => {
    const item = await json<InventoryItemResponseDto>(await request('/inventory/items', 'POST', itemInput(), login), 201);
    itemIds.push(item.id);
    return item;
  };
  const card = (id: string) => request(`/inventory/items/${id}`).then((response) => json<InventoryItemResponseDto>(response, 200));
  const movementInput = (id: string, movementType: string, extra: Record<string, unknown> = {}) => ({
    inventoryItemId: id, movementType, quantity: 1, comment: marker, ...extra,
  });
  const move = (id: string, movementType: string, extra: Record<string, unknown> = {}, login = 'manager1') =>
    request('/inventory/movements', 'POST', movementInput(id, movementType, extra), login).then((response) => json<Movement>(response, 201));
  const stocked = async (quantity = 10) => {
    const item = await createItem();
    await move(item.id, 'receipt', { quantity, unitPrice: 10 }, 'founder');
    return item;
  };
  const snapshot = async () => {
    const [items, movements, approvals, audits, objects, orders, budgets, alerts, attachments, notifications] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['inventory_item', 'inventory_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      prisma.oneTimeOrder.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      prisma.objectBudgetPeriod.findMany({ orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
      prisma.objectBudgetAlert.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.notification.findMany({ where: { entityType: { in: ['inventory_movement', 'approval_request', 'object', 'one_time_order'] } }, orderBy: { id: 'asc' } }),
    ]);
    return { items, movements, approvals, audits, objects, orders, budgets, alerts, attachments, notifications };
  };
  type State = Awaited<ReturnType<typeof snapshot>>;
  const denied = async (path: string, method = 'POST', body?: unknown, status = 403, login = 'manager1') => {
    const before = await snapshot();
    const response = await request(path, method, body, login);
    const text = await response.text();
    const after = await snapshot();
    // Assert effects first so a leaked successful write is reported even if status is also wrong.
    assert.deepEqual(after, before, `${method} ${path}: no unauthorized ledger/catalog/source/approval/audit effects; status=${response.status}`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
  };
  const audit = async (entityId: string, action: string, login = 'manager1') => {
    assert.equal(await prisma.auditEvent.count({ where: { entityId, action, actorUserId: users.get(login)! } }), 1);
  };
  const assertNewMovement = async (before: State, id: string, itemId: string, stock: number, login = 'manager1') => {
    const after = await snapshot();
    assert.equal(after.movements.length, before.movements.length + 1);
    assert.deepEqual(after.movements.filter((entry) => entry.id !== id), before.movements, 'Historical quantities/prices/statuses must not be rewritten');
    const row = after.movements.find((entry) => entry.id === id)!;
    assert.equal(row.inventoryItemId, itemId);
    assert.equal(row.createdByUserId, users.get(login)!);
    assert.equal(row.unitPriceSnapshot.toNumber(), 10);
    assert.equal(row.totalAmountSnapshot.toNumber(), row.quantity.toNumber() * 10);
    assert.equal((await card(itemId)).currentStock, stock);
    assert.deepEqual(after.items.filter((entry) => entry.id !== itemId), before.items.filter((entry) => entry.id !== itemId));
    await audit(id, 'inventory.movement.created', login);
    return row;
  };

  await t.test('catalog create all extends default denial; explicit leaf/parent deny and revoke use the same cookie', async () => {
    await denied('/inventory/items', 'POST', itemInput());
    await rule('inventory.catalog.create', 'allow', 'all');
    const before = await snapshot();
    const item = await createItem('manager1');
    const after = await snapshot();
    assert.equal(after.items.length, before.items.length + 1);
    assert.equal(item.createdBy.id, actorId);
    assert.equal(item.currentStock, 0);
    assert.equal(item.version, 1);
    assert.deepEqual(after.movements, before.movements);
    await audit(item.id, 'inventory.item.created');
    await rule('inventory.catalog.create', 'deny', 'all');
    await denied('/inventory/items', 'POST', itemInput());
    await revoke('inventory.catalog.create');
    await denied('/inventory/items', 'POST', itemInput());
    await rule('inventory.catalog.create', 'allow', 'all');
    await rule('inventory.access', 'deny', 'all');
    await denied('/inventory/items', 'POST', itemInput());
    await reset();
  });

  await t.test('selected read deny removes A before pagination, preserves control B; allow/revoke restore inherited read', async () => {
    await reset();
    const a = await createItem();
    const b = await createItem();
    await card(a.id);
    await rule('inventory.read', 'deny', 'selected', [a.id]);
    await denied(`/inventory/items/${a.id}`, 'GET', undefined, 404);
    await card(b.id);
    const before = await snapshot();
    const list = await json<{ items: InventoryItemResponseDto[]; total: number }>(await request(`/inventory/items?search=${encodeURIComponent(a.name)}&page=1&limit=1`), 200);
    assert.equal(list.total, 0);
    assert.deepEqual(list.items, []);
    await rule('inventory.read', 'allow', 'selected', [a.id]);
    await card(a.id);
    await card(b.id); // An additive allow must not remove inherited B access.
    await revoke('inventory.read');
    await card(a.id);
    await rule('inventory.read', 'deny', 'all');
    await denied(`/inventory/items/${b.id}`, 'GET', undefined, 404);
    await rule('inventory.read', 'allow', 'all');
    await card(b.id);
    await rule('inventory.access', 'deny', 'selected', [a.id]);
    await denied(`/inventory/items/${a.id}`, 'GET', undefined, 404);
    await card(b.id);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('catalog update selected A excludes B; all extends B, versions and historical stock survive', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    const path = (id: string) => `/inventory/items/${id}`;
    await denied(path(a.id), 'PATCH', { expectedVersion: a.version, notes: 'Denied' });
    await rule('inventory.catalog.update', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    const updated = await json<InventoryItemResponseDto>(await request(path(a.id), 'PATCH', { expectedVersion: a.version, notes: 'Selected editor' }), 200);
    assert.equal(updated.notes, 'Selected editor');
    assert.equal(updated.version, a.version + 1);
    assert.equal(updated.createdBy.id, founderId);
    assert.equal(updated.currentStock, 10);
    const after = await snapshot();
    assert.deepEqual(after.movements, before.movements);
    assert.deepEqual(after.items.filter((entry) => entry.id !== a.id), before.items.filter((entry) => entry.id !== a.id));
    await audit(a.id, 'inventory.item.updated');
    await denied(path(b.id), 'PATCH', { expectedVersion: b.version, notes: 'Outside selected' });
    await denied(path(a.id), 'PATCH', { expectedVersion: a.version, notes: 'Stale' }, 409);
    await rule('inventory.catalog.update', 'deny', 'selected', [a.id]);
    await denied(path(a.id), 'PATCH', { expectedVersion: updated.version, notes: 'Explicit deny' });
    await revoke('inventory.catalog.update');
    await denied(path(a.id), 'PATCH', { expectedVersion: updated.version, notes: 'Revoked' });
    await rule('inventory.catalog.update', 'allow', 'all');
    await json(await request(path(b.id), 'PATCH', { expectedVersion: b.version, notes: 'All editor' }), 200);
    await rule('inventory.access', 'deny', 'all');
    await denied(path(a.id), 'PATCH', { expectedVersion: updated.version, notes: 'Parent denied' });
  });

  await t.test('delete/restore selected A preserve zero-stock history; nonzero stock and control B are protected', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    await move(a.id, 'adjustment', { quantity: 10, adjustmentDirection: 'decrease' }, 'founder');
    await denied(`/inventory/items/${a.id}`, 'DELETE');
    await rule('inventory.catalog.delete', 'allow', 'selected', [a.id]);
    await denied(`/inventory/items/${b.id}`, 'DELETE');
    await rule('inventory.catalog.delete', 'allow', 'all');
    await denied(`/inventory/items/${b.id}`, 'DELETE', undefined, 409);
    await rule('inventory.catalog.delete', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    assert.equal((await json<{ mode: string }>(await request(`/inventory/items/${a.id}`, 'DELETE'), 200)).mode, 'soft');
    const deleted = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(deleted.isActive, false);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedByUserId, actorId);
    assert.deepEqual((await snapshot()).movements, before.movements);
    await audit(a.id, 'inventory.item.deleted');
    const restoreBody = { expectedVersion: deleted.version };
    await denied(`/inventory/items/${a.id}/restore`, 'POST', restoreBody);
    await rule('inventory.catalog.restore', 'allow', 'selected', [b.id]);
    await denied(`/inventory/items/${a.id}/restore`, 'POST', restoreBody);
    await rule('inventory.catalog.restore', 'allow', 'selected', [a.id]);
    await rule('inventory.access', 'deny', 'all');
    await denied(`/inventory/items/${a.id}/restore`, 'POST', restoreBody);
    await revoke('inventory.access');
    const restored = await json<InventoryItemResponseDto>(await request(`/inventory/items/${a.id}/restore`, 'POST', restoreBody), 201);
    assert.equal(restored.isActive, true);
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.version, deleted.version + 1);
    assert.equal(restored.currentStock, 0);
    assert.deepEqual((await snapshot()).movements, before.movements);
    await audit(a.id, 'inventory.item.restored');
    const empty = await createItem();
    await rule('inventory.catalog.delete', 'allow', 'selected', [empty.id]);
    assert.equal((await json<{ mode: string }>(await request(`/inventory/items/${empty.id}`, 'DELETE'), 200)).mode, 'hard');
    assert.equal(await prisma.inventoryItem.findUnique({ where: { id: empty.id } }), null);
    await audit(empty.id, 'inventory.item.deleted_permanently');
  });

  await t.test('receipt selected/all grant and revoke apply exactly one priced movement and preserve control stock', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    const body = movementInput(a.id, 'receipt', { unitPrice: 10 });
    await denied('/inventory/movements', 'POST', body);
    await rule('inventory.receipt', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    const received = await move(a.id, 'receipt', { unitPrice: 10 });
    assert.equal((await assertNewMovement(before, received.id, a.id, 11)).status, 'applied');
    await denied('/inventory/movements', 'POST', { ...body, inventoryItemId: b.id });
    await rule('inventory.receipt', 'deny', 'selected', [a.id]);
    await denied('/inventory/movements', 'POST', body);
    await revoke('inventory.receipt');
    await denied('/inventory/movements', 'POST', body);
    await rule('inventory.receipt', 'allow', 'all');
    const beforeB = await snapshot();
    const receivedB = await move(b.id, 'receipt', { unitPrice: 10 });
    await assertNewMovement(beforeB, receivedB.id, b.id, 11);
    await rule('inventory.access', 'deny', 'all');
    await denied('/inventory/movements', 'POST', body);
  });

  await t.test('object issue selected grant has object scope, source read/parent denials block persistence', async () => {
    await reset();
    const item = await stocked();
    const objects = [];
    for (const suffix of ['A', 'B']) objects.push(await prisma.object.create({ data: {
      name: `${marker}-object-${suffix}`, address: 'Isolated fixture', status: 'active', createdByUserId: founderId,
    } }));
    const path = (id: string) => `/objects/${id}/inventory/issue`;
    const body = { inventoryItemId: item.id, quantity: 1, comment: marker };
    await rule('objects.read', 'allow', 'selected', objects.map(object => object.id));
    await denied(path(objects[0].id), 'POST', body);
    await rule('inventory.issue_to_object', 'allow', 'selected', [objects[0].id]);
    const before = await snapshot();
    const issued = await json<Movement>(await request(path(objects[0].id), 'POST', body), 201);
    const row = await assertNewMovement(before, issued.id, item.id, 9);
    assert.equal(row.relatedObjectId, objects[0].id);
    assert.equal(row.relatedOneTimeOrderId, null);
    assert.equal(row.evidenceRequired, true);
    assert.equal(row.requiresApprovalBridge, true);
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: row.id } });
    assert.equal(approval.status, 'pending');
    assert.equal(approval.approvalType, 'inventory_exception_confirmation');
    await denied(path(objects[1].id), 'POST', body);
    for (const action of ['objects.read', 'objects.access', 'inventory.access']) {
      await rule(action, 'deny', action === 'inventory.access' ? 'all' : 'selected', action === 'inventory.access' ? [] : [objects[0].id]);
      await denied(path(objects[0].id), 'POST', body);
      await revoke(action);
      if (action === 'objects.read') await rule('objects.read', 'allow', 'selected', objects.map(object => object.id));
    }
    await rule('inventory.issue_to_object', 'deny', 'selected', [objects[0].id]);
    await denied(path(objects[0].id), 'POST', body);
    await revoke('inventory.issue_to_object');
    await denied(path(objects[0].id), 'POST', body);
  });

  await t.test('order dispatch assigned/selected/all keeps active-assignment invariant, source denies, replay and closed-order stock safety', async () => {
    await reset();
    const item = await stocked();
    const a = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-order-A`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'in_progress', createdByUserId: founderId,
      assignments: { create: { userId: actorId, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    const b = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-order-B`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'in_progress', createdByUserId: founderId,
    } });
    const path = (id: string) => `/one-time-orders/${id}/inventory/issue`;
    const body = { inventoryItemId: item.id, quantity: 1, comment: marker, requestId: randomUUID() };
    await rule('inventory.issue_to_one_time_order', 'deny', 'assigned');
    await denied(path(a.id), 'POST', body);
    await rule('inventory.issue_to_one_time_order', 'allow', 'assigned');
    const before = await snapshot();
    const issued = await json<Movement>(await request(path(a.id), 'POST', body), 201);
    const row = await assertNewMovement(before, issued.id, item.id, 9);
    assert.equal(row.relatedOneTimeOrderId, a.id);
    assert.equal(row.relatedObjectId, null);
    assert.equal(row.evidenceRequired, true);
    const beforeReplay = await snapshot();
    assert.equal((await json<Movement>(await request(path(a.id), 'POST', body), 201)).id, issued.id);
    assert.deepEqual(await snapshot(), beforeReplay);
    await rule('inventory.issue_to_one_time_order', 'allow', 'selected', [a.id]);
    await denied(path(b.id), 'POST', { ...body, requestId: randomUUID() });
    for (const action of ['one_time_orders.read', 'one_time_orders.access', 'inventory.access']) {
      await rule(action, 'deny', action === 'inventory.access' ? 'all' : 'selected', action === 'inventory.access' ? [] : [a.id]);
      await denied(path(a.id), 'POST', body); // Even an idempotent replay must reauthorize.
      await revoke(action);
    }
    await revoke('inventory.issue_to_one_time_order');
    assert.equal((await json<Movement>(await request(path(a.id), 'POST', body), 201)).id, issued.id, 'Revoke restores inherited assignment access');
    await rule('inventory.issue_to_one_time_order', 'allow', 'all');
    await denied(path(b.id), 'POST', { ...body, requestId: randomUUID() });
    await prisma.oneTimeOrderAssignment.updateMany({ where: { oneTimeOrderId: a.id, userId: actorId }, data: { isActive: false } });
    await denied(path(a.id), 'POST', { ...body, requestId: randomUUID() });
    await prisma.oneTimeOrderAssignment.updateMany({ where: { oneTimeOrderId: a.id, userId: actorId }, data: { isActive: true } });
    await prisma.oneTimeOrder.update({ where: { id: a.id }, data: { status: 'completed' } });
    await denied(path(a.id), 'POST', { ...body, requestId: randomUUID() });
  });

  await t.test('return and adjustment selected grants preserve targets, prices and nonnegative stock; all does not bypass validation', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    const order = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-return-order`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'in_progress', createdByUserId: founderId,
      assignments: { create: { userId: actorId, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    await move(a.id, 'issue_to_one_time_order', { relatedOneTimeOrderId: order.id }, 'founder');
    const returnBody = movementInput(a.id, 'return', { relatedOneTimeOrderId: order.id });
    await denied('/inventory/movements', 'POST', returnBody);
    await rule('inventory.return', 'allow', 'selected', [a.id]);
    let before = await snapshot();
    const returned = await move(a.id, 'return', { relatedOneTimeOrderId: order.id });
    assert.equal((await assertNewMovement(before, returned.id, a.id, 10)).relatedOneTimeOrderId, order.id);
    await denied('/inventory/movements', 'POST', { ...returnBody, inventoryItemId: b.id });
    await revoke('inventory.return');
    await denied('/inventory/movements', 'POST', returnBody);
    await rule('inventory.return', 'allow', 'all');
    await denied('/inventory/movements', 'POST', movementInput(a.id, 'return'), 400);
    const adjustBody = movementInput(a.id, 'adjustment', { adjustmentDirection: 'increase' });
    await denied('/inventory/movements', 'POST', adjustBody);
    await rule('inventory.adjustment', 'allow', 'selected', [a.id]);
    before = await snapshot();
    const adjusted = await move(a.id, 'adjustment', { adjustmentDirection: 'increase' });
    await assertNewMovement(before, adjusted.id, a.id, 11);
    await denied('/inventory/movements', 'POST', { ...adjustBody, inventoryItemId: b.id });
    await rule('inventory.adjustment', 'deny', 'selected', [a.id]);
    await denied('/inventory/movements', 'POST', adjustBody);
    await revoke('inventory.adjustment');
    await denied('/inventory/movements', 'POST', adjustBody);
    await rule('inventory.adjustment', 'allow', 'all');
    await denied('/inventory/movements', 'POST', { ...adjustBody, adjustmentDirection: 'decrease', quantity: 1000 }, 400);
    await denied('/inventory/movements', 'POST', movementInput(a.id, 'adjustment'), 400);
  });

  await t.test('writeoff grant requests approval but cannot apply stock or approve; director applies once', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    const body = movementInput(a.id, 'writeoff', { quantity: 2 });
    await denied('/inventory/movements', 'POST', body);
    await rule('inventory.writeoff', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    const writeoff = await move(a.id, 'writeoff', { quantity: 2 });
    const row = await assertNewMovement(before, writeoff.id, a.id, 10);
    assert.equal(row.status, 'pending_approval');
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: row.id } });
    assert.equal(approval.approvalType, 'inventory_writeoff_confirmation');
    assert.equal(approval.status, 'pending');
    assert.equal(approval.createdByUserId, actorId);
    await denied('/inventory/movements', 'POST', { ...body, inventoryItemId: b.id });
    await denied(`/approvals/${approval.id}/approve`, 'POST', {});
    await revoke('inventory.writeoff');
    await denied('/inventory/movements', 'POST', body);
    await json(await request(`/approvals/${approval.id}/approve`, 'POST', {}, 'director'), 200);
    const applied = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.quantity.toNumber(), 2);
    assert.equal(applied.unitPriceSnapshot.toNumber(), 10);
    assert.equal((await card(a.id)).currentStock, 8);
    assert.equal((await card(b.id)).currentStock, 10);
    const resolved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    assert.equal(resolved.status, 'approved');
    assert.equal(resolved.resolvedByUserId, users.get('director'));
    const afterApproval = await snapshot();
    const repeat = await request(`/approvals/${approval.id}/approve`, 'POST', {}, 'director');
    assert.equal(repeat.status, 409, await repeat.text());
    assert.deepEqual(await snapshot(), afterApproval, 'Approval must not apply stock twice');
  });

  await t.test('history/report selected denies filter persisted A, all allow/revoke restore leadership baseline without writes', async () => {
    await reset();
    const a = await stocked();
    const b = await stocked();
    const historyPath = (id: string) => `/inventory/movements?inventoryItemId=${id}`;
    const history = (id: string) => request(historyPath(id), 'GET', undefined, 'founder').then((response) => json<{ items: Array<{ id: string }>; total: number }>(response, 200));
    const report = () => request('/inventory/reports/summary', 'GET', undefined, 'founder').then((response) => json<{ totalItems: number; movementCount: number; totalStockValueEstimate: number }>(response, 200));
    const before = await snapshot();
    assert.equal((await history(a.id)).total, 1);
    for (const suffix of ['movements.read', 'reports']) {
      await rule(`inventory.${suffix}`, 'deny', 'selected', [a.id], 'founder');
    }
    assert.deepEqual((await history(a.id)).items, []);
    assert.equal((await history(a.id)).total, 0);
    assert.equal((await history(b.id)).total, 1);
    const filtered = await report();
    await rule('inventory.reports', 'allow', 'selected', [a.id], 'founder');
    const full = await report();
    assert.equal(full.totalItems, filtered.totalItems + 1);
    assert.equal(full.movementCount, filtered.movementCount + 1);
    assert.equal(full.totalStockValueEstimate, filtered.totalStockValueEstimate + 100);
    await rule('inventory.movements.read', 'allow', 'selected', [a.id], 'founder');
    assert.equal((await history(a.id)).total, 1);
    for (const suffix of ['movements.read', 'reports']) {
      await rule(`inventory.${suffix}`, 'deny', 'all', [], 'founder');
    }
    assert.equal((await request(historyPath(b.id), 'GET', undefined, 'founder')).status, 403);
    assert.equal((await report()).totalItems, 0);
    for (const suffix of ['movements.read', 'reports']) {
      await rule(`inventory.${suffix}`, 'allow', 'all', [], 'founder');
      await revoke(`inventory.${suffix}`, 'founder');
    }
    assert.equal((await history(b.id)).total, 1);
    assert.deepEqual(await report(), full);
    assert.deepEqual(await snapshot(), before);
  });

  // Independent regression cases: do not accept a successful write just because
  // its response is later hidden. Main owns any runtime fix revealed by these.
  for (const operation of ['catalog.update', 'receipt'] as const) {
    await t.test(`cross-leaf inventory.read deny A dominates selected ${operation} allow before persistence`, async () => {
      await reset();
      const a = await stocked();
      const b = await stocked();
      await rule(`inventory.${operation}`, 'allow', 'selected', [a.id]);
      await rule('inventory.read', 'deny', 'selected', [a.id]);
      await denied(`/inventory/items/${a.id}`, 'GET', undefined, 404);
      await card(b.id);
      if (operation === 'catalog.update') {
        await denied(`/inventory/items/${a.id}`, 'PATCH', { expectedVersion: a.version, notes: 'Must not persist or leak hidden card' });
      } else {
        await denied('/inventory/movements', 'POST', movementInput(a.id, 'receipt', { unitPrice: 10 }));
      }
    });
  }
});
