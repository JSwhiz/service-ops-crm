import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type DirectoryRow = { id: string; fullName: string };
type Day = { plan: { id: string; managerUserId: string } | null; capabilities: {
  canManage: boolean; canManageVisits: boolean; canManageReports: boolean;
} };

test('visit manager discovery follows own/selected read scope without granting plan management', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, managerRole, hrRole, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }), prisma.role.findUniqueOrThrow({ where: { code: 'hr' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-visit-discovery-${randomUUID()}`;
  const actors = await Promise.all(['reader', 'manager-a', 'control-b', 'inactive', 'deleted', 'non-manager'].map((suffix) => prisma.user.create({ data: {
    login: `${marker}-${suffix}`, fullName: `${marker}-${suffix}`, passwordHash: template.passwordHash,
    isActive: suffix !== 'inactive', deletedAt: suffix === 'deleted' ? new Date() : null,
    roles: { create: { roleId: suffix === 'non-manager' ? hrRole.id : managerRole.id } },
  } })));
  const [reader, managerA, controlB, inactive, deleted, nonManager] = actors;
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const date = '2030-01-01';
  const plans = await Promise.all([reader, managerA, controlB].map((manager) => prisma.managerVisitPlan.create({ data: {
    managerUserId: manager.id, planDate: new Date(`${date}T00:00:00Z`), createdByUserId: founder.id,
    entries: { create: { clientName: `${marker}-client`, createdByUserId: founder.id } },
  }, include: { entries: true } })));
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const directory = async () => {
    const response = await request('/visit-plans/managers');
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as DirectoryRow[];
  };
  const assertDirectory = async (ids: string[]) => {
    const rows = await directory();
    assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(ids), JSON.stringify(rows));
    assert.ok(rows.every((row) => row.fullName));
  };
  const day = async (managerUserId: string) => {
    const response = await request(`/visit-plans?${new URLSearchParams({ date, managerUserId })}`);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as Day;
  };
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: reader.id } });
  const grant = (ids: string[]) => prisma.userAccessRule.create({ data: {
    userId: reader.id, actionCode: 'visit_plans.read', effect: 'allow', scope: 'selected', selectedIds: ids,
  } });
  await t.test('non-global manager discovers/reads own actual plan only with no write capabilities', async () => {
    await assertDirectory([reader.id]);
    const own = await day(reader.id);
    assert.equal(own.plan?.id, plans[0].id);
    assert.deepEqual(own.capabilities, { canManage: false, canManageVisits: false, canManageReports: false });
    for (const actor of [managerA, controlB]) {
      assert.equal((await request(`/visit-plans?${new URLSearchParams({ date, managerUserId: actor.id })}`)).status, 403);
    }
  });
  await t.test('selected manager A adds only A, not control B; original cookie sees grant, revoke and restore', async () => {
    await reset();
    const allow = await grant([managerA.id]);
    await assertDirectory([reader.id, managerA.id]);
    assert.equal((await day(managerA.id)).plan?.id, plans[1].id);
    assert.equal((await request(`/visit-plans?${new URLSearchParams({ date, managerUserId: controlB.id })}`)).status, 403);
    await prisma.userAccessRule.delete({ where: { id: allow.id } });
    await assertDirectory([reader.id]);
    assert.equal((await request(`/visit-plans?${new URLSearchParams({ date, managerUserId: managerA.id })}`)).status, 403);
    await grant([managerA.id]);
    await assertDirectory([reader.id, managerA.id]);
    assert.equal((await day(managerA.id)).plan?.id, plans[1].id);
  });
  await t.test('selected read does not grant create, add-entry, visit or report mutation authority', async () => {
    await reset();
    await grant([managerA.id]);
    const readable = await day(managerA.id);
    assert.deepEqual(readable.capabilities, { canManage: false, canManageVisits: false, canManageReports: false });
    const snapshot = () => prisma.managerVisitPlan.findUniqueOrThrow({ where: { id: plans[1].id }, include: { entries: true } });
    const before = await snapshot();
    const planCount = await prisma.managerVisitPlan.count({ where: { managerUserId: { in: [reader.id, managerA.id] } } });
    const attempts = [
      { path: '/visit-plans', method: 'POST', body: { managerUserId: managerA.id, planDate: '2030-01-02' } },
      { path: `/visit-plans/${plans[1].id}/entries`, method: 'POST', body: { expectedVersion: 1, clientName: 'Denied extra client', isUnplanned: true } },
      { path: `/visit-plans/${plans[1].id}/entries/${plans[1].entries[0].id}/visit`, method: 'PATCH', body: { expectedVersion: 1, visited: true, visitReport: 'Denied visit' } },
      { path: `/visit-plans/${plans[1].id}/report`, method: 'PATCH', body: { expectedVersion: 1, report: 'Denied report', closeReport: true } },
    ];
    for (const attempt of attempts) {
      const response = await request(attempt.path, attempt.method, attempt.body);
      assert.equal(response.status, 403, `${attempt.path}: ${await response.clone().text()}`);
      assert.deepEqual(await snapshot(), before);
    }
    assert.equal(await prisma.managerVisitPlan.count({ where: { managerUserId: { in: [reader.id, managerA.id] } } }), planCount);
  });
  await t.test('directory preserves active/not-deleted/manager-role eligibility even for explicitly selected IDs', async () => {
    await reset();
    await grant([managerA.id, inactive.id, deleted.id, nonManager.id]);
    await assertDirectory([reader.id, managerA.id]);
  });
  await t.test('root module deny blocks directory and direct day despite selected read grant in the same cookie', async () => {
    await reset();
    await grant([managerA.id]);
    await assertDirectory([reader.id, managerA.id]);
    const deny = await prisma.userAccessRule.create({ data: {
      userId: reader.id, actionCode: 'visit_plans.access', effect: 'deny', scope: 'all',
    } });
    await assertDirectory([]);
    for (const manager of [reader, managerA]) assert.equal((await request(`/visit-plans?${new URLSearchParams({ date, managerUserId: manager.id })}`)).status, 403);
    await prisma.userAccessRule.delete({ where: { id: deny.id } });
    await assertDirectory([reader.id, managerA.id]);
    assert.equal((await day(managerA.id)).capabilities.canManage, false);
  });
});
