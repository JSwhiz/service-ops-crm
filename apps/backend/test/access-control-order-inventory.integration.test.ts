import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Published scoped endpoint: requestId is optional for legacy callers. Explicit
// UUID keys identify retries; omitted keys represent independent operations.
// Response retains flat inventoryItemId/oneTimeOrderId and nested identities.
// Baseline 986a5a1 permits a global issuer OR any active
// one_time_manager assignment, irrespective of system role. Removing an allow
// restores that baseline; explicit deny and loss of assignment revoke access.
// These are isolated test grants, never live user rights.
async function dispatchFixture(t: TestContext, options: { grant?: boolean; roleCode?: string } = {}) {
  assert.equal(usesIsolatedIntegrationDatabase(), true,
    'Run only through the isolated integration runner; never against a shared schema');
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: options.roleCode ?? 'operation_manager' } });
  const marker = `acl-dispatch-${randomUUID()}`;
  const managers = await Promise.all(['first', 'second'].map((suffix) => prisma.user.create({ data: {
    login: `${marker}-${suffix}`, fullName: `ACL dispatch ${suffix}`, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } },
  } })));
  const orders = await Promise.all(managers.map((manager, index) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${index}`, executionAddress: 'Isolated dispatch fixture', contactName: 'Fixture',
    status: 'in_progress', createdByUserId: founder.id,
    assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } })));
  const item = await prisma.inventoryItem.create({ data: {
    name: marker, category: 'Independent ACL fixture', unit: 'шт', currentUnitPrice: 75,
    createdByUserId: founder.id,
  } });
  await prisma.inventoryMovement.create({ data: {
    inventoryItemId: item.id, movementType: 'receipt', status: 'applied', quantity: 10,
    unitPriceSnapshot: 75, totalAmountSnapshot: 750, createdByUserId: founder.id,
  } });
  const cookies = await Promise.all(managers.map((manager) => loginAndGetCookieHeader({
    baseUrl, login: manager.login, password: 'manager123',
  })));
  const grant = () => prisma.userAccessRule.createMany({ data: managers.map((manager) => ({
    userId: manager.id, actionCode: 'inventory.issue_to_one_time_order', effect: 'allow', scope: 'assigned', selectedIds: [],
  })) });
  if (options.grant === true) await grant();
  const issue = (managerIndex: number, orderIndex: number, quantity = 2, requestId = randomUUID()) => fetch(
    `${baseUrl}/api/v1/one-time-orders/${orders[orderIndex].id}/inventory/issue`, {
      method: 'POST', headers: { Cookie: cookies[managerIndex], 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryItemId: item.id, quantity, requestId, comment: 'Independent scoped issue' }),
    },
  );
  const issues = () => prisma.inventoryMovement.findMany({
    where: { inventoryItemId: item.id, movementType: 'issue_to_one_time_order' }, orderBy: { id: 'asc' },
  });
  return { prisma, baseUrl, managers, orders, item, cookies, issue, issues, grant };
}

test('INV-01/02: baseline operation_managers issue into assigned orders without new grants', async (t) => {
  const f = await dispatchFixture(t, { grant: false });
  assert.equal(await f.prisma.userAccessRule.count({ where: { userId: { in: f.managers.map((manager) => manager.id) } } }), 0);
  for (const [managerIndex, orderIndex] of [[0, 1], [1, 0]]) {
    const denied = await f.issue(managerIndex, orderIndex);
    assert.equal(denied.status, 403, await denied.clone().text());
  }
  assert.equal((await f.issues()).length, 0, 'Denied cross-order calls must not create movements');
  for (const index of [0, 1]) {
    const response = await f.issue(index, index);
    assert.equal(response.status, 201, await response.clone().text());
    const body = await response.json() as { id: string; relatedOneTimeOrder: { id: string } | null };
    assert.equal(body.relatedOneTimeOrder?.id, f.orders[index].id);
    const movement = await f.prisma.inventoryMovement.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(movement.createdByUserId, f.managers[index].id);
    assert.equal(movement.relatedOneTimeOrderId, f.orders[index].id);
    assert.equal(movement.relatedObjectId, null);
    assert.equal(movement.quantity.toNumber(), 2);
    assert.equal(movement.unitPriceSnapshot.toNumber(), 75);
    assert.equal(movement.totalAmountSnapshot.toNumber(), 150);
  }
  assert.equal((await f.issues()).length, 2);
});

test('legacy manager keeps catalog read and assignment-based dispatch without a new override', async (t) => {
  const f = await dispatchFixture(t, { grant: false, roleCode: 'manager' });
  const catalog = await fetch(`${f.baseUrl}/api/v1/inventory/items`, { headers: { Cookie: f.cookies[0] } });
  assert.equal(catalog.status, 200, await catalog.clone().text());
  assert.equal((await f.issue(0, 1)).status, 403);
  const assigned = await f.issue(0, 0);
  assert.equal(assigned.status, 201, await assigned.clone().text());
  assert.equal((await f.issues()).length, 1);
});

test('legacy payload without requestId preserves flat fields and applies each independent call', async (t) => {
  const f = await dispatchFixture(t, { roleCode: 'manager' });
  const legacyBody = { inventoryItemId: f.item.id, quantity: 1, comment: 'Legacy request without client key' };
  const legacyIssue = (body: unknown = legacyBody) => fetch(
    `${f.baseUrl}/api/v1/one-time-orders/${f.orders[0].id}/inventory/issue`, {
      method: 'POST', headers: { Cookie: f.cookies[0], 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    },
  );
  const ids: string[] = [];
  for (const index of [0, 1]) {
    const response = await legacyIssue();
    assert.equal(response.status, 201, `Legacy call ${index}: ${await response.clone().text()}`);
    const body = await response.json() as {
      id: string; inventoryItemId: string; oneTimeOrderId: string; quantity: number;
      unitPriceSnapshot: number; totalAmountSnapshot: number; status: string;
      evidenceRequired: boolean; createdAt: string;
      inventoryItem: { id: string }; relatedOneTimeOrder: { id: string } | null;
    };
    assert.equal(body.inventoryItemId, f.item.id);
    assert.equal(body.oneTimeOrderId, f.orders[0].id);
    assert.equal(body.inventoryItem.id, body.inventoryItemId);
    assert.equal(body.relatedOneTimeOrder?.id, body.oneTimeOrderId);
    assert.equal(body.quantity, 1);
    assert.equal(body.unitPriceSnapshot, 75);
    assert.equal(body.totalAmountSnapshot, 75);
    assert.equal(body.status, 'applied');
    assert.equal(body.evidenceRequired, true);
    assert.ok(Number.isFinite(Date.parse(body.createdAt)));
    ids.push(body.id);
  }
  assert.notEqual(ids[0], ids[1], 'Omitting requestId must not deduplicate two independent operations by payload');
  const movements = await f.issues();
  assert.equal(movements.length, 2);
  assert.equal(movements.reduce((sum, row) => sum + row.quantity.toNumber(), 0), 2);
  const audit = await f.prisma.auditEvent.findMany({ where: {
    entityType: 'inventory_movement', entityId: { in: ids }, action: 'inventory.movement.created',
  } });
  assert.equal(audit.length, 2);
  const normalizedKeys = audit.map((entry) => {
    assert.ok(entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata));
    const requestId = entry.metadata.orderIssueRequestId;
    assert.equal(typeof requestId, 'string');
    assert.match(requestId as string, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return requestId;
  });
  assert.notEqual(normalizedKeys[0], normalizedKeys[1]);
  const invalid = await legacyIssue({ ...legacyBody, requestId: 'not-a-uuid' });
  assert.equal(invalid.status, 400);
  assert.equal((await f.issues()).length, 2);
});

test('INV-02/04: deleting allow preserves baseline; explicit deny revokes and reset restores the old cookie', async (t) => {
  const f = await dispatchFixture(t);
  assert.equal((await f.issue(0, 0, 1)).status, 201);
  await f.grant();
  assert.equal((await f.issue(0, 0, 1)).status, 201);
  await f.prisma.userAccessRule.deleteMany({ where: {
    userId: f.managers[0].id, actionCode: 'inventory.issue_to_one_time_order',
  } });
  assert.equal((await f.issue(0, 0, 1)).status, 201, 'Default keeps legacy assignment access');
  for (const scope of ['assigned', 'all']) {
    const before = await f.issues();
    const deny = await f.prisma.userAccessRule.create({ data: {
      userId: f.managers[0].id, actionCode: 'inventory.issue_to_one_time_order', effect: 'deny', scope,
    } });
    assert.equal((await f.issue(0, 0, 1)).status, 403, scope);
    assert.deepEqual(await f.issues(), before);
    await f.prisma.userAccessRule.delete({ where: { id: deny.id } });
    assert.equal((await f.issue(0, 0, 1)).status, 201, `Removing ${scope} deny restores inherited access`);
  }
  for (const actionCode of ['inventory.access', 'one_time_orders.access']) {
    const before = await f.issues();
    const deny = await f.prisma.userAccessRule.create({ data: {
      userId: f.managers[0].id, actionCode, effect: 'deny', scope: 'all',
    } });
    assert.equal((await f.issue(0, 0)).status, 403, actionCode);
    assert.deepEqual(await f.issues(), before);
    await f.prisma.userAccessRule.delete({ where: { id: deny.id } });
    assert.equal((await f.issue(0, 0, 1)).status, 201, `Removing ${actionCode} deny restores access`);
  }
  const before = await f.issues();
  const global = await fetch(`${f.baseUrl}/api/v1/inventory/movements`, {
    method: 'POST', headers: { Cookie: f.cookies[0], 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: f.item.id, movementType: 'adjustment', quantity: 1, adjustmentDirection: 'increase' }),
  });
  assert.equal(global.status, 403, await global.clone().text());
  assert.deepEqual(await f.issues(), before);
});

test('INV-05: retry and concurrent requests with one requestId apply one movement', async (t) => {
  const f = await dispatchFixture(t);
  const requestId = randomUUID();
  const responses = await Promise.all([f.issue(0, 0, 2, requestId), f.issue(0, 0, 2, requestId)]);
  for (const response of responses) assert.equal(response.status, 201, await response.clone().text());
  const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{ id: string }>;
  assert.equal(bodies[0].id, bodies[1].id);
  const replay = await f.issue(0, 0, 2, requestId);
  assert.equal(replay.status, 201);
  assert.equal(((await replay.json()) as { id: string }).id, bodies[0].id);
  const changedPayload = await f.issue(0, 0, 3, requestId);
  assert.equal(changedPayload.status, 409, await changedPayload.clone().text());
  const movements = await f.issues();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantity.toNumber(), 2);
  assert.equal(movements[0].totalAmountSnapshot.toNumber(), 150);
  const deny = await f.prisma.userAccessRule.create({ data: {
    userId: f.managers[0].id, actionCode: 'inventory.issue_to_one_time_order', effect: 'deny', scope: 'assigned',
  } });
  const revokedReplay = await f.issue(0, 0, 2, requestId);
  assert.equal(revokedReplay.status, 403, 'An idempotency replay cannot bypass a later revocation');
  assert.equal((await f.issues()).length, 1);
  await f.prisma.userAccessRule.delete({ where: { id: deny.id } });
  const restoredReplay = await f.issue(0, 0, 2, requestId);
  assert.equal(restoredReplay.status, 201);
  assert.equal(((await restoredReplay.json()) as { id: string }).id, bodies[0].id);
  assert.equal((await f.issues()).length, 1);
});

test('selected/all shipment grants cannot fabricate assignment even when order read is granted', async (t) => {
  const f = await dispatchFixture(t);
  await f.prisma.userAccessRule.create({ data: {
    userId: f.managers[0].id, actionCode: 'one_time_orders.read', effect: 'allow', scope: 'all',
  } });
  const readable = await fetch(`${f.baseUrl}/api/v1/one-time-orders/${f.orders[1].id}`, {
    headers: { Cookie: f.cookies[0] },
  });
  assert.equal(readable.status, 200, await readable.clone().text());
  for (const scope of ['selected', 'all']) {
    const allow = await f.prisma.userAccessRule.create({ data: {
      userId: f.managers[0].id, actionCode: 'inventory.issue_to_one_time_order', effect: 'allow', scope,
      selectedIds: scope === 'selected' ? [f.orders[1].id] : [],
    } });
    const denied = await f.issue(0, 1);
    assert.equal(denied.status, 403, `${scope}: ${await denied.clone().text()}`);
    assert.equal((await f.issues()).length, 0);
    await f.prisma.userAccessRule.delete({ where: { id: allow.id } });
  }
});

test('INV-02: removing assignment blocks the existing authenticated session without a movement', async (t) => {
  const f = await dispatchFixture(t);
  await f.prisma.oneTimeOrderAssignment.updateMany({ where: {
    oneTimeOrderId: f.orders[0].id, userId: f.managers[0].id,
  }, data: { isActive: false } });
  const response = await f.issue(0, 0);
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal((await f.issues()).length, 0);
});

test('INV-03: an assigned closed order cannot be dispatched from an old form', async (t) => {
  const f = await dispatchFixture(t);
  await f.prisma.oneTimeOrder.update({ where: { id: f.orders[0].id }, data: { status: 'completed' } });
  const response = await f.issue(0, 0);
  assert.ok([403, 409].includes(response.status),
    `Closed-order dispatch must be forbidden/conflict, got ${response.status}: ${await response.clone().text()}`);
  assert.equal((await f.issues()).length, 0);
});

test('INV-06: two assigned orders competing for stock cannot produce a negative balance', async (t) => {
  const f = await dispatchFixture(t);
  const responses = await Promise.all([f.issue(0, 0, 7), f.issue(1, 1, 7)]);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  const failure = responses.find((response) => response.status !== 201)!;
  assert.ok([400, 409].includes(failure.status), await failure.clone().text());
  const movements = await f.issues();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantity.toNumber(), 7);
  assert.equal(movements[0].totalAmountSnapshot.toNumber(), 525);
  assert.equal(movements[0].status, 'applied');
  assert.equal(10 - movements.reduce((sum, row) => sum + row.quantity.toNumber(), 0), 3);
});
