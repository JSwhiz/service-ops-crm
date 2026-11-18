import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { InventoryObjectReferenceResponseDto, InventoryOrderReferenceResponseDto } from '../src/modules/inventory/dto/inventory-reference-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('inventory form references describe generic POST targets, not scoped aliases', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => { try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-inventory-form-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, expected, body);
    return JSON.parse(body) as T;
  };
  const object = (label: string, owner = founder.id) => prisma.object.create({ data: {
    name: `${marker}-${label}`, address: 'Isolated generic form target', status: 'active', createdByUserId: owner,
  } });
  const a = await object('A');
  const b = await object('B');
  const hr = await object('HR');
  const owned = await object('owned', actor.id);
  const objects = [a, b, hr, owned];
  const order = (label: string, assigned = false) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${label}`, executionAddress: 'Isolated order target', contactName: 'Fixture',
    status: 'in_progress', createdByUserId: founder.id,
    ...(assigned ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true } } } : {}),
  } });
  const orderA = await order('order-A', true);
  const orderB = await order('order-B');
  const hiddenOrder = await order('order-hidden');
  const orders = [orderA, orderB, hiddenOrder];
  const item = await json<{ id: string }>(await request('/inventory/items', 'POST', {
    name: marker, category: marker, unit: 'шт',
  }, founderCookie), 201);
  await json(await request('/inventory/movements', 'POST', {
    inventoryItemId: item.id, movementType: 'receipt', quantity: 100, unitPrice: 19,
  }, founderCookie), 201);
  const rule = (actionCode: string, effect: 'allow' | 'deny', ids: string[], scope: 'selected' | 'all' | 'own' | 'assigned' = 'selected') => {
    const definition = ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode);
    assert.ok(definition);
    assert.equal(definition.manageable, true);
    assert.ok(definition.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds: ids }, update: { effect, scope, selectedIds: ids } });
  };
  const revoke = (actionCode: string) => prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
  const snapshot = async () => ({
    items: await prisma.inventoryItem.findMany({ where: { id: item.id }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ where: { objectId: { in: objects.map(row => row.id) } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objects.map(row => row.id) } }, orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orders.map(row => row.id) } }, orderBy: { id: 'asc' } }),
    budgets: await prisma.objectBudgetPeriod.findMany({ orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
    alerts: await prisma.objectBudgetAlert.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: { id: true, notificationId: true, recipientUserId: true, createdAt: true } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
  });
  const objectPath = '/inventory/reference/objects';
  const orderPath = '/inventory/reference/one-time-orders';
  const objectRefs = async () => {
    const before = await snapshot();
    const result = await json<InventoryObjectReferenceResponseDto[]>(await request(objectPath), 200);
    assert.deepEqual(await snapshot(), before, 'Reference reads do not change business data or audit');
    for (const row of result) {
      assert.deepEqual(Object.keys(row).sort(), ['capabilities', 'id', 'name', 'status']);
      assert.equal(typeof row.capabilities.canIssueToObject, 'boolean');
    }
    return result;
  };
  const orderRefs = async (session = cookie) => {
    const before = await snapshot();
    const result = await json<InventoryOrderReferenceResponseDto[]>(await request(orderPath, 'GET', undefined, session), 200);
    assert.deepEqual(await snapshot(), before);
    for (const row of result) {
      assert.deepEqual(Object.keys(row).sort(), ['capabilities', 'id', 'status', 'title']);
      assert.equal(typeof row.capabilities.canIssueToOneTimeOrder, 'boolean');
      assert.equal(typeof row.capabilities.canLinkMovement, 'boolean');
    }
    return result;
  };
  const issueObject = (id: string) => ({ inventoryItemId: item.id, movementType: 'issue_to_object', relatedObjectId: id, quantity: 1 });
  const issueOrder = (id: string) => ({ inventoryItemId: item.id, movementType: 'issue_to_one_time_order', relatedOneTimeOrderId: id, quantity: 1 });
  const returnOrder = (id: string) => ({ inventoryItemId: item.id, movementType: 'return', relatedOneTimeOrderId: id, quantity: 1, evidenceRequired: false });
  const denied = async (body: unknown, path = '/inventory/movements') => {
    const before = await snapshot();
    const response = await request(path, 'POST', body);
    assert.equal(response.status, 403, await response.text());
    assert.deepEqual(await snapshot(), before, 'Forbidden generic/scoped target must not change stock, prices, budgets, approvals, audit or side effects');
  };
  const created = async (body: unknown, targetId: string, kind: 'object' | 'order', session = cookie) => {
    const result = await json<{ id: string }>(await request('/inventory/movements', 'POST', body, session), 201);
    const saved = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(saved.inventoryItemId, item.id);
    assert.equal(kind === 'object' ? saved.relatedObjectId : saved.relatedOneTimeOrderId, targetId);
    assert.equal(saved.createdByUserId, session === cookie ? actor.id : founder.id);
    return saved;
  };

  await t.test('object selected grants require positive read; SQL filters sources before projection', async () => {
    await rule('inventory.issue_to_object', 'allow', [a.id]);
    assert.ok(!(await objectRefs()).some(row => row.id === a.id));
    await denied(issueObject(a.id));
    await rule('objects.read', 'allow', [a.id, b.id]);
    const refs = await objectRefs();
    assert.equal(refs.find(row => row.id === a.id)?.capabilities.canIssueToObject, true);
    assert.equal(refs.find(row => row.id === b.id)?.capabilities.canIssueToObject, false);
    assert.ok(!refs.some(row => row.id === hr.id));
    await created(issueObject(a.id), a.id, 'object');
    await denied(issueObject(b.id));
    await revoke('inventory.issue_to_object');
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, false);
    await denied(issueObject(a.id));
    await rule('objects.inventory.issue', 'allow', [a.id]);
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, false, 'A scoped object issue alias is not generic inventory authority');
    await denied(issueObject(a.id));
    await revoke('objects.inventory.issue');
  });
  await t.test('generic object parent deny wins over its valid positive inventory grant before persistence', async () => {
    await rule('inventory.issue_to_object', 'allow', [a.id]);
    await rule('objects.inventory.issue', 'deny', [a.id]);
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, false);
    // This is the pre-fix generic-parent regression. It is not a claim that
    // the old runtime was executed here; main runs the isolated HTTP suite.
    await denied(issueObject(a.id));
    await denied({ inventoryItemId: item.id, quantity: 1 }, `/objects/${a.id}/inventory/issue`);
    await revoke('objects.inventory.issue');
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, true);
    for (const parent of ['objects.read', 'objects.access']) {
      await rule(parent, 'deny', [a.id]);
      assert.ok(!(await objectRefs()).some(row => row.id === a.id));
      await denied(issueObject(a.id));
      await revoke(parent);
      if (parent === 'objects.read') await rule('objects.read', 'allow', [a.id, b.id]);
    }
    await rule('inventory.read', 'deny', [item.id]);
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, true, 'Target capability does not override the separately selected item read guard');
    await denied(issueObject(a.id));
    await revoke('inventory.read');
  });
  await t.test('object owner/active assignment contexts and HR basic reads are actual generic targets', async () => {
    await rule('inventory.issue_to_object', 'allow', [], 'own');
    assert.equal((await objectRefs()).find(row => row.id === owned.id)?.capabilities.canIssueToObject, true);
    await created(issueObject(owned.id), owned.id, 'object');
    await rule('inventory.issue_to_object', 'allow', [], 'assigned');
    const assignment = await prisma.objectAssignment.create({ data: { objectId: a.id, userId: actor.id, assignmentRoleCode: 'manager', isActive: true } });
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, true);
    await created(issueObject(a.id), a.id, 'object');
    await prisma.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
    assert.equal((await objectRefs()).find(row => row.id === a.id)?.capabilities.canIssueToObject, false);
    await denied(issueObject(a.id));
    await rule('objects.view_hr', 'allow', [hr.id]);
    await rule('inventory.issue_to_object', 'allow', [hr.id]);
    assert.equal((await objectRefs()).find(row => row.id === hr.id)?.capabilities.canIssueToObject, true);
    await created(issueObject(hr.id), hr.id, 'object');
    await revoke('objects.view_hr');
    assert.ok(!(await objectRefs()).some(row => row.id === hr.id));
    await denied(issueObject(hr.id));
  });
  await t.test('nonglobal order issuer stays generic-forbidden while scoped request-ID issuance remains valid', async () => {
    await rule('one_time_orders.read', 'allow', [orderA.id, orderB.id]);
    await rule('inventory.issue_to_one_time_order', 'allow', [orderA.id]);
    const refs = await orderRefs();
    assert.equal(refs.find(row => row.id === orderA.id)?.capabilities.canIssueToOneTimeOrder, false);
    assert.equal(refs.find(row => row.id === orderA.id)?.capabilities.canLinkMovement, true);
    assert.equal(refs.find(row => row.id === orderB.id)?.capabilities.canLinkMovement, true);
    assert.ok(!refs.some(row => row.id === hiddenOrder.id));
    await denied(issueOrder(orderA.id));
    await denied(issueOrder(orderB.id));
    const requestId = randomUUID();
    const scoped = await json<{ id: string }>(await request(`/one-time-orders/${orderA.id}/inventory/issue`, 'POST', {
      inventoryItemId: item.id, quantity: 1, requestId,
    }), 201);
    assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: scoped.id } })).relatedOneTimeOrderId, orderA.id);
  });
  await t.test('generic order link needs positive read, preserves section denies, but no new positive inventory-read grant', async () => {
    await rule('inventory.return', 'allow', [item.id]);
    assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: 'one_time_orders.inventory.read' } }), 0);
    assert.equal((await orderRefs()).find(row => row.id === orderB.id)?.capabilities.canLinkMovement, true);
    await created(returnOrder(orderB.id), orderB.id, 'order');
    await rule('one_time_orders.inventory.read', 'deny', [orderB.id]);
    assert.equal((await orderRefs()).find(row => row.id === orderB.id)?.capabilities.canLinkMovement, false);
    await denied(returnOrder(orderB.id));
    await revoke('one_time_orders.inventory.read');
    await rule('one_time_orders.read', 'allow', [orderA.id]);
    assert.ok(!(await orderRefs()).some(row => row.id === orderB.id));
    await denied(returnOrder(orderB.id));
    await rule('one_time_orders.read', 'allow', [orderA.id, orderB.id]);
    await rule('inventory.read', 'deny', [item.id]);
    await denied(returnOrder(orderB.id));
    await revoke('inventory.read');
    await created(returnOrder(orderB.id), orderB.id, 'order');
  });
  await t.test('global generic order flags match issuance; terminal orders keep link behavior but not issue authority', async () => {
    const refs = await orderRefs(founderCookie);
    assert.equal(refs.find(row => row.id === orderB.id)?.capabilities.canIssueToOneTimeOrder, true);
    await created(issueOrder(orderB.id), orderB.id, 'order', founderCookie);
    await prisma.oneTimeOrder.update({ where: { id: orderB.id }, data: { status: 'completed' } });
    const closed = (await orderRefs(founderCookie)).find(row => row.id === orderB.id);
    assert.ok(closed);
    assert.deepEqual(closed.capabilities, { canIssueToOneTimeOrder: false, canLinkMovement: true });
    const before = await snapshot();
    const response = await request('/inventory/movements', 'POST', issueOrder(orderB.id), founderCookie);
    assert.equal(response.status, 403, await response.text());
    assert.deepEqual(await snapshot(), before);
    await created(returnOrder(orderB.id), orderB.id, 'order', founderCookie);
  });
});
