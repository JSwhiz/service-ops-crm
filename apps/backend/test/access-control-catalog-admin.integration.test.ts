import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessChange } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface Result {
  accessVersion?: number;
  previewToken?: string;
  previewHash?: string;
  rules: Array<{ actionCode: string; effect: string; scope: string; selectedIds: string[] }>;
  effective: Array<{ actionCode: string; allowed: boolean | null }>;
}

// Real admin API + DB for every code; this does NOT certify each domain/UI route.
test('entire catalog administrative boundary: all/default/deny, non-grantable codes, immutable sources and exact audit', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
  ]);
  const marker = `acl-catalog-${randomUUID()}`;
  const target = await prisma.user.create({ data: { login: marker, fullName: marker, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } } } });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const recipientCookie = await loginAndGetCookieHeader({ baseUrl, login: target.login, password: 'manager123' });
  const request = (suffix: string, body?: unknown) => fetch(`${baseUrl}/api/v1/users-access/admin/${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const effective = async () => {
    const response = await request(`users/${target.id}/effective`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<Result>;
  };
  const sources = async () => ({
    roles: await prisma.userRole.findMany({ where: { userId: target.id } }),
    permissions: await prisma.userPermission.findMany({ where: { userId: target.id } }),
    objectAssignments: await prisma.objectAssignment.findMany({ where: { userId: target.id } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { userId: target.id } }),
    objectsOwned: await prisma.object.count({ where: { createdByUserId: target.id } }),
    ordersOwned: await prisma.oneTimeOrder.count({ where: { createdByUserId: target.id } }),
    memberships: await prisma.chatRoomParticipant.findMany({ where: { userId: target.id } }),
  });
  const originalSources = await sources();
  const baseline = await effective();
  const manageable = ACCESS_ACTION_CATALOG.filter((action) => action.manageable);
  const changesFor = (effect: AccessChange['effect'], all = manageable): AccessChange[] => all.map((action) => ({ actionCode: action.code, effect, scope: 'all' }));
  let version = 0;
  const apply = async (changes: AccessChange[], reason: string) => {
    const body = { expectedVersion: version, reason, changes };
    const beforeRules = await prisma.userAccessRule.findMany({ where: { userId: target.id } });
    const previewResponse = await request(`users/${target.id}/preview`, body);
    assert.equal(previewResponse.status, 201, await previewResponse.clone().text());
    const preview = await previewResponse.json() as Result;
    assert.deepEqual(await prisma.userAccessRule.findMany({ where: { userId: target.id } }), beforeRules, 'Preview cannot issue rules');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
    const saveBody = { ...body, previewToken: preview.previewToken, previewHash: preview.previewHash };
    const saved = await request(`users/${target.id}/save`, saveBody);
    assert.equal(saved.status, 201, await saved.clone().text());
    const result = await saved.json() as Result;
    version += 1;
    assert.equal(result.accessVersion, version);
    const audit = await prisma.userAccessAudit.findUniqueOrThrow({ where: { userId_versionAfter: { userId: target.id, versionAfter: version } } });
    assert.equal(audit.reason, reason);
    assert.equal(audit.versionBefore, version - 1);
    assert.deepEqual(audit.after, result.rules);
    const replay = await request(`users/${target.id}/save`, saveBody);
    assert.equal(replay.status, 409, await replay.clone().text());
    assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
    assert.deepEqual(await sources(), originalSources, 'Rules do not create roles, permissions, ownership, assignment or membership');
    return result;
  };
  await t.test('HTTP catalog includes each of the 291 unique definitions and truthful constraints', async () => {
    const response = await request('catalog');
    assert.equal(response.status, 200);
    const body = await response.json() as { actions: typeof ACCESS_ACTION_CATALOG };
    assert.equal(body.actions.length, 291);
    assert.deepEqual(body.actions, ACCESS_ACTION_CATALOG);
  });
  await t.test('all manageable codes persist in one atomic allow, with role gates still reflected', async () => {
    const result = await apply(changesFor('allow'), 'Acceptance: batch all manageable allows');
    assert.equal(result.rules.length, manageable.length);
    for (const action of manageable) {
      const rule = result.rules.find((item) => item.actionCode === action.code);
      assert.deepEqual(rule, { actionCode: action.code, effect: 'allow', scope: 'all', selectedIds: [] }, action.code);
      if (['founder_only', 'leadership_only', 'director_only'].includes(action.constraint ?? '')) {
        assert.equal(result.effective.find((item) => item.actionCode === action.code)?.allowed, false, action.code);
      } else assert.equal(result.effective.find((item) => item.actionCode === action.code)?.allowed, true, `${action.code} positive all grant`);
    }
    // Cookie predates issuance; JWT must load persisted rules rather than old claims.
    const profile = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: recipientCookie } });
    assert.equal(profile.status, 200, await profile.clone().text());
    const identity = await profile.json() as { id: string; accessVersion: number; accessRules: Result['rules'] };
    assert.equal(identity.id, target.id);
    assert.equal(identity.accessVersion, version);
    assert.deepEqual(identity.accessRules.map(({ actionCode, effect, scope, selectedIds }) => ({ actionCode, effect, scope, selectedIds }))
      .sort((a, b) => a.actionCode.localeCompare(b.actionCode)), result.rules);
  });
  await t.test('each individual manageable deny has a negative effective preview over the otherwise permitted catalog', async (t) => {
    for (const action of manageable) await t.test(action.code, async () => {
      const response = await request(`users/${target.id}/preview`, { expectedVersion: version, reason: marker,
        changes: [{ actionCode: action.code, effect: 'deny', scope: 'all' }] });
      assert.equal(response.status, 201, await response.clone().text());
      const result = await response.json() as Result;
      assert.equal(result.effective.find((item) => item.actionCode === action.code)?.allowed, false);
      const rule = await prisma.userAccessRule.findUniqueOrThrow({ where: { userId_actionCode: { userId: target.id, actionCode: action.code } } });
      assert.equal(rule.effect, 'allow', 'An individual deny preview must not persist it');
    });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
    assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
  });
  await t.test('every manageable deny persists; old recipient session is blocked by auth access, logout remains available', async () => {
    const result = await apply(changesFor('deny'), 'Acceptance: batch all manageable denies');
    for (const action of manageable) {
      assert.equal(result.rules.find((item) => item.actionCode === action.code)?.effect, 'deny', action.code);
      assert.equal(result.effective.find((item) => item.actionCode === action.code)?.allowed, false, action.code);
    }
    const profile = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: recipientCookie } });
    assert.equal(profile.status, 401);
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: recipientCookie } });
    assert.ok(logout.ok, await logout.clone().text());
  });
  await t.test('default removes all persisted rules, restores baseline and does not mutate sources', async () => {
    const result = await apply(changesFor('default', [...ACCESS_ACTION_CATALOG]), 'Acceptance: restore every catalog default');
    assert.deepEqual(result.rules, []);
    assert.deepEqual(result.effective.map(({ actionCode, allowed }) => ({ actionCode, allowed })),
      baseline.effective.map(({ actionCode, allowed }) => ({ actionCode, allowed })));
  });
  for (const action of ACCESS_ACTION_CATALOG.filter((entry) => !entry.manageable)) {
    await t.test(`${action.code}: new allow/deny is explicitly rejected and has no rule/version/audit effects`, async () => {
      for (const effect of ['allow', 'deny'] as const) {
        const response = await request(`users/${target.id}/preview`, { expectedVersion: version, reason: marker,
          changes: [{ actionCode: action.code, effect, scope: 'all' }] });
        assert.equal(response.status, 400, await response.clone().text());
        assert.ok((await response.text()).includes(`Action is constrained: ${action.code}`));
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
        assert.equal(await prisma.userAccessRule.count({ where: { userId: target.id } }), 0);
        assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
      }
    });
  }
});
