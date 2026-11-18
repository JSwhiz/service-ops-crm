import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessChange } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('accountability management scopes: real admin rejection, legacy retention/reset/history and unchanged recipient runtime', async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert(['localhost','127.0.0.1','[::1]'].includes(database.hostname));
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  t.after(() => db.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const template = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const marker = 'management-scopes-' + randomUUID();
  const definitions = ACCESS_ACTION_CATALOG.filter(a => a.module === 'accountability');
  const request = (cookie: string, route: string, body?: unknown) => fetch(`${baseUrl}/api/v1/${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (response: Response, expected: number) => {
    const body = await response.text(); assert.equal(response.status, expected, body);
    return JSON.parse(body);
  };
  const createUser = async (role: string, suffix: string) => {
    const row = await db.role.findUniqueOrThrow({ where: { code: role } });
    return db.user.create({ data: { login: marker + suffix, fullName: marker + suffix, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: row.id } } } });
  };
  const adminState = async (userId: string) => ({
    user: await db.user.findUniqueOrThrow({ where: { id: userId } }),
    rules: await db.userAccessRule.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    previews: await db.userAccessPreview.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    history: await db.userAccessAudit.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  });
  const sources = async (userId: string) => ({
    roles: await db.userRole.findMany({ where: { userId }, orderBy: { roleId: 'asc' } }),
    permissions: await db.userPermission.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    objects: await db.objectAssignment.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    orders: await db.oneTimeOrderAssignment.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  });
  const save = async (userId: string, changes: AccessChange[]) => {
    const before = await adminState(userId), sourceBefore = await sources(userId);
    const payload = { expectedVersion: before.user.accessVersion, reason: 'Explicit management restriction test', changes };
    const route = 'users-access/admin/users/' + userId;
    const preview = await json(await request(founderCookie, route + '/preview', payload), 201);
    assert.deepEqual(await db.userAccessRule.findMany({ where: { userId }, orderBy: { id: 'asc' } }), before.rules, 'Preview cannot rewrite legacy rules');
    const result = await json(await request(founderCookie, route + '/save', { ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash }), 201);
    const after = await adminState(userId);
    assert.equal(result.accessVersion, before.user.accessVersion + 1);
    assert.equal(after.user.accessVersion, before.user.accessVersion + 1);
    const event = after.history.find(e => !before.history.some(b => b.id === e.id)); assert(event);
    assert.equal(after.history.length, before.history.length + 1);
    assert.equal(event.versionBefore, before.user.accessVersion); assert.equal(event.versionAfter, result.accessVersion);
    assert.deepEqual(after.history.filter(e => e.id !== event.id), before.history, 'Earlier audit records are immutable');
    assert.deepEqual(await sources(userId), sourceBefore, 'No roles/permissions/assignments are fabricated');
    return { before, after, event };
  };

  await t.test('catalog adds management metadata while preserving the runtime contract', async () => {
    const catalog = await json(await request(founderCookie, 'users-access/admin/catalog'), 200);
    const actions = catalog.actions.filter((a: { module: string }) => a.module === 'accountability');
    assert.equal(actions.length, 15);
    for (const a of actions) {
      assert.deepEqual(a.allowedScopes, ['own','assigned','selected','all']);
      assert.deepEqual(a.managementScopes, ['own','selected','all']);
    }
    assert.deepEqual(
      actions.filter((a: { manageable: boolean }) => !a.manageable)
        .map((a: { code: string }) => a.code).sort(),
      ['accountability.closure.approve', 'accountability.closure.reject'],
    );
  });

  await t.test('new and changed assigned allow/deny fail with no admin/source changes; unrelated save retains old rows; default resets all 15 with audit', async () => {
    const recipient = await createUser('manager', '-admin-target');
    for (const existing of [false, true]) {
      if (existing) await db.userAccessRule.createMany({ data: definitions.map((a, index) => ({ userId: recipient.id,
        actionCode: a.code, effect: index % 2 ? 'deny' : 'allow', scope: 'assigned', selectedIds: [] })) });
      for (const a of definitions) for (const effect of ['allow','deny'] as const) {
        const before = await adminState(recipient.id), sourceBefore = await sources(recipient.id);
        const payload = { expectedVersion: before.user.accessVersion, reason: 'Reject unsupported management scope',
          changes: [{ actionCode: a.code, effect, scope: 'assigned', selectedIds: [] }] };
        const route = 'users-access/admin/users/' + recipient.id;
        for (const operation of ['preview','save']) {
          const body = operation === 'preview' ? payload : { ...payload, previewToken: 'a'.repeat(64), previewHash: 'b'.repeat(64) };
          const error = await json(await request(founderCookie, route + '/' + operation, body), 400);
          assert(JSON.stringify(error).includes(a.manageable ? 'По умолчанию' : 'Action is constrained'));
          assert.deepEqual(await adminState(recipient.id), before);
          assert.deepEqual(await sources(recipient.id), sourceBefore);
        }
      }
    }
    const legacy = await db.userAccessRule.findMany({ where: { userId: recipient.id }, orderBy: { id: 'asc' } });
    await save(recipient.id, [{ actionCode: 'tasks.read', effect: 'deny', scope: 'all', selectedIds: [] }]);
    assert.deepEqual(await db.userAccessRule.findMany({ where: { userId: recipient.id, actionCode: { startsWith: 'accountability.' } }, orderBy: { id: 'asc' } }), legacy);
    const reset = await save(recipient.id, definitions.map(a => ({ actionCode: a.code, effect: 'default', scope: 'assigned', selectedIds: [] })));
    assert.equal(await db.userAccessRule.count({ where: { userId: recipient.id, actionCode: { startsWith: 'accountability.' } } }), 0);
    assert.equal(await db.userAccessRule.count({ where: { userId: recipient.id, actionCode: 'tasks.read', effect: 'deny' } }), 1);
    const historyBefore = reset.event.before as Array<{ actionCode: string; scope: string }>;
    assert.equal(historyBefore.filter(r => r.actionCode.startsWith('accountability.') && r.scope === 'assigned').length, 15);
    const resetChanges = reset.event.changes as Array<{ effect: string; scope: string }>;
    assert(resetChanges.every(c => c.effect === 'default' && c.scope === 'assigned'));
  });

  await t.test('real account detail/list retain legacy assigned behavior across unrelated admin saves, then explicit reset', async () => {
    const owner = await createUser('manager', '-account-owner');
    await db.accountabilityAccount.create({ data: { userId: owner.id, status: 'active' } });
    for (const effect of ['allow','deny'] as const) {
      const reviewer = await createUser('founder', '-reviewer-' + effect);
      await db.userAccessRule.create({ data: { userId: reviewer.id, actionCode: 'accountability.review', effect, scope: 'assigned', selectedIds: [] } });
      const cookie = await loginAndGetCookieHeader({ baseUrl, login: reviewer.login, password: 'manager123' });
      const inspect = async () => ({
        detail: await json(await request(cookie, 'accountability/accounts/' + owner.id), 200),
        list: await json(await request(cookie, 'accountability/accounts'), 200),
      });
      const before = await inspect();
      if (effect === 'deny') assert.deepEqual(before.list, [], 'Retain old list fail-closed behavior');
      else assert(before.list.some((r: { user: { id: string } }) => r.user.id === owner.id));
      const legacy = await db.userAccessRule.findUniqueOrThrow({ where: { userId_actionCode: { userId: reviewer.id, actionCode: 'accountability.review' } } });
      await save(reviewer.id, [{ actionCode: 'tasks.read', effect: 'deny', scope: 'all', selectedIds: [] }]);
      assert.deepEqual(await inspect(), before, 'Unrelated admin save cannot reinterpret existing assigned runtime');
      assert.deepEqual(await db.userAccessRule.findUniqueOrThrow({ where: { id: legacy.id } }), legacy);
      await save(reviewer.id, [{ actionCode: 'accountability.review', effect: 'default', scope: 'assigned', selectedIds: [] }]);
      const after = await inspect();
      assert(after.list.some((r: { user: { id: string } }) => r.user.id === owner.id));
      assert.deepEqual(after.detail, before.detail);
    }
  });
});
