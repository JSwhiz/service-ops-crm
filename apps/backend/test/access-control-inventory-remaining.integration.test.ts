import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'selected' | 'all';
type Correction = { id: string; mode: 'cancelled' | 'reversed'; compensatingMovementId?: string };

test('remaining inventory leaves use real corrections, independent photo approvals and scoped reference reads', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  for (const suffix of ['movement.correct', 'resolve_missing_photo', 'references.read']) {
    const action = ACCESS_ACTION_CATALOG.find((entry) => entry.code === `inventory.${suffix}`)!;
    assert.equal(action.manageable, true);
    assert.deepEqual([...action.allowedScopes].sort(), suffix === 'references.read' ? ['all'] : ['all', 'selected']);
  }
  assert.equal(ACCESS_ACTION_CATALOG.find((entry) => entry.code === 'inventory.resolve_missing_photo')!.constraint, 'director_only');

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const users = new Map<string, string>();
  const cookies = new Map<string, string>();
  for (const [login, password] of [['founder', 'founder123'], ['director', 'director123'], ['manager1', 'manager123']]) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [...users.values()] } } }), 0);
  const marker = `acl-inventory-remaining-${randomUUID()}`;
  const founderId = users.get('founder')!;
  const actorId = users.get('manager1')!;
  const itemIds: string[] = [];
  let sequence = 0;
  const request = (login: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = async (login: string, actionCode: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = []) => {
    const action = ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)!;
    assert.equal(action.manageable, true);
    assert.ok(action.allowedScopes.includes(scope));
    const userId = users.get(login)!;
    await prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (login: string, actionCode: string) => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: users.get(login)!, actionCode } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: [...users.values()] }, OR: [
    { actionCode: { startsWith: 'inventory.' } }, { actionCode: { in: ['objects.read', 'objects.access', 'one_time_orders.read', 'one_time_orders.access'] } },
  ] } });
  const objects: Array<{ id: string }> = [];
  const orders: Array<{ id: string }> = [];
  for (const suffix of ['A', 'B', 'hidden']) {
    const assignments = suffix === 'hidden' ? undefined : { create: { userId: actorId, assignmentRoleCode: 'manager', isActive: true } };
    objects.push(await prisma.object.create({ data: {
      name: `${marker}-${suffix}`, address: 'Isolated fixture', status: 'active', createdByUserId: founderId, assignments,
    } }));
    orders.push(await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-${suffix}`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'in_progress', createdByUserId: founderId,
      ...(suffix === 'hidden' ? {} : { assignments: { create: { userId: actorId, assignmentRoleCode: 'one_time_manager', isActive: true } } }),
    } }));
  }
  const fixture = async (login = 'founder', target: 'object' | 'order' = 'object', index = 0) => {
    const item = await json<{ id: string }>(await request('founder', '/inventory/items', 'POST', {
      name: `${marker}-${++sequence}`, category: 'ACL remaining fixture', unit: 'шт',
    }), 201);
    itemIds.push(item.id);
    const receipt = await json<{ id: string }>(await request('founder', '/inventory/movements', 'POST', {
      inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 10,
    }), 201);
    const path = target === 'object' ? `/objects/${objects[index].id}/inventory/issue` : `/one-time-orders/${orders[index].id}/inventory/issue`;
    const issue = await json<{ id: string }>(await request(login, path, 'POST', {
      inventoryItemId: item.id, quantity: 2, comment: marker,
    }), 201);
    return { itemId: item.id, issueId: issue.id, receiptId: receipt.id };
  };
  const correctPath = (id: string) => `/inventory/movements/${id}/correct`;
  const resolvePath = (id: string) => `/inventory/movements/${id}/resolve-missing-photo-approval`;
  const correctBody = { reason: 'ACL isolated correction' };
  const correct = (id: string, login = 'manager1') => request(login, correctPath(id), 'POST', correctBody).then((response) => json<Correction>(response, 201));
  const stock = async (id: string) => (await json<{ currentStock: number }>(await request('founder', `/inventory/items/${id}`), 200)).currentStock;
  const stored = (id: string) => prisma.inventoryMovement.findUniqueOrThrow({ where: { id } });
  const approval = (id: string) => prisma.approvalRequest.findFirstOrThrow({ where: { sourceEntityType: 'inventory_movement', sourceEntityId: id } });
  const audit = async (id: string, action: string, login: string) => assert.equal(await prisma.auditEvent.count({
    where: { entityId: id, action, actorUserId: users.get(login)! },
  }), 1);
  const snapshot = async () => {
    const [items, movements, approvals, audits, sourceObjects, sourceOrders, budgets, alerts, attachments, notifications] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: { in: ['inventory_item', 'inventory_movement', 'approval_request'] } }, orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objects.map((row) => row.id) } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      prisma.oneTimeOrder.findMany({ where: { id: { in: orders.map((row) => row.id) } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      prisma.objectBudgetPeriod.findMany({ orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
      prisma.objectBudgetAlert.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
      prisma.notification.findMany({ where: { entityType: { in: ['inventory_movement', 'approval_request', 'object', 'one_time_order'] } }, orderBy: { id: 'asc' } }),
    ]);
    return { items, movements, approvals, audits, sourceObjects, sourceOrders, budgets, alerts, attachments, notifications };
  };
  const denied = async (login: string, path: string, body: unknown = {}, status = 403, method = 'POST') => {
    const before = await snapshot();
    const response = await request(login, path, method, method === 'GET' ? undefined : body);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: denied request must not mutate catalog, ledger, approvals, audit, sources or budget; status=${response.status}`);
    assert.equal(response.status, status, text);
    return text;
  };

  await t.test('references.read all grant/deny/revoke uses existing cookie and never grants source visibility', async () => {
    const paths = ['/inventory/reference/objects', '/inventory/reference/one-time-orders'];
    const sources = [objects, orders];
    const read = (path: string) => request('manager1', path).then((response) => json<Array<{ id: string }>>(response, 200));
    const before = await snapshot();
    for (const [index, path] of paths.entries()) {
      const ids = (await read(path)).map((entry) => entry.id);
      assert.ok(ids.includes(sources[index][0].id));
      assert.ok(ids.includes(sources[index][1].id));
      assert.ok(!ids.includes(sources[index][2].id));
    }
    await rule('manager1', 'inventory.references.read', 'deny', 'all');
    for (const path of paths) await denied('manager1', path, undefined, 403, 'GET');
    await rule('manager1', 'inventory.references.read', 'allow', 'all');
    for (const [index, path] of paths.entries()) {
      const ids = (await read(path)).map((entry) => entry.id);
      assert.ok(ids.includes(sources[index][0].id));
      assert.ok(!ids.includes(sources[index][2].id), 'Global reference grant cannot expose an unassigned hidden source');
      const sourceAction = index === 0 ? 'objects.read' : 'one_time_orders.read';
      await rule('manager1', sourceAction, 'deny', 'selected', [sources[index][0].id]);
      const filtered = (await read(path)).map((entry) => entry.id);
      assert.ok(!filtered.includes(sources[index][0].id));
      assert.ok(filtered.includes(sources[index][1].id));
      await revoke('manager1', sourceAction);
    }
    await revoke('manager1', 'inventory.references.read');
    for (const path of paths) assert.ok((await read(path)).length > 0, 'Revoke restores baseline rather than manufacturing denial');
    await rule('manager1', 'inventory.references.read', 'allow', 'all');
    await rule('manager1', 'inventory.access', 'deny', 'all');
    for (const path of paths) await denied('manager1', path, undefined, 403, 'GET');
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('movement.correct selected denial, grant and revoke cancel an unconfirmed issue/approval once without rewriting prices', async () => {
    await reset();
    const a = await fixture();
    const b = await fixture('founder', 'object', 2);
    await denied('manager1', correctPath(b.issueId), correctBody);
    await rule('manager1', 'inventory.movement.correct', 'deny', 'selected', [a.itemId]);
    await denied('manager1', correctPath(a.issueId), correctBody);
    await rule('manager1', 'inventory.movement.correct', 'allow', 'selected', [a.itemId]);
    for (const [action, scope, ids] of [
      ['objects.read', 'selected', [objects[0].id]], ['objects.access', 'selected', [objects[0].id]], ['inventory.access', 'all', []],
    ] as const) {
      await rule('manager1', action, 'deny', scope, [...ids]);
      await denied('manager1', correctPath(a.issueId), correctBody);
      await revoke('manager1', action);
    }
    const before = await snapshot();
    const original = await stored(a.issueId);
    assert.equal(await stock(a.itemId), 8);
    assert.equal((await correct(a.issueId)).mode, 'cancelled');
    const cancelled = await stored(a.issueId);
    assert.deepEqual({ ...cancelled, status: original.status, updatedAt: original.updatedAt }, original);
    assert.equal(cancelled.status, 'cancelled');
    const cancelledApproval = await approval(a.issueId);
    assert.equal(cancelledApproval.status, 'cancelled');
    assert.equal(cancelledApproval.cancelledByUserId, actorId);
    assert.equal(cancelledApproval.decisionComment, correctBody.reason);
    assert.equal((await snapshot()).movements.length, before.movements.length);
    assert.deepEqual(await stored(b.issueId), before.movements.find((row) => row.id === b.issueId));
    assert.equal(await stock(a.itemId), 10);
    await audit(a.issueId, 'inventory.movement.cancelled', 'manager1');
    await revoke('manager1', 'inventory.movement.correct');
    const after = await snapshot();
    assert.equal((await correct(a.issueId)).mode, 'cancelled');
    assert.deepEqual(await snapshot(), after);
    await rule('manager1', 'inventory.movement.correct', 'deny', 'all');
    await denied('manager1', correctPath(a.issueId), correctBody);
  });

  await t.test('movement.correct all reverses an independently resolved issue with one exact compensating return', async () => {
    await reset();
    const a = await fixture();
    await json(await request('director', resolvePath(a.issueId), 'POST', {}), 200);
    const original = await stored(a.issueId);
    const originalApproval = await approval(a.issueId);
    await rule('manager1', 'inventory.movement.correct', 'allow', 'all');
    const before = await snapshot();
    const corrected = await correct(a.issueId);
    assert.equal(corrected.mode, 'reversed');
    assert.ok(corrected.compensatingMovementId);
    const reverse = await stored(corrected.compensatingMovementId);
    assert.equal(reverse.movementType, 'return');
    assert.equal(reverse.status, 'applied');
    assert.equal(reverse.inventoryItemId, a.itemId);
    assert.equal(reverse.relatedObjectId, original.relatedObjectId);
    assert.equal(reverse.relatedOneTimeOrderId, null);
    assert.equal(reverse.createdByUserId, actorId);
    assert.equal(reverse.evidenceRequired, false);
    assert.equal(reverse.quantity.toNumber(), original.quantity.toNumber());
    assert.equal(reverse.unitPriceSnapshot.toNumber(), original.unitPriceSnapshot.toNumber());
    assert.equal(reverse.totalAmountSnapshot.toNumber(), original.totalAmountSnapshot.toNumber());
    assert.deepEqual(await stored(a.issueId), original);
    assert.deepEqual(await approval(a.issueId), originalApproval);
    assert.deepEqual((await snapshot()).movements.filter((row) => row.id !== reverse.id), before.movements);
    assert.equal(await stock(a.itemId), 10);
    await audit(a.issueId, 'inventory.movement.reversed', 'manager1');
    const after = await snapshot();
    assert.deepEqual(await correct(a.issueId), corrected);
    assert.deepEqual(await snapshot(), after);
    // The all grant authorizes this source, but receipts remain unsupported
    // business inputs. Validation must reject them without touching the ledger.
    const unsupported = await denied('manager1', correctPath(a.receiptId), correctBody, 400);
    assert.equal((JSON.parse(unsupported) as { error: { message: string } }).error.message, 'Исправление доступно для выдачи на объект или заказ');
    // Keep the correction all grant intact: an independent item-read deny must
    // still stop the same request at authorization, before business validation.
    await rule('manager1', 'inventory.read', 'deny', 'selected', [a.itemId]);
    try {
      await denied('manager1', correctPath(a.receiptId), correctBody, 403);
    } finally {
      await revoke('manager1', 'inventory.read');
    }
  });

  await t.test('order correction respects source deny and selected leaf denial before cancelling the issue', async () => {
    await reset();
    const a = await fixture('founder', 'order');
    await rule('manager1', 'inventory.movement.correct', 'allow', 'selected', [a.itemId]);
    for (const action of ['one_time_orders.read', 'one_time_orders.access']) {
      await rule('manager1', action, 'deny', 'selected', [orders[0].id]);
      await denied('manager1', correctPath(a.issueId), correctBody);
      await revoke('manager1', action);
    }
    await rule('manager1', 'inventory.movement.correct', 'deny', 'selected', [a.itemId]);
    await denied('manager1', correctPath(a.issueId), correctBody);
    await revoke('manager1', 'inventory.movement.correct');
    const before = await snapshot();
    assert.equal((await correct(a.issueId)).mode, 'cancelled');
    assert.equal(await stock(a.itemId), 10);
    assert.equal((await snapshot()).movements.length, before.movements.length);
    await audit(a.issueId, 'inventory.movement.cancelled', 'manager1');
  });

  await t.test('photo resolution remains director-only despite all grant, requires object issue and preserves stock', async () => {
    await reset();
    const a = await fixture();
    const b = await fixture('founder', 'object', 1);
    for (const login of ['manager1', 'founder']) {
      await rule(login, 'inventory.resolve_missing_photo', 'allow', 'all');
      await denied(login, resolvePath(a.issueId));
    }
    await rule('director', 'inventory.resolve_missing_photo', 'deny', 'selected', [a.itemId]);
    await denied('director', resolvePath(a.issueId));
    await rule('director', 'inventory.resolve_missing_photo', 'allow', 'selected', [a.itemId]);
    for (const [action, scope, ids] of [
      ['objects.read', 'selected', [objects[0].id]], ['objects.access', 'selected', [objects[0].id]], ['inventory.access', 'all', []],
    ] as const) {
      await rule('director', action, 'deny', scope, [...ids]);
      await denied('director', resolvePath(a.issueId));
      await revoke('director', action);
    }
    const before = await snapshot();
    const original = await stored(a.issueId);
    const resolvedResponse = await json<{ id: string }>(await request('director', resolvePath(a.issueId), 'POST', {}), 200);
    assert.equal(resolvedResponse.id, a.issueId);
    const resolved = await stored(a.issueId);
    assert.ok(resolved.approvalBridgeResolvedAt);
    assert.equal(resolved.approvalBridgeResolvedByUserId, users.get('director'));
    assert.deepEqual({ ...resolved, approvalBridgeResolvedAt: original.approvalBridgeResolvedAt,
      approvalBridgeResolvedByUserId: original.approvalBridgeResolvedByUserId, updatedAt: original.updatedAt }, original);
    assert.equal(await stock(a.itemId), 8, 'Photo approval must not deduct the applied issue twice');
    const approved = await approval(a.issueId);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.resolvedByUserId, users.get('director'));
    assert.notEqual(approved.createdByUserId, approved.resolvedByUserId);
    assert.deepEqual(await stored(b.issueId), before.movements.find((row) => row.id === b.issueId));
    assert.equal((await snapshot()).movements.length, before.movements.length);
    await audit(a.issueId, 'inventory.missing_photo_approval.resolved', 'director');
    await audit(approved.id, 'approval.request.approved', 'director');
    await denied('director', resolvePath(a.issueId), {}, 409);
    await revoke('director', 'inventory.resolve_missing_photo');
    await json(await request('director', resolvePath(b.issueId), 'POST', {}), 200); // Revoke restores director baseline.
    const orderIssue = await fixture('founder', 'order');
    await rule('director', 'inventory.resolve_missing_photo', 'allow', 'all');
    await denied('director', resolvePath(orderIssue.issueId), {}, 400);
    await denied('director', resolvePath(orderIssue.receiptId), {}, 400);
    const another = await fixture();
    await rule('director', 'inventory.resolve_missing_photo', 'deny', 'all');
    await denied('director', resolvePath(another.issueId));
    await rule('director', 'inventory.resolve_missing_photo', 'allow', 'all');
    await json(await request('director', resolvePath(another.issueId), 'POST', {}), 200);
  });

  // User-requested regressions: do not relax 403 or accept post-persistence hiding.
  // A failure here is handed to main for runtime diagnosis, never worked around.
  for (const route of ['direct', 'shared'] as const) {
    await t.test(`${route} photo approval cannot be performed by the movement/approval author`, async () => {
      await reset();
      const a = await fixture('director');
      const ownApproval = await approval(a.issueId);
      assert.equal(ownApproval.createdByUserId, users.get('director'));
      await rule('director', 'inventory.resolve_missing_photo', 'allow', 'all');
      const path = route === 'direct' ? resolvePath(a.issueId) : `/approvals/${ownApproval.id}/approve`;
      await denied('director', path);
    });
  }
  for (const operation of ['movement.correct', 'resolve_missing_photo'] as const) {
    await t.test(`inventory.read deny A dominates selected ${operation} allow before ledger/approval persistence`, async () => {
      await reset();
      const a = await fixture();
      const b = await fixture('founder', 'object', 1);
      const login = operation === 'movement.correct' ? 'manager1' : 'director';
      await rule(login, `inventory.${operation}`, 'allow', 'selected', [a.itemId]);
      await rule(login, 'inventory.read', 'deny', 'selected', [a.itemId]);
      await denied(login, `/inventory/items/${a.itemId}`, undefined, 404, 'GET');
      await json(await request(login, `/inventory/items/${b.itemId}`), 200);
      await denied(login, operation === 'movement.correct' ? correctPath(a.issueId) : resolvePath(a.issueId), operation === 'movement.correct' ? correctBody : {});
    });
  }
});
