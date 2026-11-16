import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { notificationAccessWhere } from '../src/common/access/notification-access';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('unknown and incomplete notification sources fail closed without breaking source-less notices or composite mats denies', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let close: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await close?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  close = () => app.close();
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'founder' } });
  const marker = `acl-notification-fail-closed-${randomUUID()}`;
  const actor = await prisma.user.create({ data: { login: marker, fullName: marker,
    passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId: role.id } } } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const object = await prisma.object.create({ data: { name: marker, address: 'Own isolated source',
    status: 'active', createdByUserId: actor.id } });
  const create = (entityType: string | null, entityId: string | null, label: string) => prisma.notification.create({
    data: { recipientUserId: actor.id, type: 'acl.fail_closed', title: `${marker}-${label}`, entityType, entityId },
  });
  const generic = await create(null, null, 'generic-control');
  const visible = await create('object', object.id, 'visible-object-control');
  const hidden = await Promise.all([
    create('unknown_private_source', randomUUID(), 'unknown'),
    create('object', randomUUID(), 'missing-object'),
    create('object', null, 'incomplete-object'),
    create(null, object.id, 'incomplete-type'),
    ...['equipment_unit', 'equipment_movement', 'accountability_expense', 'accountability_funding',
      'accountability_closure', 'counterparty', 'rubber_mat', 'object_rubber_mat_quantity',
      'user_absence', 'user_substitution', 'chat_message'].map(type => create(type, randomUUID(), type)),
  ]);
  const request = (suffix = '', method = 'GET') => fetch(`${baseUrl}/api/v1/notifications${suffix}`, {
    method, headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    assert.equal(response.status, status, await response.clone().text());
    return await response.json() as T;
  };
  const snapshot = () => prisma.notification.findMany({ where: { recipientUserId: actor.id }, orderBy: { id: 'asc' } });
  const expectedIds = [generic.id, visible.id].sort();
  const check = async () => {
    const before = await snapshot();
    const body = await json<{ total: number; items: Array<{ id: string }> }>(await request('?limit=100'));
    assert.equal(body.total, 2);
    assert.deepEqual(body.items.map(row => row.id).sort(), expectedIds);
    assert.deepEqual(await json(await request('/unread-count')), { count: 2 });
    const eligible = await prisma.notification.findMany({
      where: await notificationAccessWhere(prisma as unknown as PrismaService, actor.id, 'notifications.realtime'),
      select: { id: true },
    });
    assert.deepEqual(eligible.map(row => row.id).sort(), expectedIds, 'DB delivery eligibility, not socket publication');
    assert.deepEqual(await snapshot(), before);
  };
  await t.test('positive membership preserves only real readable sources and genuine generic notices', check);
  await t.test('unsupported/missing sources cannot be marked or dismissed and remain stored unchanged', async () => {
    const before = await snapshot();
    for (const row of hidden) {
      for (const action of ['read', 'dismiss']) {
        const response = await request(`/${row.id}/${action}`, 'POST');
        assert.ok([403, 404].includes(response.status), await response.text());
      }
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('scoped mats deny does not query a nonexistent quantity id or hide generic controls', async () => {
    const rule = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode: 'mats.read',
      effect: 'deny', scope: 'selected', selectedIds: [object.id] } });
    try { await check(); } finally { await prisma.userAccessRule.delete({ where: { id: rule.id } }); }
  });
  await t.test('bulk operations affect only the positive membership, never hidden stored records', async () => {
    const beforeHidden = (await snapshot()).filter(row => hidden.some(entry => entry.id === row.id));
    assert.deepEqual(await json(await request('/read-all', 'POST'), 201), { updated: 2 });
    assert.deepEqual((await snapshot()).filter(row => hidden.some(entry => entry.id === row.id)), beforeHidden);
    assert.deepEqual(await json(await request('/unread-count')), { count: 0 });
  });
});
