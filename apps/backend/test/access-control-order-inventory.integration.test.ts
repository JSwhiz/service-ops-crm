import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';

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
  const issue = (managerIndex: number, orderIndex: number, quantity = 2, requestId = randomUUID(), signal?: AbortSignal) => fetch(
    `${baseUrl}/api/v1/one-time-orders/${orders[orderIndex].id}/inventory/issue`, {
      method: 'POST', headers: { Cookie: cookies[managerIndex], 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ inventoryItemId: item.id, quantity, requestId, comment: 'Independent scoped issue' }),
    },
  );
  const issues = () => prisma.inventoryMovement.findMany({
    where: { inventoryItemId: item.id, movementType: 'issue_to_one_time_order' }, orderBy: { id: 'asc' },
  });
  const movementEffects = () => Promise.all([
    prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id }, orderBy: { id: 'asc' } }),
    prisma.auditEvent.findMany({ where: { actorUserId: managers[0].id }, orderBy: { id: 'asc' } }),
    prisma.approvalRequest.findMany({ where: { createdByUserId: managers[0].id }, orderBy: { id: 'asc' } }),
  ]);
  return { app, prisma, baseUrl, managers, orders, item, cookies, issue, issues, grant, movementEffects };
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
  const before = await f.movementEffects();
  const global = await fetch(`${f.baseUrl}/api/v1/inventory/movements`, {
    method: 'POST', headers: { Cookie: f.cookies[0], 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: f.item.id, movementType: 'adjustment', quantity: 1, adjustmentDirection: 'increase' }),
  });
  assert.equal(global.status, 403, await global.clone().text());
  assert.deepEqual(await f.movementEffects(), before);
});

for (const action of ['inventory.issue_to_one_time_order', 'inventory.receipt'] as const) {
  test(`INV-04: ${action} denies an in-flight request when a rule is saved while waiting on the item lock`, async (t) => {
    const receipt = action === 'inventory.receipt';
    const f = await dispatchFixture(t, { roleCode: receipt ? 'director' : 'operation_manager' });
    const manager = f.managers[0];
    const founder = await loginAndGetCookieHeader({ baseUrl: f.baseUrl, login: 'founder', password: 'founder123' });
    const saveDeny = async () => {
      const base = `${f.baseUrl}/api/v1/users-access/admin/users/${manager.id}`;
      const post = (suffix: string, body: object) => fetch(`${base}/${suffix}`, {
        method: 'POST', headers: { Cookie: founder, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
      });
      const payload = {
        expectedVersion: manager.accessVersion,
        reason: 'Revoke a write waiting on the item lock',
        changes: [{ actionCode: action, effect: 'deny', scope: receipt ? 'selected' : 'assigned',
          selectedIds: receipt ? [f.item.id] : [] }],
      };
      const preview = await post('preview', payload);
      assert.equal(preview.status, 201, await preview.clone().text());
      const { previewToken, previewHash } = await preview.json() as { previewToken: string; previewHash: string };
      const saved = await post('save', { ...payload, previewToken, previewHash });
      assert.equal(saved.status, 201, await saved.clone().text());
      const updated = await saved.json() as { accessVersion: number };
      assert.equal(updated.accessVersion, manager.accessVersion + 1);
    };
    const write = () => receipt ? fetch(`${f.baseUrl}/api/v1/inventory/movements`, {
      method: 'POST', headers: { Cookie: f.cookies[0], 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryItemId: f.item.id, movementType: 'receipt', quantity: 2, unitPrice: 100 }),
      signal: AbortSignal.timeout(25_000),
    }) : f.issue(0, 0, 2, randomUUID(), AbortSignal.timeout(25_000));
    const before = await f.movementEffects();
    // A separate client keeps the blocker transaction off the observer's pool.
    const blocker = new PrismaClient();
    t.after(() => blocker.$disconnect());
    let operation: Promise<Response> | undefined;

    try {
      await blocker.$transaction(async (tx) => {
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM inventory_items WHERE id = ${f.item.id} FOR UPDATE
        `;
        assert.deepEqual(locked, [{ id: f.item.id }]);

        operation = write();
        void operation.catch(() => undefined);
        const blockedShipments = () => f.prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT activity.pid
          FROM pg_stat_activity AS activity
          WHERE activity.datname = current_database()
            AND activity.wait_event_type = 'Lock'
            AND activity.query ~* '^[[:space:]]*SELECT'
            AND activity.query ~* 'FROM[[:space:]]+"?inventory_items"?[[:space:]]+WHERE'
            AND activity.query ~* 'FOR[[:space:]]+UPDATE'
            AND ${holder.pid}::integer = ANY(pg_blocking_pids(activity.pid))
        `;
        const deadline = Date.now() + 5_000;
        let waiter: { pid: number } | undefined;
        while (Date.now() < deadline) {
          [waiter] = await blockedShipments();
          if (waiter) break;
          await delay(25);
        }
        assert.ok(waiter, 'Authenticated operation never waited on the PostgreSQL item row lock');

        await saveDeny();
        assert.ok((await blockedShipments()).some(({ pid }) => pid === waiter.pid),
          'The same operation must still be blocked after the deny commits');
      }, { timeout: 12_000 });
    } catch (error) {
      // The blocker transaction has rolled back. Drain the request before teardown.
      await operation?.then((response) => response.body?.cancel()).catch(() => undefined);
      throw error;
    }

    assert.ok(operation);
    const response = await operation;
    assert.equal(response.status, 403, await response.text());
    assert.deepEqual(await f.movementEffects(), before, 'Denied operation must leave item, movements, audit and approvals unchanged');
  });
}

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

