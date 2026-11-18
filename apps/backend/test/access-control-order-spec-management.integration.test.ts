import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { OneTimeOrderSpecificationItemResponseDto as Item } from '../src/modules/one-time-orders/dto/one-time-order-specification-item-response.dto';
import type { SpecificationCatalogItemResponseDto as CatalogItem, SpecificationTemplateResponseDto as Template } from '../src/modules/one-time-orders/dto/specification-catalog.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const actionCode = 'one_time_orders.specification.manage';

// One policy-locked code. Canonical leadership defaults remain authoritative;
// no positive personal grant is inserted, and execution rights are not widened.
test('order specification management preserves leadership policy, live denies, CRUD history and catalog snapshots', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)!;
  assert.equal(definition.manageable, false);
  assert.equal(definition.constraint, 'policy_decision_required');

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => {
    try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-spec-manage-${randomUUID()}`;
  const templateUser = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const newActor = async (roleCode: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: {
      login: `${marker}-${roleCode}`, fullName: `${marker} ${roleCode}`, passwordHash: templateUser.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } },
    } });
    const cookie = await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' });
    return { ...user, cookie };
  };
  type Actor = { id: string; login: string; cookie: string };
  const leaders: Actor[] = [];
  for (const role of ['founder', 'deputy_founder', 'director', 'corporate_director']) leaders.push(await newActor(role));
  const founder = leaders[0];
  const manager = await newActor('manager');
  // All cookies predate every rule change; roles and permissions are never edited.
  const request = (user: Actor, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const deny = (user: Actor, code: string, selectedIds: string[]) => prisma.userAccessRule.upsert({
    where: { userId_actionCode: { userId: user.id, actionCode: code } },
    create: { userId: user.id, actionCode: code, effect: 'deny', scope: 'selected', selectedIds },
    update: { effect: 'deny', scope: 'selected', selectedIds },
  });
  const revoke = (user: Actor, code: string) => prisma.userAccessRule.delete({ where: {
    userId_actionCode: { userId: user.id, actionCode: code },
  } });
  let sequence = 0;
  const orderFixture = (label: string) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${label}-${++sequence}`, executionAddress: 'Isolated specification fixture', contactName: 'Fixture',
    status: 'new', createdByUserId: founder.id,
    assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  const a = await orderFixture('A');
  const b = await orderFixture('B');
  const past = await orderFixture('previous-order');
  const catalogPath = '/one-time-orders/specification-catalog';
  const templatesPath = '/one-time-orders/specification-templates';
  const catalog = await json<CatalogItem>(await request(founder, catalogPath, 'POST', {
    title: `${marker}-catalog-v1`, description: 'Original catalog description', sortOrder: 0,
  }), 201);
  const template = await json<Template>(await request(founder, templatesPath, 'POST', {
    name: `${marker}-template-v1`, items: [{ catalogItemId: catalog.id, sortOrder: 0 }],
  }), 201);
  const path = (id: string) => `/one-time-orders/${id}/specification-items`;
  const read = (user: Actor, id: string) => request(user, path(id)).then((response) => json<Item[]>(response, 200));
  const selection = () => ({
    requestId: randomUUID(), templateIds: [template.id], catalogItemIds: [],
    expectedTemplateVersions: [{ templateId: template.id, version: template.version }], expectedCatalogItems: [],
  });
  const snapshot = async () => ({
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
    items: await prisma.oneTimeOrderSpecificationItem.findMany({ orderBy: { id: 'asc' } }),
    comments: await prisma.oneTimeOrderSpecificationComment.findMany({ orderBy: { id: 'asc' } }),
    applications: await prisma.oneTimeOrderSpecificationApplyRequest.findMany({ orderBy: { id: 'asc' } }),
    catalog: await prisma.oneTimeOrderSpecificationCatalogItem.findMany({ orderBy: { id: 'asc' } }),
    templates: await prisma.oneTimeOrderSpecificationTemplate.findMany({ orderBy: { id: 'asc' } }),
    templateItems: await prisma.oneTimeOrderSpecificationTemplateItem.findMany({ orderBy: [{ templateId: 'asc' }, { catalogItemId: 'asc' }] }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    equipment: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    rules: await prisma.userAccessRule.findMany({ orderBy: { id: 'asc' } }),
    accessAudit: await prisma.userAccessAudit.findMany({ orderBy: { id: 'asc' } }),
    versions: await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, accessVersion: true } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const onlyChanges = (before: Snapshot, after: Snapshot, allowed: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) {
      if (!allowed.includes(key)) assert.deepEqual(after[key], before[key], key);
    }
    assert.deepEqual(after.audit.filter((row) => before.audit.some((old) => old.id === row.id)), before.audit);
  };
  const denied = async (user: Actor, endpoint: string, method: string, body?: unknown, status = 403) => {
    const before = await snapshot();
    const response = await request(user, endpoint, method, body);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${endpoint}: rejected operation must preserve snapshots, history and all side effects`);
    assert.equal(response.status, status, text);
    return text;
  };
  const addedAudit = (before: Snapshot, after: Snapshot, user: Actor, orderId: string, action: string) => {
    const added = after.audit.filter((row) => !before.audit.some((old) => old.id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].entityType, 'one_time_order');
    assert.equal(added[0].entityId, orderId);
    assert.equal(added[0].actorUserId, user.id);
    assert.equal(added[0].action, action);
    return added[0];
  };
  const apply = async (orderId: string, payload = selection()) => {
    const before = await snapshot();
    const result = await json<Item[]>(await request(founder, `${path(orderId)}/apply-catalog`, 'POST', payload), 201);
    const after = await snapshot();
    onlyChanges(before, after, ['items', 'applications', 'audit', 'notifications', 'outbox']);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, catalog.title);
    assert.equal(result[0].description, catalog.description);
    assert.equal(result[0].requiresAttachment, false);
    assert.equal(result[0].createdBy.id, founder.id);
    assert.equal(after.items.length, before.items.length + 1);
    assert.deepEqual(after.items.filter((row) => row.id !== result[0].id), before.items);
    addedAudit(before, after, founder, orderId, 'one_time_order.specification_catalog_applied');
    const beforeRetry = await snapshot();
    const retry = await json<Item[]>(await request(founder, `${path(orderId)}/apply-catalog`, 'POST', payload), 201);
    assert.deepEqual(retry, result);
    assert.deepEqual(await snapshot(), beforeRetry, 'Same request ID cannot append duplicate specification points or notifications');
    return result[0];
  };
  const catalogA = await apply(a.id);
  await apply(b.id);
  const pastItem = await apply(past.id);
  // An explicitly completed past-order fixture is never reopened or rewritten.
  await prisma.oneTimeOrder.update({ where: { id: past.id }, data: { status: 'completed' } });
  const pastOrder = await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: past.id } });
  const pastSnapshot = await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({ where: { id: pastItem.id } });

  const create = async (user: Actor, id: string, title = `${marker}-custom-${++sequence}`) => {
    const before = await snapshot();
    const result = await json<Item>(await request(user, path(id), 'POST', { title, description: 'Custom description', requiresAttachment: true }), 201);
    const after = await snapshot();
    onlyChanges(before, after, ['items', 'audit']);
    assert.equal(result.title, title.trim());
    assert.equal(result.requiresAttachment, false, 'Evidence remains optional despite deprecated input');
    assert.equal(result.createdBy.id, user.id);
    assert.equal(after.items.length, before.items.length + 1);
    const stored = after.items.find((row) => row.id === result.id)!;
    assert.equal(stored.oneTimeOrderId, id);
    assert.equal(stored.createdByUserId, user.id);
    assert.equal(stored.deletedAt, null);
    assert.deepEqual(after.items.filter((row) => row.id !== result.id), before.items);
    const event = addedAudit(before, after, user, id, 'one_time_order.specification_item_created');
    assert.deepEqual(event.metadata, { specificationItemId: result.id });
    return result;
  };

  await t.test('all four leadership defaults compose; actual CRUD/reorder retains deleted data and precise history', async () => {
    for (const leader of leaders) await create(leader, b.id);
    const first = await create(founder, a.id, '  Trimmed custom point  ');
    const second = await create(founder, a.id);
    const beforeUpdate = await snapshot();
    const updated = await json<Item>(await request(founder, `${path(a.id)}/${first.id}`, 'PATCH', { title: 'Edited point', description: 'Edited snapshot description' }), 200);
    const afterUpdate = await snapshot();
    onlyChanges(beforeUpdate, afterUpdate, ['items', 'audit']);
    const old = beforeUpdate.items.find((row) => row.id === first.id)!;
    const stored = afterUpdate.items.find((row) => row.id === first.id)!;
    assert.deepEqual(stored, { ...old, title: updated.title, description: updated.description, updatedAt: stored.updatedAt });
    assert.equal(updated.title, 'Edited point');
    assert.deepEqual(afterUpdate.items.filter((row) => row.id !== first.id), beforeUpdate.items.filter((row) => row.id !== first.id));
    const updateAudit = addedAudit(beforeUpdate, afterUpdate, founder, a.id, 'one_time_order.specification_item_updated');
    assert.equal((updateAudit.oldValues as { title: string }).title, first.title);
    assert.equal((updateAudit.newValues as { title: string }).title, updated.title);
    const reorderedIds = [second.id, first.id, catalogA.id];
    const beforeReorder = await snapshot();
    const reordered = await json<Item[]>(await request(founder, `${path(a.id)}/reorder`, 'PATCH', { itemIds: reorderedIds }), 200);
    const afterReorder = await snapshot();
    onlyChanges(beforeReorder, afterReorder, ['items', 'audit']);
    assert.deepEqual(reordered.map((row) => row.id), reorderedIds);
    assert.deepEqual(reordered.map((row) => row.sortOrder), [0, 1, 2]);
    assert.deepEqual(afterReorder.items.filter((row) => row.oneTimeOrderId !== a.id), beforeReorder.items.filter((row) => row.oneTimeOrderId !== a.id));
    addedAudit(beforeReorder, afterReorder, founder, a.id, 'one_time_order.specification_reordered');
    await denied(founder, `${path(a.id)}/reorder`, 'PATCH', { itemIds: [second.id] }, 400);
    const beforeDelete = await snapshot();
    await json<Item>(await request(founder, `${path(a.id)}/${first.id}`, 'DELETE'), 200);
    const afterDelete = await snapshot();
    onlyChanges(beforeDelete, afterDelete, ['items', 'audit']);
    const deleted = afterDelete.items.find((row) => row.id === first.id)!;
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedByUserId, founder.id);
    assert.equal(deleted.title, updated.title);
    assert.equal(afterDelete.items.length, beforeDelete.items.length, 'Delete preserves the historical row');
    assert.deepEqual(afterDelete.items.filter((row) => row.id !== first.id), beforeDelete.items.filter((row) => row.id !== first.id));
    const deleteAudit = addedAudit(beforeDelete, afterDelete, founder, a.id, 'one_time_order.specification_item_deleted');
    assert.equal((deleteAudit.oldValues as { title: string }).title, updated.title);
    assert.equal(deleteAudit.newValues, null);
    assert.ok(!(await read(founder, a.id)).some((row) => row.id === first.id));
    const historyBefore = await snapshot();
    const history = await json<Array<{ id: string; action: string; actor: { id: string } | null }>>(await request(founder, `/one-time-orders/${a.id}/history`), 200);
    assert.ok(history.some((row) => row.id === deleteAudit.id && row.actor?.id === founder.id));
    assert.ok(history.some((row) => row.id === updateAudit.id && row.action === updateAudit.action));
    assert.deepEqual(await snapshot(), historyBefore, 'History reads cannot alter specification or audit');
  });

  await t.test('assigned manager cannot compose or obtain a new policy-locked grant through admin preview', async () => {
    const active = await read(manager, a.id);
    const body = selection();
    const operations = [
      { endpoint: path(a.id), method: 'POST', body: { title: 'Manager must not compose' } },
      { endpoint: `${path(a.id)}/${catalogA.id}`, method: 'PATCH', body: { title: 'Manager must not rewrite' } },
      { endpoint: `${path(a.id)}/${catalogA.id}`, method: 'DELETE', body: undefined },
      { endpoint: `${path(a.id)}/reorder`, method: 'PATCH', body: { itemIds: active.map((row) => row.id).reverse() } },
      { endpoint: `${path(a.id)}/apply-catalog`, method: 'POST', body },
    ];
    for (const operation of operations) await denied(manager, operation.endpoint, operation.method, operation.body);
    const identity = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });
    const rejection = await denied(founder, `/users-access/admin/users/${manager.id}/preview`, 'POST', {
      expectedVersion: identity.accessVersion, reason: 'Policy-locked specification authority fixture',
      changes: [{ actionCode, effect: 'allow', scope: 'selected', selectedIds: [a.id] }],
    }, 400);
    assert.ok(rejection.includes(`Action is constrained: ${actionCode}`));
    assert.equal(await prisma.userAccessRule.count({ where: { userId: manager.id, actionCode } }), 0);
    for (const operation of operations) await denied(manager, operation.endpoint, operation.method, operation.body);
  });

  await t.test('existing selected deny overrides leadership only for A; revoke and parent boundaries use the old cookie', async () => {
    // Fixture represents an existing restriction, not issuance through the locked admin action.
    await deny(founder, actionCode, [a.id]);
    try {
      const active = await read(founder, a.id);
      await denied(founder, path(a.id), 'POST', { title: 'Selected denied A' });
      await denied(founder, `${path(a.id)}/${catalogA.id}`, 'PATCH', { title: 'Denied update' });
      await denied(founder, `${path(a.id)}/${catalogA.id}`, 'DELETE');
      await denied(founder, `${path(a.id)}/reorder`, 'PATCH', { itemIds: active.map((row) => row.id).reverse() });
      await denied(founder, `${path(a.id)}/apply-catalog`, 'POST', selection());
      await create(founder, b.id);
      const before = await snapshot();
      await json(await request(founder, `/one-time-orders/${a.id}/history`), 200);
      assert.deepEqual(await snapshot(), before, 'Manage denial preserves authorized read/history');
    } finally { await revoke(founder, actionCode); }
    await create(founder, a.id);
    for (const code of ['one_time_orders.read', 'one_time_orders.access']) {
      await deny(founder, code, [a.id]);
      try {
        await denied(founder, path(a.id), 'POST', { title: 'Parent denied A' });
        await create(founder, b.id);
      } finally { await revoke(founder, code); }
    }
    await create(founder, a.id);
    await denied(founder, path(past.id), 'POST', { title: 'Past order stays closed' }, 409);
  });

  await t.test('catalog/template edits and archive never rewrite earlier or completed order snapshots', async () => {
    const beforeEdit = await snapshot();
    const updatedCatalog = await json<CatalogItem>(await request(founder, `${catalogPath}/${catalog.id}`, 'PATCH', {
      title: `${marker}-catalog-v2`, description: 'New catalog description',
    }), 200);
    const afterEdit = await snapshot();
    onlyChanges(beforeEdit, afterEdit, ['catalog', 'audit']);
    assert.equal(updatedCatalog.title, `${marker}-catalog-v2`);
    const beforeTemplate = await snapshot();
    const updatedTemplate = await json<Template>(await request(founder, `${templatesPath}/${template.id}`, 'PATCH', {
      expectedVersion: template.version, name: `${marker}-template-v2`,
    }), 200);
    const afterTemplate = await snapshot();
    onlyChanges(beforeTemplate, afterTemplate, ['templates', 'audit']);
    assert.equal(updatedTemplate.version, template.version + 1);
    assert.equal((await read(founder, past.id))[0].title, catalog.title);
    const fresh = await orderFixture('new-after-catalog-edit');
    const beforeApply = await snapshot();
    const latest = await json<Item[]>(await request(founder, `${path(fresh.id)}/apply-catalog`, 'POST', {
      requestId: randomUUID(), templateIds: [], catalogItemIds: [catalog.id], expectedTemplateVersions: [],
      expectedCatalogItems: [{ catalogItemId: catalog.id, updatedAt: updatedCatalog.updatedAt }],
    }), 201);
    const afterApply = await snapshot();
    onlyChanges(beforeApply, afterApply, ['items', 'applications', 'audit', 'notifications', 'outbox']);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].title, updatedCatalog.title);
    assert.equal(latest[0].description, updatedCatalog.description);
    assert.deepEqual(afterApply.items.filter((row) => row.oneTimeOrderId !== fresh.id), beforeApply.items);
    const beforeArchive = await snapshot();
    await json(await request(founder, `${catalogPath}/${catalog.id}`, 'DELETE'), 200);
    const afterArchive = await snapshot();
    onlyChanges(beforeArchive, afterArchive, ['catalog', 'audit']);
    assert.equal(afterArchive.catalog.find((row) => row.id === catalog.id)?.isArchived, true);
    const beforeTemplateArchive = await snapshot();
    await json(await request(founder, `${templatesPath}/${template.id}`, 'DELETE', { expectedVersion: updatedTemplate.version }), 200);
    const afterTemplateArchive = await snapshot();
    onlyChanges(beforeTemplateArchive, afterTemplateArchive, ['templates', 'audit']);
    assert.equal(afterTemplateArchive.templates.find((row) => row.id === template.id)?.isArchived, true);
    assert.deepEqual(await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: past.id } }), pastOrder);
    assert.deepEqual(await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({ where: { id: pastItem.id } }), pastSnapshot);
    assert.ok((await read(founder, a.id)).some((row) => row.id === catalogA.id && row.title === catalog.title));
    assert.equal((await read(founder, fresh.id))[0].title, updatedCatalog.title);
  });
  // This suite does not issue positive authority for constrained codes, mutate
  // roles/permissions, bypass execution assignments or alter completed history.
  // No binary storage, browser, production, concurrent mutation or DB execution
  // is claimed by this source addition. Isolated runner owns schema disposal.
});
