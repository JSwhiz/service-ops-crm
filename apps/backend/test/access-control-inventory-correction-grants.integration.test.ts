import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Movement = {
  id: string; status: string;
  projection: { canCorrectMovement: boolean };
};
type ObjectInventory = { movements: Movement[]; capabilities: { canIssueInventoryToObject: boolean } };
type Correction = { id: string; mode: 'cancelled' | 'reversed'; compensatingMovementId?: string };

test('correction-only grants authorize a nonissuer without opening issuance or parent reads', { timeout: 180_000 }, async (t) => {
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
  const marker = `acl-correction-only-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const directorCookie = await loginAndGetCookieHeader({ baseUrl, login: 'director', password: 'director123' });
  const identity = () => prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true, permissions: true } });
  const originalIdentity = await identity();
  assert.equal(originalIdentity.permissions.length, 0);
  // The same actor cookie is retained through every grant, deny and revoke.
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body) as T;
  };
  const itemIds: string[] = [];
  const objectIds: string[] = [];
  const fixture = async (label: string, confirmed = false) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated correction source', status: 'active', createdByUserId: founder.id,
    } });
    objectIds.push(object.id);
    const item = await json<{ id: string }>(await request('/inventory/items', 'POST', {
      name: `${marker}-${label}`, category: marker, unit: 'шт',
    }, founderCookie), 201);
    itemIds.push(item.id);
    await json(await request('/inventory/movements', 'POST', {
      inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 17,
    }, founderCookie), 201);
    const issue = await json<Movement>(await request(`/objects/${object.id}/inventory/issue`, 'POST', {
      inventoryItemId: item.id, quantity: 2, comment: marker,
    }, founderCookie), 201);
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: {
      sourceEntityType: 'inventory_movement', sourceEntityId: issue.id, status: 'pending',
    } });
    assert.equal(approval.createdByUserId, founder.id);
    if (confirmed) await json(await request(`/inventory/movements/${issue.id}/resolve-missing-photo-approval`, 'POST', {}, directorCookie), 200);
    return { objectId: object.id, itemId: item.id, issueId: issue.id, approvalId: approval.id };
  };
  const a = await fixture('A-pending');
  const b = await fixture('B-control');
  const c = await fixture('C-confirmed', true);
  assert.equal(await prisma.objectAssignment.count({ where: { userId: actor.id, objectId: { in: objectIds } } }), 0);
  assert.equal(await prisma.object.count({ where: { id: { in: objectIds }, createdByUserId: actor.id } }), 0);
  const rule = async (actionCode: string, effect: 'allow' | 'deny', ids: string[], scope: 'selected' | 'all' = 'selected') => {
    const action = ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode);
    assert.ok(action);
    assert.equal(action.manageable, true);
    assert.ok(action.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds: ids }, update: { effect, scope, selectedIds: ids } });
  };
  const revoke = (actionCode: string) => prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
  const snapshot = async () => ({
    items: await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    budgets: await prisma.objectBudgetPeriod.findMany({ where: { objectId: { in: objectIds } }, orderBy: [{ objectId: 'asc' }, { month: 'asc' }] }),
    alerts: await prisma.objectBudgetAlert.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ where: { entityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: { id: true, notificationId: true, recipientUserId: true, createdAt: true } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
  });
  const body = { reason: 'Synthetic correction-only regression' };
  const correctPath = (id: string) => `/inventory/movements/${id}/correct`;
  const correct = (id: string) => request(correctPath(id), 'POST', body).then(response => json<Correction>(response, 201));
  const denied = async (path: string, payload: unknown = body) => {
    const before = await snapshot();
    const response = await request(path, 'POST', payload);
    assert.equal(response.status, 403, await response.text());
    assert.deepEqual(await snapshot(), before, '403 must preserve stock, prices, approvals, budgets, audits and all captured side effects');
  };
  const view = async (target: typeof a) => {
    const result = await json<ObjectInventory>(await request(`/objects/${target.objectId}/inventory`), 200);
    assert.equal(result.capabilities.canIssueInventoryToObject, false);
    const movement = result.movements.find(({ id }) => id === target.issueId);
    assert.ok(movement);
    return movement;
  };
  const stock = (id: string) => request(`/inventory/items/${id}`, 'GET', undefined, founderCookie)
    .then(response => json<{ currentStock: number }>(response, 200)).then(item => item.currentStock);
  await rule('objects.read', 'allow', objectIds);
  // Operational section reads and item reads are independent of basic object
  // visibility. None of these read grants supplies issuance/correction authority.
  await rule('objects.inventory.read', 'allow', objectIds);
  await rule('inventory.read', 'allow', itemIds);

  await t.test('readable unassigned manager has neither inherited correction nor issue authority', async () => {
    assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, effect: 'allow', actionCode: { in: [
      'inventory.issue_to_object', 'objects.inventory.issue', 'inventory.movement.correct',
    ] } } }), 0);
    assert.equal((await view(a)).projection.canCorrectMovement, false);
    assert.equal((await view(b)).projection.canCorrectMovement, false);
    await denied(correctPath(a.issueId));
    await denied(`/objects/${a.objectId}/inventory/issue`, { inventoryItemId: a.itemId, quantity: 1 });
  });
  await t.test('selected HR basic profile is a readable source, not issue or correction authority', async () => {
    const operationalReadIds = [...objectIds];
    const hrA = await fixture('HR-A-pending');
    assert.ok(!operationalReadIds.includes(hrA.objectId));
    const movements = () => request(`/inventory/movements?inventoryItemId=${hrA.itemId}&limit=100`)
      .then(response => json<{ items: Movement[] }>(response, 200));
    const basicProfile = async () => {
      const profile = await json<ObjectResponseDto>(await request(`/objects/${hrA.objectId}`), 200);
      assert.equal(profile.capabilities.canViewBasicProfile, true);
      assert.equal(profile.capabilities.canViewOperationalSections, false);
      assert.equal(profile.capabilities.canEdit, false);
      assert.equal(profile.capabilities.canOperateAttendance, false);
    };
    try {
      await rule('objects.view_hr', 'allow', [hrA.objectId]);
      const beforeReads = await snapshot();
      await basicProfile();
      const readOnlyIssue = (await movements()).items.find(({ id }) => id === hrA.issueId);
      assert.ok(readOnlyIssue, 'Generic movement source reads accept the actual selected HR basic profile');
      assert.equal(readOnlyIssue.projection.canCorrectMovement, false);
      assert.deepEqual(await snapshot(), beforeReads, 'Basic profile and movement reads have no business side effects');
      await denied(correctPath(hrA.issueId));
      await rule('inventory.movement.correct', 'allow', [hrA.itemId]);
      const correctableIssue = (await movements()).items.find(({ id }) => id === hrA.issueId);
      assert.ok(correctableIssue);
      assert.equal(correctableIssue.projection.canCorrectMovement, true);
      await basicProfile();
      await denied(`/objects/${hrA.objectId}/inventory/issue`, { inventoryItemId: hrA.itemId, quantity: 1 });
      // HR visibility is not operational object scope. Use the generic movement
      // read channel, not the deliberately restricted object inventory endpoint.
      for (const parent of ['objects.read', 'objects.access']) {
        await rule(parent, 'deny', [hrA.objectId]);
        await denied(correctPath(hrA.issueId));
        const beforeHiddenReads = await snapshot();
        const hidden = await request(`/objects/${hrA.objectId}`);
        assert.equal(hidden.status, 404, await hidden.text());
        assert.ok(!(await movements()).items.some(({ id }) => id === hrA.issueId));
        assert.deepEqual(await snapshot(), beforeHiddenReads);
        await revoke(parent);
        if (parent === 'objects.read') await rule('objects.read', 'allow', operationalReadIds);
      }
      const beforeApply = await snapshot();
      const original = beforeApply.movements.find(({ id }) => id === hrA.issueId);
      assert.ok(original);
      assert.equal((await correct(hrA.issueId)).mode, 'cancelled');
      const afterApply = await snapshot();
      const cancelled = afterApply.movements.find(({ id }) => id === hrA.issueId);
      assert.ok(cancelled);
      assert.equal(cancelled.status, 'cancelled');
      assert.deepEqual({ ...cancelled, status: original.status, updatedAt: original.updatedAt }, original);
      assert.deepEqual(afterApply.movements.filter(({ id }) => id !== hrA.issueId), beforeApply.movements.filter(({ id }) => id !== hrA.issueId));
      assert.equal(afterApply.approvals.find(({ id }) => id === hrA.approvalId)?.status, 'cancelled');
      assert.equal(await stock(hrA.itemId), 10);
      await revoke('objects.view_hr');
      await denied(correctPath(hrA.issueId));
    } finally {
      await prisma.userAccessRule.deleteMany({ where: { userId: actor.id, actionCode: { in: [
        'objects.view_hr', 'inventory.movement.correct', 'objects.access',
      ] } } });
      await rule('objects.read', 'allow', operationalReadIds);
    }
  });
  await t.test('selected correction A grants no B authority, no issue permission and revokes live', async () => {
    await rule('inventory.movement.correct', 'allow', [a.itemId]);
    assert.equal((await view(a)).projection.canCorrectMovement, true);
    assert.equal((await view(b)).projection.canCorrectMovement, false);
    await denied(correctPath(b.issueId));
    await revoke('inventory.movement.correct');
    assert.equal((await view(a)).projection.canCorrectMovement, false);
    await denied(correctPath(a.issueId));
    await rule('inventory.movement.correct', 'allow', [a.itemId]);
    for (const actionCode of ['inventory.issue_to_object', 'objects.inventory.issue']) {
      await rule(actionCode, 'deny', [a.objectId]);
      assert.equal((await view(a)).projection.canCorrectMovement, true, 'Issue deny cannot become a correction deny');
      await denied(`/objects/${a.objectId}/inventory/issue`, { inventoryItemId: a.itemId, quantity: 1 });
    }
  });
  await t.test('positive target read is required; correction never grants its own parent read', async () => {
    await rule('objects.read', 'allow', [b.objectId, c.objectId]);
    await denied(correctPath(a.issueId));
    await rule('objects.read', 'allow', objectIds);
    assert.equal((await view(a)).projection.canCorrectMovement, true);
  });
  await t.test('item/root and object/root denies override correction with no persisted effects', async () => {
    for (const actionCode of ['inventory.read', 'inventory.access']) {
      await rule(actionCode, 'deny', [a.itemId]);
      try {
        const beforeRead = await snapshot();
        const hidden = await json<ObjectInventory>(await request(`/objects/${a.objectId}/inventory`), 200);
        assert.equal(hidden.capabilities.canIssueInventoryToObject, false);
        assert.equal(hidden.movements.some(({ id }) => id === a.issueId), false,
          'An item/root read deny hides the movement, not merely its correction action');
        assert.equal((await view(b)).projection.canCorrectMovement, false,
          'The selected deny must retain the readable control movement');
        assert.deepEqual(await snapshot(), beforeRead, 'Denied-row and control reads must not create side effects');
        await denied(correctPath(a.issueId));
      } finally {
        await revoke(actionCode);
        if (actionCode === 'inventory.read') await rule('inventory.read', 'allow', itemIds);
      }
      assert.equal((await view(a)).projection.canCorrectMovement, true,
        'Revoking the read deny restores the original correction-only grant');
    }
    for (const actionCode of ['objects.read', 'objects.access']) {
      await rule(actionCode, 'deny', [a.objectId]);
      await denied(correctPath(a.issueId));
      await revoke(actionCode);
      if (actionCode === 'objects.read') await rule('objects.read', 'allow', objectIds);
    }
    await rule('inventory.movement.correct', 'deny', [a.itemId]);
    assert.equal((await view(a)).projection.canCorrectMovement, false);
    await denied(correctPath(a.issueId));
    await rule('inventory.movement.correct', 'allow', [a.itemId]);
  });
  await t.test('inactive object cannot be opened for correction by a personal grant', async () => {
    await prisma.object.update({ where: { id: a.objectId }, data: { status: 'frozen' } });
    assert.equal((await view(a)).projection.canCorrectMovement, false);
    await denied(correctPath(a.issueId));
    await prisma.object.update({ where: { id: a.objectId }, data: { status: 'active' } });
  });
  await t.test('correction-only authority cancels pending issue and approval once, preserving prices', async () => {
    const before = await snapshot();
    const original = before.movements.find(({ id }) => id === a.issueId);
    assert.ok(original);
    assert.equal(await stock(a.itemId), 8);
    const result = await correct(a.issueId);
    assert.equal(result.mode, 'cancelled');
    const after = await snapshot();
    const cancelled = after.movements.find(({ id }) => id === a.issueId);
    assert.ok(cancelled);
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual({ ...cancelled, status: original.status, updatedAt: original.updatedAt }, original);
    assert.equal(after.movements.length, before.movements.length);
    const approval = after.approvals.find(({ id }) => id === a.approvalId);
    assert.ok(approval);
    assert.equal(approval.status, 'cancelled');
    assert.equal(approval.cancelledByUserId, actor.id);
    assert.equal(approval.decisionComment, body.reason);
    assert.equal(await stock(a.itemId), 10);
    assert.equal(after.audit.filter(row => row.entityId === a.issueId && row.action === 'inventory.movement.cancelled' && row.actorUserId === actor.id).length, 1);
    assert.equal((await view(a)).projection.canCorrectMovement, false);
    const stable = await snapshot();
    assert.deepEqual(await correct(a.issueId), result);
    assert.deepEqual(await snapshot(), stable);
    await revoke('inventory.movement.correct');
    await denied(correctPath(a.issueId));
  });
  await t.test('confirmed issue gets one exact return; authorized replay precedes no new effects', async () => {
    await rule('inventory.movement.correct', 'allow', [c.itemId]);
    await rule('inventory.issue_to_object', 'deny', [c.objectId]);
    await rule('objects.inventory.issue', 'deny', [c.objectId]);
    assert.equal((await view(c)).projection.canCorrectMovement, true);
    const before = await snapshot();
    const original = before.movements.find(({ id }) => id === c.issueId);
    assert.ok(original);
    const result = await correct(c.issueId);
    assert.equal(result.mode, 'reversed');
    assert.ok(result.compensatingMovementId);
    const after = await snapshot();
    const reverse = after.movements.find(({ id }) => id === result.compensatingMovementId);
    assert.ok(reverse);
    assert.equal(reverse.movementType, 'return');
    assert.equal(reverse.status, 'applied');
    assert.equal(reverse.inventoryItemId, c.itemId);
    assert.equal(reverse.relatedObjectId, c.objectId);
    assert.equal(reverse.relatedOneTimeOrderId, null);
    assert.equal(reverse.createdByUserId, actor.id);
    assert.equal(reverse.evidenceRequired, false);
    assert.equal(reverse.quantity.toNumber(), original.quantity.toNumber());
    assert.equal(reverse.unitPriceSnapshot.toNumber(), original.unitPriceSnapshot.toNumber());
    assert.equal(reverse.totalAmountSnapshot.toNumber(), original.totalAmountSnapshot.toNumber());
    assert.deepEqual(after.movements.filter(({ id }) => id !== reverse.id), before.movements);
    assert.deepEqual(after.approvals, before.approvals, 'Correction is not approval or a rewrite of the independent decision');
    assert.equal(await stock(c.itemId), 10);
    assert.equal(after.audit.filter(row => row.entityId === c.issueId && row.action === 'inventory.movement.reversed' && row.actorUserId === actor.id).length, 1);
    assert.equal((await view(c)).projection.canCorrectMovement, true, 'Applied original permits authorized idempotent replay without per-row audit lookup');
    const stable = await snapshot();
    assert.deepEqual(await correct(c.issueId), result);
    assert.deepEqual(await snapshot(), stable);
    await rule('inventory.read', 'deny', [c.itemId]);
    try {
      await denied(correctPath(c.issueId));
    } finally {
      await revoke('inventory.read');
      await rule('inventory.read', 'allow', itemIds);
    }
    await revoke('inventory.movement.correct');
    await denied(correctPath(c.issueId));
    assert.deepEqual(await identity(), originalIdentity);
  });
});