test('global issuer with an explicit all grant can issue to an unassigned order; selected deny keeps its control', async (t) => {
  const f = await dispatchFixture(t, { roleCode: 'director' });
  const userId = f.managers[0].id;
  const actionCode = 'inventory.issue_to_one_time_order';
  const target = f.orders[1];
  const assignments = () => f.prisma.oneTimeOrderAssignment.findMany({
    where: { oneTimeOrderId: target.id }, orderBy: { id: 'asc' },
  });
  const beforeAssignments = await assignments();
  assert.ok(beforeAssignments.every(assignment => assignment.userId !== userId));
  const rule = await f.prisma.userAccessRule.create({
    data: { userId, actionCode, effect: 'allow', scope: 'all' },
  });
  const allowed = await f.issue(0, 1, 1);
  assert.equal(allowed.status, 201, await allowed.clone().text());
  assert.deepEqual(await assignments(), beforeAssignments);
  const deniedBefore = await f.movementEffects();
  await f.prisma.userAccessRule.update({
    where: { id: rule.id }, data: { effect: 'deny', scope: 'selected', selectedIds: [target.id] },
  });
  assert.equal((await f.issue(0, 1, 1)).status, 403);
  assert.deepEqual(await f.movementEffects(), deniedBefore);
  assert.equal((await f.issue(0, 0, 1)).status, 201);
  assert.deepEqual(await assignments(), beforeAssignments);
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

for (const removalFirst of [true, false]) {
  test(`INV-04: assignment removal ${removalFirst ? 'before' : 'after'} an in-flight shipment preserves commit order`, async (t) => {
    const f = await dispatchFixture(t);
    const manager = f.managers[0];
    const founder = await loginAndGetCookieHeader({ baseUrl: f.baseUrl, login: 'founder', password: 'founder123' });
    const remove = () => fetch(
      `${f.baseUrl}/api/v1/one-time-orders/${f.orders[0].id}/managers/${manager.id}`,
      { method: 'DELETE', headers: { Cookie: founder }, signal: AbortSignal.timeout(20_000) },
    );
    const requestId = randomUUID();
    const before = await f.movementEffects();
    const blocker = new PrismaClient();
    t.after(() => blocker.$disconnect());
    const waitForBlockedQuery = async (holder: number, pattern: string) => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const [waiter] = await f.prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ~* ${pattern} AND ${holder}::integer = ANY(pg_blocking_pids(pid))
        `;
        if (waiter) return waiter.pid;
        await delay(25);
      }
      assert.fail(`No blocked query matching ${pattern}`);
    };
    const expectRemoved = async (response: Response) => {
      assert.equal(response.status, 200, await response.text());
    };
    let shipment: Promise<Response> | undefined;
    let removal: Promise<Response> | undefined;

    try {
      await blocker.$transaction(async (tx) => {
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (removalFirst) {
          await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${f.item.id} FOR UPDATE`;
        } else {
          // Reads can proceed, so the INSERT waits after the order access check.
          await tx.$executeRaw`LOCK TABLE inventory_movements IN SHARE MODE`;
        }
        shipment = f.issue(0, 0, 2, requestId, AbortSignal.timeout(20_000));
        void shipment.catch(() => undefined);
        const shipmentPid = await waitForBlockedQuery(holder.pid, removalFirst
          ? 'FROM[[:space:]]+"?inventory_items"?[[:space:]]+WHERE'
          : 'INSERT INTO .*inventory_movements');
        removal = remove();
        void removal.catch(() => undefined);
        if (removalFirst) {
          await expectRemoved(await removal);
        } else {
          await waitForBlockedQuery(shipmentPid, 'FROM[[:space:]]+"?one_time_orders"?[[:space:]]+WHERE');
        }
      }, { timeout: 12_000 });
    } catch (error) {
      await Promise.allSettled([shipment, removal]);
      throw error;
    }
    assert.ok(shipment);
    assert.ok(removal);
    const result = await shipment;
    assert.equal(result.status, removalFirst ? 403 : 201, await result.clone().text());
    if (!removalFirst) await expectRemoved(await removal);
    assert.equal((await f.issue(0, 0, 2, requestId)).status, 403, 'Retry after removal must be forbidden');
    assert.equal((await f.issues()).length, removalFirst ? 0 : 1);
    if (removalFirst) assert.deepEqual(await f.movementEffects(), before);
    else assert.equal((await f.issues())[0].quantity.toNumber(), 2);
  });
}

