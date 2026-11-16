import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { AccessChange, AccessRule } from '../src/modules/users-access/types/access-policy.type';
import { AccessAdminService } from '../src/modules/users-access/access-admin.service';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface Preview {
  previewToken: string;
  previewHash: string;
  expectedVersion: number;
  effective: Array<{ actionCode: string; allowed: boolean | null; warnings: string[] }>;
  warnings: string[];
}

test('ACL admin HTTP: preview/save ownership, validation, baseline, versions and last founder', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const marker = `acl-admin-${randomUUID()}`;
  const [template, managerRole, founderRole] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'founder' } }),
  ]);
  const makeUser = async (suffix: string, founder = false) => {
    const user = await prisma.user.create({ data: {
      login: `${marker}-${suffix}`, fullName: `ACL admin ${suffix}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: founder ? founderRole.id : managerRole.id } },
    } });
    const cookie = await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' });
    return { ...user, cookie };
  };
  const founder = await makeUser('founder', true);
  const otherFounder = await makeUser('other-founder', true);
  const request = (path: string, cookie = founder.cookie, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const endpoint = (id: string, suffix = '') => `/users-access/admin/users/${id}${suffix}`;
  const change = (effect: AccessChange['effect'], code = 'objects.read'): AccessChange => ({ actionCode: code, effect, scope: 'all' });
  const payload = async (id: string, changes: AccessChange[], reason = 'Independent ACL HTTP acceptance') => ({
    expectedVersion: (await prisma.user.findUniqueOrThrow({ where: { id } })).accessVersion,
    reason, changes,
  });
  const preview = async (id: string, body: Awaited<ReturnType<typeof payload>>, cookie = founder.cookie) => {
    const response = await request(endpoint(id, '/preview'), cookie, body);
    assert.equal(response.status, 201, await response.clone().text());
    return response.json() as Promise<Preview>;
  };
  const saveBody = (body: Awaited<ReturnType<typeof payload>>, result: Preview) => ({
    ...body, previewToken: result.previewToken, previewHash: result.previewHash,
  });
  const snapshot = async (id: string) => ({
    version: (await prisma.user.findUniqueOrThrow({ where: { id } })).accessVersion,
    rules: await prisma.userAccessRule.findMany({ where: { userId: id }, orderBy: { actionCode: 'asc' } }),
    auditCount: await prisma.userAccessAudit.count({ where: { userId: id } }),
  });

  await t.test('only founder: every admin endpoint rejects a manager, including own account', async () => {
    const target = await makeUser('not-founder');
    const body = await payload(target.id, [change('allow')]);
    for (const path of ['/users-access/admin/catalog', '/users-access/admin/users', '/users-access/admin/resources?resourceType=user',
      endpoint(target.id), endpoint(target.id, '/effective'), endpoint(target.id, '/assignments'), endpoint(target.id, '/history')]) {
      assert.equal((await request(path, target.cookie)).status, 403, path);
    }
    assert.equal((await request(endpoint(target.id, '/preview'), target.cookie, body)).status, 403);
    assert.equal((await request(endpoint(target.id, '/save'), target.cookie, {
      ...body, previewToken: 'a'.repeat(64), previewHash: 'b'.repeat(64),
    })).status, 403);
    assert.equal((await snapshot(target.id)).auditCount, 0);
    const unauthenticated = await fetch(`${baseUrl}/api/v1/users-access/admin/catalog`);
    assert.equal(unauthenticated.status, 401);
  });

  await t.test('founder resources validates types/ids and preserves soft-delete invariant through q', async () => {
    const reader = await makeUser('resource-reader');
    const q = `${marker}-resource-picker`;
    const objects = await Promise.all([
      { name: `${q}-active`, deletedAt: null },
      { name: `${q}-deleted`, deletedAt: new Date() },
      { name: `${marker}-unrelated`, deletedAt: null },
    ].map((row) => prisma.object.create({ data: {
      ...row, address: 'Independent resource picker fixture', status: 'active', createdByUserId: founder.id,
    } })));
    const path = (params: Record<string, string>) => `/users-access/admin/resources?${new URLSearchParams(params)}`;
    const resources = async (params: Record<string, string>) => {
      const response = await request(path(params));
      assert.equal(response.status, 200, await response.clone().text());
      return response.json() as Promise<{ items: Array<{ id: string; label: string; description?: string }>; hasMore: boolean }>;
    };
    const hydrate = await resources({ resourceType: 'object', ids: objects.map((row) => row.id).join(',') });
    assert.deepEqual(new Set(hydrate.items.map((row) => row.id)), new Set([objects[0].id, objects[2].id]));
    assert.equal(hydrate.hasMore, false);
    assert.ok(hydrate.items.every((row) => row.label && row.description === 'Independent resource picker fixture'));
    const search = await resources({ resourceType: 'object', q });
    assert.deepEqual(search.items.map((row) => row.id), [objects[0].id]);
    const combined = await resources({ resourceType: 'object', q, ids: objects[1].id });
    assert.deepEqual(combined.items.map((row) => row.id), [objects[0].id],
      'q searches available options; stale selected ids must not bypass deletedAt invariant');
    const deletedById = await resources({ resourceType: 'object', q: objects[1].id });
    assert.deepEqual(deletedById.items, []);
    const unknown = await resources({ resourceType: 'object', ids: randomUUID() });
    assert.deepEqual(unknown.items, []);
    const caseNormalized = await resources({ resourceType: 'object', ids: ` ${objects[0].id.toUpperCase()} ` });
    assert.deepEqual(caseNormalized.items.map((row) => row.id), [objects[0].id]);
    for (const resourceType of ['object', 'one_time_order', 'order', 'user', 'inventory_item', 'item',
      'equipment_unit', 'unit', 'counterparty', 'employee', 'candidate', 'task', 'approval', 'chat_room', 'file']) {
      const empty = await resources({ resourceType, ids: randomUUID() });
      assert.deepEqual(empty.items, [], resourceType);
      assert.equal(empty.hasMore, false, resourceType);
    }
    const selectedUser = await resources({ resourceType: 'user', ids: reader.id });
    assert.deepEqual(selectedUser.items.map((row) => row.id), [reader.id]);
    assert.equal(selectedUser.items[0].label, reader.fullName);
    assert.equal(selectedUser.items[0].description, reader.login);
    const invalidResourceQueries: Record<string, string>[] = [
      { resourceType: 'unknown_type' }, { resourceType: 'object', ids: 'invalid-id' },
      { resourceType: 'object', ids: '' }, { resourceType: 'object', ids: `${objects[0].id},${objects[0].id.toUpperCase()}` },
      { resourceType: 'object', ids: Array.from({ length: 201 }, () => randomUUID()).join(',') },
    ];
    for (const params of invalidResourceQueries) assert.equal((await request(path(params))).status, 400, JSON.stringify(params));
    assert.equal((await request('/users-access/admin/resources')).status, 400);
    assert.equal((await request(path({ resourceType: 'user', ids: founder.id }), reader.cookie)).status, 403);
    assert.equal((await request(path({ resourceType: 'object', q }), reader.cookie)).status, 403);
  });

  await t.test('preview is read-only; save records exact audit; deny/default retain old roles and permissions', async () => {
    const target = await makeUser('baseline');
    const legacy = await prisma.permission.findUniqueOrThrow({ where: { code: 'objects.read' } });
    await prisma.userPermission.create({ data: { userId: target.id, permissionId: legacy.id } });
    const before = await snapshot(target.id);
    const object = await prisma.object.create({ data: {
      name: `${marker}-baseline-object`, address: 'Isolated fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: { userId: target.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const baselineResponse = await request(`/objects/${object.id}`, target.cookie);
    assert.equal(baselineResponse.status, 200, await baselineResponse.clone().text());
    const legacySources = await prisma.userPermission.findMany({ where: { userId: target.id } });
    const oldRoles = await prisma.userRole.findMany({ where: { userId: target.id } });
    const deny = await payload(target.id, [change('deny', 'objects.access'), change('allow')]);
    const p = await preview(target.id, deny);
    assert.match(p.previewToken, /^[a-f0-9]{64}$/);
    assert.match(p.previewHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await snapshot(target.id), before);
    const ineffective = p.effective.find((row) => row.actionCode === 'objects.read');
    assert.equal(ineffective?.allowed, false);
    assert.ok(ineffective?.warnings.includes('ineffective_child_allow_parent_or_legacy_deny'));
    const savedResponse = await request(endpoint(target.id, '/save'), founder.cookie, saveBody(deny, p));
    assert.equal(savedResponse.status, 201, await savedResponse.clone().text());
    const saved = await savedResponse.json() as { accessVersion: number; rules: AccessRule[] };
    assert.equal(saved.accessVersion, before.version + 1);
    assert.equal(saved.rules.length, 2);
    const blocked = await request(`/objects/${object.id}`, target.cookie);
    assert.ok([403, 404].includes(blocked.status), 'Same old session must observe the new object deny');
    const meResponse = await request('/auth/me', target.cookie);
    assert.equal(meResponse.status, 200);
    const me = await meResponse.json() as { accessVersion: number; accessRules: AccessRule[] };
    assert.equal(me.accessVersion, saved.accessVersion);
    assert.equal(me.accessRules.length, 2);
    const historyResponse = await request(endpoint(target.id, '/history'));
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as {
      total: number; items: Array<{ actorUserId: string; versionBefore: number; versionAfter: number; reason: string; before: unknown; after: unknown }>;
    };
    assert.equal(history.total, 1);
    assert.equal(history.items[0].actorUserId, founder.id);
    assert.equal(history.items[0].versionBefore, before.version);
    assert.equal(history.items[0].versionAfter, saved.accessVersion);
    assert.equal(history.items[0].reason, deny.reason);
    assert.deepEqual(history.items[0].before, []);
    assert.deepEqual(history.items[0].after, saved.rules);
    const reset = await payload(target.id, [change('default', 'objects.access'), change('default')]);
    const resetPreview = await preview(target.id, reset);
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, saveBody(reset, resetPreview))).status, 201);
    assert.deepEqual((await snapshot(target.id)).rules, []);
    assert.deepEqual(await prisma.userPermission.findMany({ where: { userId: target.id } }), legacySources);
    assert.deepEqual(await prisma.userRole.findMany({ where: { userId: target.id } }), oldRoles);
    assert.equal((await request(`/objects/${object.id}`, target.cookie)).status, baselineResponse.status);
    const detailResponse = await request(endpoint(target.id));
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { sources: { userPermissions: Array<{ code: string }> } };
    assert.ok(detail.sources.userPermissions.some((entry) => entry.code === 'objects.read'));
  });

  await t.test('bad code/scope/UUID/selected resources/reason are rejected without writes', async () => {
    const target = await makeUser('invalid');
    const base = await payload(target.id, [change('allow')]);
    const before = await snapshot(target.id);
    const unknownId = randomUUID();
    for (const body of [
      { ...base, reason: '   ' },
      { ...base, changes: [{ ...change('allow'), actionCode: 'objects.unknown_action' }] },
      { ...base, changes: [{ ...change('allow'), scope: 'unknown_scope' }] },
      { ...base, changes: [{ ...change('allow', 'objects.create'), scope: 'own' }] },
      { ...base, changes: [{ ...change('allow'), scope: 'selected', selectedIds: [] }] },
      { ...base, changes: [{ ...change('allow'), scope: 'selected', selectedIds: ['not-a-uuid'] }] },
      { ...base, changes: [{ ...change('allow'), scope: 'selected', selectedIds: [unknownId] }] },
      { ...base, changes: [{ ...change('allow'), scope: 'selected', selectedIds: [target.id] }] },
      { ...base, changes: [{ ...change('allow'), scope: 'selected', selectedIds: [unknownId, unknownId] }] },
      { ...base, changes: [change('allow'), change('deny')] },
      { ...base, changes: [change('allow', 'accountability.expenses.approve')] },
    ]) {
      const response = await request(endpoint(target.id, '/preview'), founder.cookie, body);
      assert.equal(response.status, 400, await response.clone().text());
      assert.deepEqual(await snapshot(target.id), before);
    }
    assert.equal((await request(endpoint(unknownId))).status, 404);
    assert.equal((await request(endpoint(unknownId, '/preview'), founder.cookie, base)).status, 404);
    assert.equal((await request(endpoint('not-a-uuid'))).status, 400);
  });

  await t.test('preview token is bound to actor, target, payload/hash, expiry and one save', async () => {
    const target = await makeUser('token');
    const other = await makeUser('other-target');
    const body = await payload(target.id, [change('allow')]);
    const p = await preview(target.id, body);
    const original = saveBody(body, p);
    const before = await snapshot(target.id);
    for (const [id, cookie, input] of [
      [target.id, otherFounder.cookie, original], [other.id, founder.cookie, original],
      [target.id, founder.cookie, { ...original, reason: 'Different reason' }],
      [target.id, founder.cookie, { ...original, changes: [change('deny')] }],
      [target.id, founder.cookie, { ...original, previewHash: '0'.repeat(64) }],
      [target.id, founder.cookie, { ...original, previewToken: '0'.repeat(64) }],
    ] as const) {
      assert.equal((await request(endpoint(id, '/save'), cookie, input)).status, 409);
      assert.deepEqual(await snapshot(target.id), before);
    }
    const expired = await preview(target.id, body);
    await prisma.userAccessPreview.updateMany({ where: { userId: target.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, saveBody(body, expired))).status, 409);
    const fresh = await preview(target.id, body);
    const save = saveBody(body, fresh);
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, save)).status, 201);
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, save)).status, 409);
    assert.equal((await snapshot(target.id)).auditCount, 1);
  });

  await t.test('version race has exactly one winner and never overwrites another preview', async () => {
    const target = await makeUser('race');
    const allow = await payload(target.id, [change('allow')]);
    const deny = await payload(target.id, [change('deny')]);
    const a = await preview(target.id, allow);
    const b = await preview(target.id, deny);
    const responses = await Promise.all([
      request(endpoint(target.id, '/save'), founder.cookie, saveBody(allow, a)),
      request(endpoint(target.id, '/save'), founder.cookie, saveBody(deny, b)),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const stored = await snapshot(target.id);
    assert.equal(stored.version, allow.expectedVersion + 1);
    assert.equal(stored.auditCount, 1);
    assert.equal(stored.rules.length, 1);
    assert.equal(stored.rules[0].effect, responses[0].status === 201 ? 'allow' : 'deny');
    assert.equal((await request(endpoint(target.id, '/preview'), founder.cookie, allow)).status, 409);
  });

  await t.test('save revalidates assignment sources and existence of selected ids', async () => {
    const target = await makeUser('impact');
    const object = await prisma.object.create({ data: {
      name: `${marker}-impact`, address: 'Fixture', status: 'active', createdByUserId: founder.id,
    } });
    const input = await payload(target.id, [change('allow')]);
    const p = await preview(target.id, input);
    await prisma.objectAssignment.create({ data: { userId: target.id, objectId: object.id, assignmentRoleCode: 'manager' } });
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, saveBody(input, p))).status, 409);
    const selected = await payload(target.id, [{ ...change('allow'), scope: 'selected', selectedIds: [object.id] }]);
    const selectedPreview = await preview(target.id, selected);
    await prisma.object.update({ where: { id: object.id }, data: { deletedAt: new Date() } });
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, saveBody(selected, selectedPreview))).status, 400);
    assert.equal((await snapshot(target.id)).auditCount, 0);
  });

  await t.test('legacy candidates.denied remains visible and defeats a new candidate allow', async () => {
    const target = await makeUser('candidate-denied');
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'candidates.denied' } });
    await prisma.userPermission.create({ data: { userId: target.id, permissionId: permission.id } });
    const body = await payload(target.id, [change('allow', 'candidates.view')]);
    const p = await preview(target.id, body);
    assert.equal(p.effective.find((row) => row.actionCode === 'candidates.view')?.allowed, false);
    assert.equal((await request(endpoint(target.id, '/save'), founder.cookie, saveBody(body, p))).status, 201);
    const response = await request(endpoint(target.id, '/effective'));
    assert.equal(response.status, 200);
    const effective = await response.json() as { sources: { userPermissions: Array<{ code: string; effect: string }> } };
    assert.ok(effective.sources.userPermissions.some((entry) => entry.code === 'candidates.denied' && entry.effect === 'deny'));
  });

  await t.test('slow preview and save exceed the old five-second limit, reuse baseline once and apply exactly once', async () => {
    const target = await makeUser('slow-access-transaction');
    const body = await payload(target.id, [change('allow')]);
    const service = app.get(AccessAdminService) as unknown as {
      baseline: (...args: unknown[]) => Promise<unknown>;
    };
    const original = service.baseline;
    let baselineCalls = 0;
    service.baseline = async function (...args) {
      baselineCalls++;
      const result = await original.apply(this, args);
      await delay(5200);
      return result;
    };
    try {
      const checked = await preview(target.id, body);
      assert.equal(baselineCalls, 1, 'Preview must hash and display the same baseline');
      assert.deepEqual(await snapshot(target.id), { version: 0, rules: [], auditCount: 0 });
      const saved = await request(endpoint(target.id, '/save'), founder.cookie, saveBody(body, checked));
      assert.equal(saved.status, 201, await saved.clone().text());
      assert.equal(baselineCalls, 2, 'Save must read its baseline only once too');
      const state = await snapshot(target.id);
      assert.equal(state.version, 1);
      assert.equal(state.rules.length, 1);
      assert.equal(state.auditCount, 1);
      const repeated = await request(endpoint(target.id, '/save'), founder.cookie, saveBody(body, checked));
      assert.equal(repeated.status, 409);
      assert.deepEqual(await snapshot(target.id), state);
    } finally {
      service.baseline = original;
    }
  });

  // Last: deliberately leaves only two usable founders in this file's isolated schema.
  await t.test('concurrent cross-founder denial cannot lock out both administrators', async () => {
    await prisma.user.updateMany({ where: {
      id: { notIn: [founder.id, otherFounder.id] }, roles: { some: { role: { code: 'founder' } } },
    }, data: { isActive: false } });
    const a = await payload(otherFounder.id, [change('deny', 'users_access.manage')]);
    const b = await payload(founder.id, [change('deny', 'users_access.manage')]);
    const pa = await preview(otherFounder.id, a, founder.cookie);
    const pb = await preview(founder.id, b, otherFounder.cookie);
    const responses = await Promise.all([
      request(endpoint(otherFounder.id, '/save'), founder.cookie, saveBody(a, pa)),
      request(endpoint(founder.id, '/save'), otherFounder.cookie, saveBody(b, pb)),
    ]);
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.ok(responses.some((response) => [403, 409].includes(response.status)));
    const founders = await prisma.user.findMany({ where: { id: { in: [founder.id, otherFounder.id] } }, include: { accessRules: true } });
    const usable = founders.filter((user) => !user.accessRules.some((entry) => entry.actionCode === 'users_access.manage' && entry.effect === 'deny'));
    assert.equal(usable.length, 1);
    const survivor = usable[0].id === founder.id ? founder : otherFounder;
    for (const code of ['users_access.manage', 'auth.access', 'auth.login', 'auth.me', 'auth.refresh']) {
      const body = await payload(survivor.id, [change('deny', code)]);
      const response = await request(endpoint(survivor.id, '/preview'), survivor.cookie, body);
      assert.equal(response.status, 403, `${code}: ${await response.clone().text()}`);
    }
    const noLogin = await makeUser('founder-without-login', true);
    await prisma.userAccessRule.create({ data: {
      userId: noLogin.id, actionCode: 'auth.login', effect: 'deny', scope: 'all',
    } });
    const inactive = await makeUser('inactive-founder', true);
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    for (const code of ['users_access.manage', 'auth.access', 'auth.login', 'auth.me']) {
      const body = await payload(survivor.id, [change('deny', code)]);
      const response = await request(endpoint(survivor.id, '/preview'), survivor.cookie, body);
      assert.equal(response.status, 403,
        `${code}: inactive/login-denied founders must not count as usable fallback: ${await response.clone().text()}`);
    }
  });
});
