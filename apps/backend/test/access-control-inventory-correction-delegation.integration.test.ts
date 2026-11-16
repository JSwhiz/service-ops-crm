import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('correction audits record only necessary delegated read/action authority, never DTO projection', async (t) => {
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
  const marker = `acl-correction-delegation-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = async (label: string) => {
    const user = await prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker}-${label}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } },
    } });
    return { ...user, cookie: await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' }) };
  };
  const principal = await actor('principal');
  const replacement = await actor('replacement');
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const object = await prisma.object.create({ data: {
    name: marker, address: 'Isolated delegation audit source', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: principal.id, assignmentRoleCode: 'manager', isActive: true } },
  } });
  const request = (cookie: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body) as T;
  };
  const created = await json<{ items: Array<{ id: string }> }>(await request(principal.cookie, '/user-substitutions', 'POST', {
    replacementUserId: replacement.id, objectIds: [object.id], startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(), reason: 'Synthetic correction delegation regression',
  }), 201);
  assert.equal(created.items.length, 1);
  const substitutionId = created.items[0].id;
  const expectedDelegations = [{ substitutionId, principalUserId: principal.id, objectId: object.id }];
  const rule = (actionCode: string, id: string) => prisma.userAccessRule.upsert({
    where: { userId_actionCode: { userId: replacement.id, actionCode } },
    create: { userId: replacement.id, actionCode, effect: 'allow', scope: 'selected', selectedIds: [id] },
    update: { effect: 'allow', scope: 'selected', selectedIds: [id] },
  });
  const audit = () => prisma.auditEvent.findMany({ orderBy: { id: 'asc' } });
  for (const [label, ownRead, ownCorrection] of [
    ['delegated-read-and-action', false, false], ['delegated-read-only', false, true],
    ['delegated-action-only', true, false], ['fully-own-grants', true, true],
  ] as const) {
    await t.test(label, async () => {
      await prisma.userAccessRule.deleteMany({ where: { userId: replacement.id } });
      const item = await json<{ id: string }>(await request(founderCookie, '/inventory/items', 'POST', {
        name: `${marker}-${label}`, category: marker, unit: 'шт',
      }), 201);
      await json(await request(founderCookie, '/inventory/movements', 'POST', {
        inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 13,
      }), 201);
      const issue = await json<{ id: string }>(await request(founderCookie, `/objects/${object.id}/inventory/issue`, 'POST', {
        inventoryItemId: item.id, quantity: 2,
      }), 201);
      if (ownRead) await rule('objects.read', object.id);
      if (ownCorrection) await rule('inventory.movement.correct', item.id);
      const beforeProjection = await audit();
      const page = await json<{ items: Array<{ id: string; projection: { canCorrectMovement: boolean } }> }>(
        await request(replacement.cookie, `/inventory/movements?inventoryItemId=${item.id}`), 200);
      assert.equal(page.items.find(({ id }) => id === issue.id)?.projection.canCorrectMovement, true);
      assert.deepEqual(await audit(), beforeProjection, 'GET projection must not create delegation audit events');
      const result = await json<{ mode: string }>(await request(replacement.cookie, `/inventory/movements/${issue.id}/correct`, 'POST', {
        reason: `Synthetic ${label}`,
      }), 201);
      assert.equal(result.mode, 'cancelled');
      const added = (await audit()).filter(row => !beforeProjection.some(old => old.id === row.id) && row.actorUserId === replacement.id);
      const security = added.filter(row => row.entityType === 'user_substitution');
      assert.equal(security.length, 2);
      const started = security.find(row => row.action === 'user_substitution.action_started');
      assert.ok(started);
      const delegated = !ownRead || !ownCorrection;
      const completed = security.find(row => row.action === (delegated ? 'user_substitution.action' : 'user_substitution.own_action'));
      assert.ok(completed);
      assert.equal(completed.entityId, substitutionId);
      const meta = completed.metadata as { operationId: string; delegations: typeof expectedDelegations; method: string; path: string };
      assert.equal(meta.operationId, (started.metadata as { operationId: string }).operationId);
      assert.equal(meta.method, 'POST');
      assert.equal(meta.path, `/api/v1/inventory/movements/${issue.id}/correct`);
      assert.deepEqual(meta.delegations, delegated ? expectedDelegations : []);
      const business = added.filter(row => row.entityType === 'inventory_movement' && row.entityId === issue.id && row.action === 'inventory.movement.cancelled');
      assert.equal(business.length, 1);
      assert.deepEqual((business[0].metadata as { delegations?: typeof expectedDelegations } | null)?.delegations ?? [], delegated ? expectedDelegations : []);
      assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } })).status, 'cancelled');
    });
  }
});