test('INV-04: assignment removed after commit returns only a shipment acknowledgement', { timeout: 20_000 }, async (t) => {
  const f = await dispatchFixture(t);
  const founder = await loginAndGetCookieHeader({ baseUrl: f.baseUrl, login: 'founder', password: 'founder123' });
  const service = f.app.get(InventoryService) as unknown as {
    loadPendingApprovalRequestsByMovementIds: (ids: string[]) => Promise<unknown>;
  };
  const original = service.loadPendingApprovalRequestsByMovementIds.bind(service);
  let reachedProjection!: () => void;
  let releaseProjection!: () => void;
  const projectionStarted = new Promise<void>((resolve) => { reachedProjection = resolve; });
  const projectionReleased = new Promise<void>((resolve) => { releaseProjection = resolve; });
  // The movement transaction is committed when the response reads pending approvals.
  t.mock.method(service, 'loadPendingApprovalRequestsByMovementIds', async (ids: string[]) => {
    reachedProjection();
    await projectionReleased;
    return original(ids);
  });

  const requestId = randomUUID();
  const shipment = f.issue(0, 0, 2, requestId, AbortSignal.timeout(15_000));
  try {
    await Promise.race([
      projectionStarted,
      shipment.then(() => assert.fail('Shipment responded before the projection barrier')),
    ]);
    const [movement] = await f.issues();
    assert.equal(movement.quantity.toNumber(), 2);
    const removed = await fetch(
      `${f.baseUrl}/api/v1/one-time-orders/${f.orders[0].id}/managers/${f.managers[0].id}`,
      { method: 'DELETE', headers: { Cookie: founder }, signal: AbortSignal.timeout(10_000) },
    );
    assert.equal(removed.status, 200, await removed.text());
    const denied = await fetch(`${f.baseUrl}/api/v1/one-time-orders/${f.orders[0].id}/inventory`, {
      headers: { Cookie: f.cookies[0] },
    });
    assert.equal(denied.status, 403, await denied.text());
  } finally {
    releaseProjection();
    await shipment.catch(() => undefined);
  }
  const result = await shipment;
  assert.equal(result.status, 201, await result.clone().text());
  assert.deepEqual(await result.json(), { outcome: 'saved_without_access' });
  assert.equal((await f.issue(0, 0, 2, requestId)).status, 403);
  assert.equal((await f.issues()).length, 1);
  assert.equal(await f.prisma.auditEvent.count({ where: {
    actorUserId: f.managers[0].id, action: 'inventory.movement.created',
  } }), 1);
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
