import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient, type InventoryMovement } from '@prisma/client';

import type { InventoryMovementListResponseDto } from '../src/modules/inventory/dto/inventory-movement-list-response.dto';
import type { InventoryMovementResponseDto } from '../src/modules/inventory/dto/inventory-movement-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('public inventory filters never grant source scope; item/parent denies cover paging, issue and both approval routes', async (t) => {
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
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const marker = `inventory-source-${randomUUID()}`;
  const makeActor = async (code: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    const user = await prisma.user.create({ data: {
      login: `${marker}-${code}`, fullName: `${marker}-${code}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } },
    } });
    return { ...user, cookie: await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' }) };
  };
  // HR has no inherited global inventory read/history. Deputy has the real
  // global history baseline. Director is independently authorized, not author.
  const scoped = await makeActor('hr');
  const wide = await makeActor('deputy_director');
  const issuer = await makeActor('manager');
  const director = await makeActor('director');
  type Actor = typeof scoped;
  const request = (actor: Actor, path: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: actor.cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    assert.equal(response.status, expected, await response.clone().text());
    return await response.json() as T;
  };
  const rule = async (actor: Actor, actionCode: string, effect: 'allow' | 'deny', ids?: string[]) => {
    const scope = ids ? 'selected' : 'all';
    assert.ok(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)?.allowedScopes.includes(scope));
    const saved = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds: ids ?? [] }, update: { effect, scope, selectedIds: ids ?? [] },
    });
    ruleIds.add(saved.id);
    return saved;
  };
  const revoke = async (actor: Actor, actionCode: string) => {
    const saved = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    ruleIds.delete(saved.id);
  };
  const objects = await Promise.all(['A', 'B'].map((label) => prisma.object.create({ data: {
    name: `${marker}-object-${label}`, address: 'Isolated source boundary', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: scoped.id, assignmentRoleCode: 'manager', isActive: true } },
  } })));
  const orders = await Promise.all(['A', 'B'].map((label) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-order-${label}`, executionAddress: 'Isolated source order', status: 'in_progress',
    contactName: 'Fixture', createdByUserId: founder.id,
    assignments: { create: { userId: scoped.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } })));
  const items = await Promise.all(['A', 'B'].map((label) => prisma.inventoryItem.create({ data: {
    name: `${marker}-item-${label}`, category: 'Source boundary fixture', unit: 'шт', currentUnitPrice: 10, createdByUserId: founder.id,
  } })));
  const [itemA, itemB] = items;
  const seededMovements: InventoryMovement[] = [];
  // Distinct timestamps deliberately put selected-denied A sources before B.
  // Each item retains receipt and unrelated parent controls after filtering.
  for (const [itemIndex, item] of items.entries()) {
    for (const [index, source] of ['receipt', 'object-B', 'order-B', 'object-A', 'order-A'].entries()) {
      seededMovements.push(await prisma.inventoryMovement.create({ data: {
        inventoryItemId: item.id, movementType: source === 'receipt' ? 'receipt' : source.startsWith('object') ? 'issue_to_object' : 'issue_to_one_time_order',
        status: 'applied', quantity: source === 'receipt' ? 100 : 1, unitPriceSnapshot: 10,
        totalAmountSnapshot: source === 'receipt' ? 1000 : 10, createdByUserId: founder.id,
        comment: `${marker}-${itemIndex}-${source}`,
        relatedObjectId: source.startsWith('object') ? objects[source.endsWith('A') ? 0 : 1]!.id : null,
        relatedOneTimeOrderId: source.startsWith('order') ? orders[source.endsWith('A') ? 0 : 1]!.id : null,
        createdAt: new Date(Date.UTC(2033, 0, index + 1, 12, itemIndex)),
      } }));
    }
  }
  const itemIds = items.map(({ id }) => id);
  const objectIds = objects.map(({ id }) => id);
  const orderIds = orders.map(({ id }) => id);
  const capture = async () => ({
    items: await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: 'asc' } }),
    objectAssignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectLogs: await prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    budgets: await prisma.objectBudgetPeriod.findMany({ where: { objectId: { in: objectIds } }, orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
    alerts: await prisma.objectBudgetAlert.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ where: { entityType: { in: ['inventory_movement', 'approval_request', 'object'] } }, orderBy: { id: 'asc' } }),
  });
  const rejected = async (actor: Actor, path: string, body?: unknown, expected = 403) => {
    const before = await capture();
    const response = await request(actor, path, body);
    const text = await response.text();
    assert.deepEqual(await capture(), before, `Denied ${path} must have zero stock/ledger/source/approval/audit effects; HTTP ${response.status}`);
    assert.equal(response.status, expected, text);
  };
  type SavedMovement = (typeof seededMovements)[number];
  const pageCheck = async (actor: Actor, expected: SavedMovement[], filters: Record<string, string> = {}) => {
    const before = await capture();
    const sorted = [...expected].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    for (let page = 1; page <= sorted.length + 1; page++) {
      const params = new URLSearchParams({ dateFrom: '2033-01-01T00:00:00Z', dateTo: '2033-01-31T23:59:59Z', ...filters, page: String(page), limit: '1' });
      const response = await request(actor, `/inventory/movements?${params}`);
      assert.equal(response.status, 200, `A real positive movement grant must reach this public endpoint (no legacy-controller bypass): ${await response.clone().text()}`);
      const result = await response.json() as InventoryMovementListResponseDto;
      assert.equal(result.total, sorted.length, 'Apply every item/parent deny before count and pagination');
      assert.equal(result.totalPages, sorted.length);
      assert.equal(result.page, page);
      assert.equal(result.limit, 1);
      assert.deepEqual(result.items.map(({ id }) => id), sorted.slice(page - 1, page).map(({ id }) => id));
      for (const entry of result.items) {
        const persisted = sorted.find(({ id }) => id === entry.id)!;
        assert.equal(entry.inventoryItem.id, persisted.inventoryItemId);
        assert.equal(entry.relatedObject?.id ?? null, persisted.relatedObjectId);
        assert.equal(entry.relatedOneTimeOrder?.id ?? null, persisted.relatedOneTimeOrderId);
        assert.equal(entry.quantity, Number(persisted.quantity));
        assert.equal(entry.unitPriceSnapshot, Number(persisted.unitPriceSnapshot));
      }
      const wire = JSON.stringify(result.items);
      for (const hidden of seededMovements.filter(({ id }) => !expected.some((row) => row.id === id))) {
        assert.equal(wire.includes(hidden.id), false);
        assert.equal(wire.includes(hidden.comment!), false);
      }
      for (const item of items.filter(({ id }) => !expected.some((row) => row.inventoryItemId === id))) {
        assert.equal(wire.includes(item.id), false);
        assert.equal(wire.includes(item.name), false);
      }
      for (const object of objects.filter(({ id }) => !expected.some((row) => row.relatedObjectId === id))) {
        assert.equal(wire.includes(object.id), false);
        assert.equal(wire.includes(object.name), false);
      }
      for (const order of orders.filter(({ id }) => !expected.some((row) => row.relatedOneTimeOrderId === id))) {
        assert.equal(wire.includes(order.id), false);
        assert.equal(wire.includes(order.title), false);
      }
    }
    assert.deepEqual(await capture(), before);
  };

  await t.test('forged public oneTimeOrderId is only a filter, never a scoped baseline or item-B history grant', async (suite) => {
    suite.after(reset);
    await rule(scoped, 'inventory.access', 'allow');
    await rule(scoped, 'inventory.read', 'allow', [itemA.id]);
    for (const order of orders) await rejected(scoped, `/inventory/movements?oneTimeOrderId=${order.id}`);
    await rule(scoped, 'inventory.movements.read', 'allow', [itemA.id]);
    const onlyA = seededMovements.filter(({ inventoryItemId }) => inventoryItemId === itemA.id);
    await pageCheck(scoped, onlyA);
    for (const order of orders) {
      await pageCheck(scoped, onlyA.filter(({ relatedOneTimeOrderId }) => relatedOneTimeOrderId === order.id), { oneTimeOrderId: order.id });
      await pageCheck(scoped, [], { oneTimeOrderId: order.id, inventoryItemId: itemB.id });
    }
    await pageCheck(scoped, [], { oneTimeOrderId: randomUUID() });
    await revoke(scoped, 'inventory.movements.read');
    await rejected(scoped, `/inventory/movements?oneTimeOrderId=${orders[0]!.id}`);
  });

  await t.test('inventory.read selected item deny filters movement rows/count without hiding control item B', async (suite) => {
    suite.after(reset);
    await pageCheck(wide, seededMovements);
    await rule(wide, 'inventory.movements.read', 'allow');
    await rule(wide, 'inventory.read', 'deny', [itemA.id]);
    const onlyB = seededMovements.filter(({ inventoryItemId }) => inventoryItemId === itemB.id);
    await pageCheck(wide, onlyB);
    await pageCheck(wide, [], { inventoryItemId: itemA.id });
    await pageCheck(wide, onlyB.filter(({ relatedOneTimeOrderId }) => relatedOneTimeOrderId === orders[0]!.id), { oneTimeOrderId: orders[0]!.id });
    await revoke(wide, 'inventory.read');
    await pageCheck(wide, seededMovements);
  });

  for (const module of ['objects', 'one_time_orders']) for (const suffix of ['read', 'access']) {
    await t.test(`${module}.${suffix} actual selected/all parent deny subtracts related rows before paging, not just link capabilities`, async (suite) => {
      suite.after(reset);
      await rule(wide, 'inventory.read', 'allow');
      await rule(wide, 'inventory.movements.read', 'allow');
      await pageCheck(wide, seededMovements);
      const parentId = module === 'objects' ? objects[0]!.id : orders[0]!.id;
      const field = module === 'objects' ? 'relatedObjectId' : 'relatedOneTimeOrderId';
      await rule(wide, `${module}.${suffix}`, 'deny', [parentId]);
      const retained = seededMovements.filter((row) => row[field] !== parentId);
      await pageCheck(wide, retained);
      await pageCheck(wide, [], module === 'objects' ? { objectId: parentId } : { oneTimeOrderId: parentId });
      await rule(wide, `${module}.${suffix}`, 'deny');
      await pageCheck(wide, seededMovements.filter((row) => row[field] === null));
      await revoke(wide, `${module}.${suffix}`);
      await pageCheck(wide, seededMovements);
    });
  }

  await t.test('inventory.access all deny cannot be bypassed by another positive leaf, including the read fallback', async (suite) => {
    suite.after(reset);
    for (const leaf of ['inventory.read', 'inventory.movements.read', 'inventory.reports', 'inventory.catalog.create']) {
      await rule(wide, leaf, 'allow');
      await rule(wide, 'inventory.access', 'deny');
      await rejected(wide, '/inventory/items');
      await rejected(wide, `/inventory/movements?oneTimeOrderId=${orders[0]!.id}`);
      await rejected(wide, '/inventory/reports/summary');
      await revoke(wide, 'inventory.access');
      await pageCheck(wide, seededMovements);
      await revoke(wide, leaf);
    }
  });

  const issue = (objectId: string) => `/objects/${objectId}/inventory/issue`;
  const issueBody = { inventoryItemId: itemA.id, quantity: 1, comment: `${marker}-actual-issue` };
  const approvalMovementIds: string[] = [];
  await t.test('selected object issue grant requires separate positive object read, not an automatic assignment', async (suite) => {
    suite.after(reset);
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: { in: objectIds }, userId: issuer.id } }), 0);
    const objectResponse = await request(issuer, `/objects/${objects[0]!.id}`);
    assert.ok([403, 404].includes(objectResponse.status), await objectResponse.text());
    await rule(issuer, 'inventory.issue_to_object', 'allow', [objects[0]!.id]);
    await rejected(issuer, issue(objects[0]!.id), issueBody);
    await rejected(issuer, '/inventory/movements', { ...issueBody, movementType: 'issue_to_object', relatedObjectId: objects[0]!.id });
    await rule(issuer, 'objects.read', 'allow', objectIds);
    await json(await request(issuer, `/objects/${objects[0]!.id}`));
    await rejected(issuer, issue(objects[1]!.id), issueBody); // Read B is not an issue grant on B.
    const before = await capture();
    const created = await json<InventoryMovementResponseDto>(await request(issuer, issue(objects[0]!.id), issueBody), 201);
    approvalMovementIds.push(created.id);
    const after = await capture();
    assert.equal(after.movements.length, before.movements.length + 1);
    assert.deepEqual(after.movements.filter(({ id }) => id !== created.id), before.movements);
    const movement = after.movements.find(({ id }) => id === created.id)!;
    assert.equal(movement.inventoryItemId, itemA.id);
    assert.equal(movement.relatedObjectId, objects[0]!.id);
    assert.equal(movement.relatedOneTimeOrderId, null);
    assert.equal(movement.createdByUserId, issuer.id);
    assert.equal(movement.status, 'applied');
    assert.equal(Number(movement.unitPriceSnapshot), 10);
    assert.equal(Number(movement.totalAmountSnapshot), 10);
    assert.equal(movement.requiresApprovalBridge, true);
    assert.equal(created.approvalRequest?.status, 'pending');
    assert.deepEqual(after.objectAssignments, before.objectAssignments, 'A personal grant must never manufacture an assignment');
    assert.deepEqual(after.orderAssignments, before.orderAssignments);
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: { in: objectIds }, userId: issuer.id } }), 0);
    await revoke(issuer, 'objects.read');
    await rejected(issuer, issue(objects[0]!.id), issueBody);
    await rejected(issuer, '/inventory/movements', { ...issueBody, movementType: 'issue_to_object', relatedObjectId: objects[0]!.id });
    await rule(issuer, 'objects.read', 'allow', [objects[0]!.id]);
    const second = await json<InventoryMovementResponseDto>(await request(issuer, issue(objects[0]!.id), issueBody), 201);
    approvalMovementIds.push(second.id);
  });

  await t.test('item read deny blocks independently authorized non-author director on direct and shared approval, then both succeed after revoke', async (suite) => {
    suite.after(reset);
    assert.equal(approvalMovementIds.length, 2, 'Requires two actual HTTP-created pending bridges, not invented approval IDs');
    const approvals = await Promise.all(approvalMovementIds.map((sourceEntityId) => prisma.approvalRequest.findFirstOrThrow({ where: {
      sourceEntityType: 'inventory_movement', sourceEntityId, status: 'pending',
    } })));
    for (const approval of approvals) {
      assert.equal(approval.createdByUserId, issuer.id);
      assert.notEqual(approval.createdByUserId, director.id);
    }
    await rule(director, 'inventory.read', 'deny', [itemA.id]);
    for (const [index, movementId] of approvalMovementIds.entries()) {
      await rejected(director, `/inventory/movements/${movementId}/resolve-missing-photo-approval`, {});
      await rejected(director, `/approvals/${approvals[index]!.id}/approve`, {});
    }
    await revoke(director, 'inventory.read');
    const before = await capture();
    await json(await request(director, `/inventory/movements/${approvalMovementIds[0]!}/resolve-missing-photo-approval`, {}));
    await json(await request(director, `/approvals/${approvals[1]!.id}/approve`, {}));
    const after = await capture();
    assert.deepEqual(after.movements.map(({ id }) => id), before.movements.map(({ id }) => id));
    assert.deepEqual(after.items, before.items);
    for (const [index, movementId] of approvalMovementIds.entries()) {
      const movement = after.movements.find(({ id }) => id === movementId)!;
      assert.ok(movement.approvalBridgeResolvedAt);
      assert.equal(movement.approvalBridgeResolvedByUserId, director.id);
      assert.equal(movement.status, 'applied');
      const approved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvals[index]!.id } });
      assert.equal(approved.status, 'approved');
      assert.equal(approved.resolvedByUserId, director.id);
    }
    assert.deepEqual(after.objectAssignments, before.objectAssignments);
    assert.deepEqual(after.orderAssignments, before.orderAssignments);
  });
  for (const actor of [scoped, wide, issuer, director]) {
    assert.equal(await prisma.userRole.count({ where: { userId: actor.id } }), 1);
    assert.equal(await prisma.userPermission.count({ where: { userId: actor.id } }), 0);
  }
  // Main owns execution. Public HTTP positive controls deliberately retain all
  // real guards. No role-only gate bypass, fabricated stock, automatic assignment,
  // browser/admin-save, concurrent approval or delivery proof is claimed.
});
