import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Day = { plan: { id: string; version: number } | null; capabilities: {
  canManage: boolean; canManageVisits: boolean; canManageReports: boolean;
} };

test('visit-plan personal grants use manager User scope and preserve versions, history and control B', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const [managerA, managerB, founder, hr] = await Promise.all(['manager2', 'eliseeva', 'founder', 'hr1'].map((login) =>
    prisma.user.findUniqueOrThrow({ where: { login } })));
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const permissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissions.includes('visit_plans.manage'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'visit_plans.' } } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-visit-plan-${randomUUID()}`;
  const objectIds: string[] = [];
  for (const [label, users] of [
    ['shared', [actor.id, managerA.id]], ['manager-only', [managerA.id]], ['control', [actor.id, managerB.id]],
  ] as const) {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated visit-plan fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: users.map((userId) => ({ userId, assignmentRoleCode: 'manager', isActive: true })) },
    } });
    objectIds.push(object.id);
  }
  const [sharedObject, managerOnlyObject, controlObject] = objectIds;
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', ids?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: ids ? 'selected' : 'all', selectedIds: ids ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1/visit-plans${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const dayPath = (id: string, date: string) => `?${new URLSearchParams({ date, managerUserId: id })}`;
  const day = async (id: string, date: string) => {
    const response = await request(dayPath(id, date));
    await status(response, 200);
    return await response.json() as Day;
  };
  const fixture = (managerUserId: string, date: string) => prisma.managerVisitPlan.create({ data: {
    managerUserId, planDate: new Date(`${date}T00:00:00Z`), createdByUserId: founder.id,
    entries: { create: { clientName: `${marker}-initial`, createdByUserId: founder.id } },
  }, include: { entries: true } });
  const capture = async () => {
    const [plans, entries, audit, objects, assignments] = await Promise.all([
      prisma.managerVisitPlan.findMany({ orderBy: { id: 'asc' } }),
      prisma.managerVisitPlanEntry.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: 'manager_visit_plan' }, orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { plans, entries, audit, objects, assignments };
  };
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403) => {
    const before = await capture();
    await status(await request(path, method, body), expected);
    assert.deepEqual(await capture(), before, `${method} ${path}: no unauthorized data, version or audit changes`);
  };
  const version = async (id: string) => (await prisma.managerVisitPlan.findUniqueOrThrow({ where: { id } })).version;
  const auditDelta = (before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>, id: string, action: string) => {
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].actorUserId, actor.id);
    assert.equal(added[0].entityId, id);
    assert.equal(added[0].action, action);
    assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(after.assignments, before.assignments);
    return added[0];
  };
  const mutate = async (id: string, suffix: string, method: string, fields: Record<string, unknown>, action: string) => {
    const before = await capture();
    const old = before.plans.find((row) => row.id === id)!;
    const response = await request(`/${id}${suffix}`, method, { expectedVersion: old.version, ...fields });
    await status(response, method === 'POST' ? 201 : 200);
    const after = await capture();
    const saved = after.plans.find((row) => row.id === id)!;
    assert.equal(saved.version, old.version + 1);
    const expected = { ...old, version: saved.version, updatedAt: saved.updatedAt };
    if (suffix === '/deadline') expected.reportDueAt = fields.reportDueAt ? new Date(fields.reportDueAt as string) : null;
    if (suffix === '/report') {
      expected.report = (fields.report as string).trim() || null;
      expected.reportClosedAt = fields.closeReport ? saved.reportClosedAt : null;
      assert.equal(Boolean(saved.reportClosedAt), fields.closeReport);
    }
    assert.deepEqual(saved, expected);
    assert.deepEqual(after.plans.filter((row) => row.id !== id), before.plans.filter((row) => row.id !== id));
    assert.deepEqual(after.entries.filter((row) => row.planId !== id), before.entries.filter((row) => row.planId !== id));
    const event = auditDelta(before, after, id, action);
    return { before, after, saved, event };
  };

  await t.test('access/read/history: selected manager identity, directory, default/revoke and parent denies', async (suite) => {
    suite.after(resetRules);
    const date = '2035-08-01';
    const a = await fixture(managerA.id, date);
    const b = await fixture(managerB.id, date);
    const own = await fixture(actor.id, date);
    const before = await capture();
    assert.equal((await day(actor.id, date)).plan?.id, own.id);
    await rejected(dayPath(managerA.id, date));
    await rejected(dayPath(managerB.id, date));
    const access = await rule('visit_plans.access', 'allow', [managerA.id]);
    await rejected(dayPath(managerA.id, date)); // Section allow alone does not grant reading.
    await removeRule(access.id);
    const history = await rule('visit_plans.history', 'allow', [managerA.id]);
    await rejected(`/${a.id}/history`); // History leaf cannot bypass plan visibility.
    await removeRule(history.id);
    let allow = await rule('visit_plans.read', 'allow', [managerA.id]);
    assert.equal((await day(managerA.id, date)).plan?.id, a.id);
    assert.deepEqual((await day(managerA.id, date)).capabilities, { canManage: false, canManageVisits: false, canManageReports: false });
    await rejected(dayPath(managerB.id, date));
    const directory = await request('/managers');
    await status(directory, 200);
    assert.deepEqual(new Set((await directory.json() as Array<{ id: string }>).map(({ id }) => id)), new Set([actor.id, managerA.id]));
    await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
    await rejected(dayPath(managerA.id, date));
    await removeRule(allow.id);
    await rejected(dayPath(managerA.id, date));
    allow = await rule('visit_plans.read', 'allow', [managerA.id, managerB.id]);
    const historyDeny = await rule('visit_plans.history', 'deny', [managerA.id]);
    await rejected(`/${a.id}/history`);
    await status(await request(`/${b.id}/history`), 200);
    await removeRule(historyDeny.id);
    await status(await request(`/${a.id}/history`), 200);
    const parent = await rule('visit_plans.access', 'deny', [managerA.id]);
    await rejected(dayPath(managerA.id, date));
    await rejected(`/${a.id}/history`);
    assert.equal((await day(managerB.id, date)).plan?.id, b.id);
    await removeRule(parent.id);
    assert.equal((await day(managerA.id, date)).plan?.id, a.id);
    assert.deepEqual(await capture(), before, 'Reads and access-rule changes do not create plan data/audit');
    await removeRule(allow.id);
  });

  for (const leaf of ['manage', 'visits.manage', 'reports.manage'] as const) {
    await t.test(`visit_plans.${leaf}: selected grant, control B, live deny/default/revoke and version invariants`, async (suite) => {
      suite.after(resetRules);
      const date = leaf === 'manage' ? '2035-08-02' : leaf === 'visits.manage' ? '2035-08-03' : '2035-08-04';
      const a = await fixture(managerA.id, date);
      const b = await fixture(managerB.id, date);
      const readAllow = await rule('visit_plans.read', 'allow', [managerA.id, managerB.id]);
      const attempt = async (plan: typeof a) => ({ expectedVersion: await version(plan.id),
        ...(leaf === 'manage' ? { clientName: `${marker}-added`, isUnplanned: true }
          : leaf === 'visits.manage' ? { visited: true, visitReport: marker } : { report: marker, closeReport: true }) });
      const suffix = (plan: typeof a) => leaf === 'manage' ? '/entries'
        : leaf === 'visits.manage' ? `/entries/${plan.entries[0].id}/visit` : '/report';
      const method = leaf === 'manage' ? 'POST' : 'PATCH';
      const denyWrite = async (plan: typeof a) => rejected(`/${plan.id}${suffix(plan)}`, method, await attempt(plan));
      for (const plan of [a, b]) await denyWrite(plan);
      let allow = await rule(`visit_plans.${leaf}`, 'allow', [managerA.id]);
      const capability = leaf === 'manage' ? 'canManage' : leaf === 'visits.manage' ? 'canManageVisits' : 'canManageReports';
      const caps = (await day(managerA.id, date)).capabilities;
      assert.equal(caps[capability], true);
      if (leaf !== 'manage') {
        assert.equal(caps.canManage, false);
        assert.equal(leaf === 'visits.manage' ? caps.canManageReports : caps.canManageVisits, false);
        await rejected('', 'POST', { managerUserId: managerA.id, planDate: '2035-08-10' });
        await rejected(`/${a.id}/entries`, 'POST', { expectedVersion: await version(a.id), clientName: 'No bundle leakage' });
      }
      assert.equal((await day(managerB.id, date)).capabilities[capability], false);
      await denyWrite(b);
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      assert.equal((await day(managerA.id, date)).capabilities[capability], false);
      await denyWrite(a);
      await removeRule(allow.id);
      await denyWrite(a);
      allow = await rule(`visit_plans.${leaf}`, 'allow', [managerA.id]);
      for (const code of ['visit_plans.access', 'visit_plans.read', ...(leaf === 'manage' ? [] : ['visit_plans.manage'])]) {
        if (code === 'visit_plans.read') {
          // One rule per user/action: replacing the allow also removes B's
          // only foreign-read grant. Restore it before checking control B.
          await prisma.userAccessRule.update({ where: { id: readAllow.id }, data: { effect: 'deny', selectedIds: [managerA.id] } });
          await denyWrite(a);
          await rejected(dayPath(managerB.id, date));
          await prisma.userAccessRule.update({ where: { id: readAllow.id }, data: { effect: 'allow', selectedIds: [managerA.id, managerB.id] } });
          await day(managerB.id, date);
          continue;
        }
        const deny = await rule(code, 'deny', [managerA.id]);
        await denyWrite(a);
        await day(managerB.id, date);
        await removeRule(deny.id);
      }
      await rejected(`/${a.id}${suffix(a)}`, method, { ...await attempt(a), expectedVersion: a.version + 1 }, 409);
      if (leaf === 'manage') {
        await rejected('', 'POST', { managerUserId: managerB.id, planDate: '2035-08-10' });
        await rejected(`/${b.id}/deadline`, 'PATCH', { expectedVersion: await version(b.id), reportDueAt: '2035-08-12T12:00:00Z' });
        await rejected(`/${b.id}/entries/${b.entries[0].id}`, 'DELETE', { expectedVersion: await version(b.id) });
        const before = await capture();
        const response = await request('', 'POST', { managerUserId: managerA.id, planDate: '2035-08-10', reportDueAt: '2035-08-11T12:00:00Z' });
        await status(response, 201);
        const created = await response.json() as { id: string };
        const after = await capture();
        const row = after.plans.find(({ id }) => id === created.id)!;
        assert.equal(row.managerUserId, managerA.id);
        assert.equal(row.createdByUserId, actor.id);
        assert.equal(row.version, 1);
        assert.equal(row.reportDueAt?.toISOString(), '2035-08-11T12:00:00.000Z');
        assert.deepEqual(after.plans.filter(({ id }) => id !== created.id), before.plans);
        assert.deepEqual(after.entries, before.entries);
        auditDelta(before, after, created.id, 'visit_plan.created');
        await rejected('', 'POST', { managerUserId: managerA.id, planDate: '2035-08-10' }, 409);
        await rejected(`/${a.id}/entries`, 'POST', { expectedVersion: await version(a.id), objectId: sharedObject, clientName: 'Exactly one target' }, 400);
        for (const objectId of [managerOnlyObject, controlObject]) await rejected(`/${a.id}/entries`, 'POST', { expectedVersion: await version(a.id), objectId });
        const added = await mutate(a.id, '/entries', 'POST', { objectId: sharedObject }, 'visit_plan.entry_added');
        const newEntries = added.after.entries.filter((row) => !added.before.entries.some(({ id }) => id === row.id));
        assert.equal(newEntries.length, 1);
        assert.equal(newEntries[0].objectId, sharedObject);
        assert.equal(newEntries[0].createdByUserId, actor.id);
        assert.deepEqual(added.after.entries.filter(({ id }) => id !== newEntries[0].id), added.before.entries);
        const unplanned = await mutate(a.id, '/entries', 'POST', { clientName: `${marker}-unplanned`, isUnplanned: true }, 'visit_plan.unplanned_added');
        const entryId = (unplanned.event.newValues as { entryId: string }).entryId;
        assert.equal(unplanned.after.entries.find(({ id }) => id === entryId)?.isUnplanned, true);
        assert.equal(unplanned.after.entries.find(({ id }) => id === entryId)?.createdByUserId, actor.id);
        assert.deepEqual(unplanned.after.entries.filter(({ id }) => id !== entryId), unplanned.before.entries);
        const deadline = await mutate(a.id, '/deadline', 'PATCH', { reportDueAt: '2035-08-12T12:00:00Z' }, 'visit_plan.deadline_saved');
        assert.deepEqual(deadline.after.entries, deadline.before.entries);
        const removed = await mutate(a.id, `/entries/${entryId}`, 'DELETE', {}, 'visit_plan.entry_removed');
        assert.deepEqual(removed.after.entries, removed.before.entries.filter(({ id }) => id !== entryId));
        assert.equal((removed.event.oldValues as { entryId: string }).entryId, entryId);
        // The bundle grants visits/reports, but an explicit leaf deny wins.
        for (const [code, route, body] of [
          ['visit_plans.visits.manage', `/entries/${a.entries[0].id}/visit`, { visited: true }],
          ['visit_plans.reports.manage', '/report', { report: marker, closeReport: false }],
        ] as const) {
          const deny = await rule(code, 'deny', [managerA.id]);
          await rejected(`/${a.id}${route}`, 'PATCH', { expectedVersion: await version(a.id), ...body });
          await removeRule(deny.id);
        }
        // A grant cannot make a non-manager a valid plan manager.
        await prisma.userAccessRule.update({ where: { id: allow.id }, data: { selectedIds: [managerA.id, hr.id] } });
        await rejected('', 'POST', { managerUserId: hr.id, planDate: '2035-08-10' }, 400);
      } else if (leaf === 'visits.manage') {
        await rejected(`/${a.id}/entries/${b.entries[0].id}/visit`, 'PATCH', { expectedVersion: await version(a.id), visited: true }, 404);
        const visited = await mutate(a.id, suffix(a), 'PATCH', { visited: true, visitReport: marker }, 'visit_plan.visit_recorded');
        const saved = visited.after.entries.find(({ id }) => id === a.entries[0].id)!;
        assert.ok(saved.visitedAt);
        assert.equal(saved.visitReport, marker);
        const old = visited.before.entries.find(({ id }) => id === saved.id)!;
        assert.deepEqual(saved, { ...old, visitedAt: saved.visitedAt, visitReport: marker, updatedAt: saved.updatedAt });
        assert.deepEqual(visited.after.entries.filter(({ id }) => id !== saved.id), visited.before.entries.filter(({ id }) => id !== saved.id));
        const undone = await mutate(a.id, suffix(a), 'PATCH', { visited: false, visitReport: '' }, 'visit_plan.visit_recorded');
        assert.equal(undone.after.entries.find(({ id }) => id === saved.id)?.visitedAt, null);
        assert.equal(undone.after.entries.find(({ id }) => id === saved.id)?.visitReport, null);
        assert.equal((undone.event.oldValues as { visitedAt: string }).visitedAt, saved.visitedAt.toISOString());
      } else {
        await rejected(`/${a.id}/report`, 'PATCH', { expectedVersion: await version(a.id), report: ' ', closeReport: true }, 400);
        const closed = await mutate(a.id, '/report', 'PATCH', { report: marker, closeReport: true }, 'visit_plan.report_saved');
        assert.deepEqual(closed.after.entries, closed.before.entries);
        const reopened = await mutate(a.id, '/report', 'PATCH', { report: 'Reopened report', closeReport: false }, 'visit_plan.report_saved');
        assert.equal(reopened.saved.reportClosedAt, null);
        assert.deepEqual(reopened.after.entries, reopened.before.entries);
      }
      const history = await request(`/${a.id}/history`);
      await status(history, 200);
      assert.ok((await history.json() as Array<{ actorUserId: string }>).some((event) => event.actorUserId === actor.id));
      await removeRule(allow.id);
      await denyWrite(a); // Revocation after successful writes, same cookie.
      await denyWrite(b);
    });
  }

  await t.test('object-options must authorize the requested manager, not merely any selected manage grant', async (suite) => {
    suite.after(resetRules);
    await rule('visit_plans.manage', 'allow', [managerA.id]);
    const before = await capture();
    const response = await request(`/object-options?${new URLSearchParams({ managerUserId: managerA.id, q: marker })}`);
    await status(response, 200);
    const options = await response.json() as { items: Array<{ id: string }>; total: number };
    assert.deepEqual(options.items.map(({ id }) => id), [sharedObject]);
    assert.equal(options.total, 1);
    // Known inspection finding: listObjectOptions currently calls assertManage
    // without managerUserId. Keep the intended scope contract visible to main.
    await rejected(`/object-options?${new URLSearchParams({ managerUserId: managerB.id, q: marker })}`);
    assert.deepEqual(await capture(), before);
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No role or legacy permission changes');
  // Main executes serially and drops the isolated schema; no external writes.
});
