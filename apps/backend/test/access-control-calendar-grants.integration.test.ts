import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { UserAbsenceListResponseDto, UserAbsenceResponseDto } from '../src/modules/user-absences/dto/user-absence.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'selected' | 'all';
type Operation = 'create' | 'update' | 'delete';
type StoredAbsence = {
  id: string; userId: string; absenceType: string; startDate: Date; endDate: Date;
  comment: string | null; createdByUserId: string; updatedByUserId: string;
  deletedAt: Date | null; deletedByUserId: string | null;
};

test('all eight user_absences actions enforce live calendar grants through HTTP and stored effects', async (t) => {
  // This file must never fall back to the shared development or production schema.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.deepEqual(ACCESS_ACTION_CATALOG.filter((action) => action.module === 'user_absences')
    .map((action) => action.code).sort(), [
    'access', 'read', 'view_all', 'create', 'update', 'delete', 'manage', 'view_private_reasons',
  ].map((suffix) => `user_absences.${suffix}`).sort());

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const [actor, a, b, privileged] = await Promise.all(['manager1', 'manager2', 'lazutina', 'kireeva']
    .map((login) => prisma.user.findUniqueOrThrow({ where: { login } })));
  const targetIds = [actor.id, a.id, b.id];
  const ruleUserIds = [actor.id, privileged.id];
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: ruleUserIds } } }), 0,
    'This scenario requires untouched seeded ACL profiles in its dedicated runner schema');
  // Log in once: every allow, deny, default and revoke below uses these same cookies.
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const privilegedCookie = await loginAndGetCookieHeader({ baseUrl, login: privileged.login, password: 'kireeva123' });
  const request = (cookie: string, path = '', method = 'GET', body?: unknown) => fetch(
    `${baseUrl}/api/v1/user-absences${path}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const expectStatus = async (response: Response, status: number) => {
    assert.equal(response.status, status, await response.clone().text());
    return response;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], userId = actor.id) =>
    prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode: `user_absences.${suffix}` } },
      create: { userId, actionCode: `user_absences.${suffix}`, effect, scope, selectedIds },
      update: { effect, scope, selectedIds },
    });
  const reset = () => prisma.userAccessRule.deleteMany({
    where: { userId: { in: ruleUserIds }, actionCode: { startsWith: 'user_absences.' } },
  });
  const revoke = (suffix: string, userId = actor.id) => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId, actionCode: `user_absences.${suffix}` } },
  });
  const snapshot = async () => ({
    // Include soft-deleted rows and complete row metadata, not just endpoint counts.
    rows: await prisma.$queryRaw<StoredAbsence[]>`SELECT * FROM "user_absences" ORDER BY "id"`,
    audits: await prisma.auditEvent.findMany({ where: { entityType: 'user_absence' }, orderBy: { id: 'asc' } }),
  });
  let dateIndex = 0;
  const nextDate = () => new Date(Date.UTC(2040, 0, 1 + dateIndex++ * 3)).toISOString().slice(0, 10);
  const fixture = async (userId: string, comment = `Private calendar reason ${userId}`) => {
    const date = nextDate();
    const response = await expectStatus(await request(privilegedCookie, '', 'POST', {
      userId, absenceType: 'vacation', startDate: date, endDate: date, comment,
    }), 201);
    return await response.json() as UserAbsenceResponseDto;
  };
  const fixtures = await Promise.all(targetIds.map((id) => fixture(id)));
  const list = async (cookie = actorCookie, userId?: string) => {
    const response = await expectStatus(await request(cookie, userId ? `?userId=${userId}` : ''), 200);
    return await response.json() as UserAbsenceListResponseDto;
  };
  const assertVisible = async (visibleIds: string[], cookie = actorCookie) => {
    const before = await snapshot();
    const body = await list(cookie);
    for (const item of fixtures) {
      assert.equal(body.items.some((row) => row.id === item.id), visibleIds.includes(item.userId));
      const direct = await list(cookie, item.userId);
      assert.equal(direct.items.some((row) => row.id === item.id), visibleIds.includes(item.userId),
        'An explicit target query must not bypass the collection filter');
    }
    const directory = await expectStatus(await request(cookie, '/users'), 200);
    const users = await directory.json() as Array<{ id: string }>;
    for (const id of targetIds) assert.equal(users.some((row) => row.id === id), visibleIds.includes(id));
    assert.deepEqual(await snapshot(), before, 'Calendar and directory reads must not mutate absences or their audit');
  };
  const assertReasons = async (visibleIds: string[], cookie = actorCookie) => {
    const before = await snapshot();
    for (const item of fixtures) {
      for (const body of [await list(cookie), await list(cookie, item.userId)]) {
        const actual = body.items.find((row) => row.id === item.id);
        assert.ok(actual);
        assert.equal(actual.comment, visibleIds.includes(item.userId) ? item.comment : null);
        assert.equal(actual.absenceType, item.absenceType);
        assert.equal(actual.startDate, item.startDate);
        assert.equal(actual.endDate, item.endDate);
      }
    }
    assert.deepEqual(await snapshot(), before);
  };

  await t.test('user_absences.read: defaults, own/selected/all deny and return to default filter list and directory', async () => {
    await assertVisible(targetIds);
    await rule('read', 'allow', 'own');
    await assertVisible(targetIds); // Allows add to legacy free/busy; they do not narrow it.
    await rule('read', 'allow', 'selected', [a.id]);
    await assertVisible(targetIds);
    await rule('read', 'allow', 'all');
    await assertVisible(targetIds);
    await rule('read', 'deny', 'own');
    await assertVisible([a.id, b.id]);
    await rule('read', 'deny', 'selected', [a.id]);
    await assertVisible([actor.id, b.id]);
    await rule('read', 'deny', 'all');
    await assertVisible([]);
    await revoke('read');
    await assertVisible(targetIds);
  });

  await t.test('user_absences.view_all: colleague denial keeps own calendar, selected B remains a control', async () => {
    await reset();
    await rule('view_all', 'allow', 'own');
    await assertVisible(targetIds);
    await rule('view_all', 'allow', 'selected', [a.id]);
    await assertVisible(targetIds);
    await rule('view_all', 'allow', 'all');
    await assertVisible(targetIds);
    await rule('view_all', 'deny', 'selected', [a.id]);
    await assertVisible([actor.id, b.id]);
    await rule('view_all', 'deny', 'own');
    await assertVisible(targetIds); // This leaf controls foreign availability, not the owner branch.
    await rule('view_all', 'deny', 'all');
    await assertVisible([actor.id]);
    await revoke('view_all');
    await assertVisible(targetIds);
  });

  await t.test('user_absences.view_private_reasons: selected A, own/all, explicit deny, revoke and seeded privileged default', async () => {
    await reset();
    await assertReasons([actor.id]);
    await rule('view_private_reasons', 'allow', 'own');
    await assertReasons([actor.id]);
    await rule('view_private_reasons', 'allow', 'selected', [a.id]);
    await assertReasons([actor.id, a.id]);
    await revoke('view_private_reasons');
    await assertReasons([actor.id]);
    await rule('view_private_reasons', 'allow', 'all');
    await assertReasons(targetIds);
    await rule('view_private_reasons', 'deny', 'own');
    await assertReasons([]);
    await revoke('view_private_reasons');
    await assertReasons(targetIds, privilegedCookie);
    await rule('view_private_reasons', 'deny', 'selected', [a.id], privileged.id);
    await assertReasons([actor.id, b.id], privilegedCookie);
    await revoke('view_private_reasons', privileged.id);
    await assertReasons(targetIds, privilegedCookie);
  });

  // Every mutation attempt has a real, non-overlapping target. Fixture setup completes
  // before the snapshot so a 403 must leave both data and audit exactly unchanged.
  const mutate = async (operation: Operation, userId: string, allowed: boolean, cookie = actorCookie,
    bodyOverride?: Record<string, unknown>) => {
    const current = operation === 'create' ? undefined : await fixture(userId);
    const date = nextDate();
    const body = operation === 'create'
      ? { userId, absenceType: 'day_off', startDate: date, endDate: date, ...bodyOverride }
      : operation === 'update' ? { absenceType: 'sick_leave', ...bodyOverride } : undefined;
    const before = await snapshot();
    const response = await request(cookie, current ? `/${current.id}` : '',
      operation === 'create' ? 'POST' : operation === 'update' ? 'PATCH' : 'DELETE', body);
    await expectStatus(response, allowed ? (operation === 'create' ? 201 : 200) : 403);
    const after = await snapshot();
    if (!allowed) {
      assert.deepEqual(after, before, `${operation} denial must preserve all calendar rows and absence audits`);
      return;
    }
    const result = await response.json() as { id: string; deleted?: boolean; comment?: string | null };
    const row = after.rows.find((item) => item.id === result.id);
    assert.ok(row);
    assert.equal(row.userId, userId);
    const actingId = cookie === privilegedCookie ? privileged.id : actor.id;
    assert.equal(row.updatedByUserId, actingId);
    assert.equal(after.rows.length, before.rows.length + (operation === 'create' ? 1 : 0));
    assert.deepEqual(after.rows.filter((item) => item.id !== row.id), before.rows.filter((item) => item.id !== row.id),
      'Every unrelated row, including control B, must remain unchanged');
    const previous = before.rows.find((item) => item.id === row.id);
    if (operation === 'create') {
      assert.equal(row.createdByUserId, actingId);
      assert.equal(row.absenceType, 'day_off');
      assert.equal(row.startDate.toISOString().slice(0, 10), date);
      assert.equal(row.endDate.toISOString().slice(0, 10), date);
      assert.equal(row.comment, bodyOverride?.comment ?? null);
      assert.equal(row.deletedAt, null);
    } else {
      assert.ok(previous);
      assert.equal(row.createdByUserId, previous.createdByUserId);
      assert.equal(row.comment, bodyOverride?.comment ?? previous.comment);
      assert.deepEqual(row.startDate, previous.startDate);
      assert.deepEqual(row.endDate, previous.endDate);
      if (operation === 'update') {
        assert.equal(row.absenceType, 'sick_leave');
        assert.equal(row.deletedAt, null);
      } else {
        assert.equal(result.deleted, true);
        assert.equal(row.absenceType, previous.absenceType);
        assert.ok(row.deletedAt);
        assert.equal(row.deletedByUserId, actingId);
      }
    }
    const addedAudits = after.audits.filter((event) => !before.audits.some((old) => old.id === event.id));
    assert.equal(addedAudits.length, 1);
    assert.deepEqual(after.audits.filter((event) => event.id !== addedAudits[0].id), before.audits);
    const event = addedAudits[0];
    assert.equal(event.entityId, row.id);
    assert.equal(event.actorUserId, actingId);
    assert.equal(event.action, `user_absence.${operation === 'create' ? 'created' : operation === 'update' ? 'updated' : 'deleted'}`);
    assert.deepEqual(event.metadata, { targetUserId: userId });
    if (operation !== 'create') assert.deepEqual(event.oldValues, {
      userId, absenceType: previous!.absenceType, startDate: previous!.startDate.toISOString().slice(0, 10),
      endDate: previous!.endDate.toISOString().slice(0, 10), comment: previous!.comment,
    });
    if (operation === 'delete') {
      assert.ok((event.newValues as { deletedAt: string }).deletedAt);
      assert.ok(!(await list(cookie, userId)).items.some((item) => item.id === row.id));
    } else {
      assert.deepEqual(event.newValues, {
        userId, absenceType: row.absenceType, startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate.toISOString().slice(0, 10), comment: row.comment,
      });
      const visible = (await list(cookie, userId)).items.find((item) => item.id === row.id);
      assert.ok(visible);
      assert.equal(result.comment, visible.comment, 'Mutation responses must use the same reason redaction as reads');
      if (cookie === actorCookie && userId !== actor.id && !bodyOverride?.comment) {
        assert.equal(result.comment, null);
      }
    }
  };

  for (const operation of ['create', 'update', 'delete'] as const) {
    await t.test(`user_absences.${operation}: own default/deny and selected/all foreign grants with live revoke`, async () => {
      await reset();
      await mutate(operation, actor.id, true);
      await mutate(operation, a.id, false);
      await rule(operation, 'deny', 'own');
      await mutate(operation, actor.id, false);
      await revoke(operation);
      await mutate(operation, actor.id, true);
      await rule(operation, 'allow', 'own');
      await rule('manage', 'allow', 'selected', [a.id]);
      await mutate(operation, a.id, false);
      await revoke('manage');
      await rule(operation, 'allow', 'selected', [a.id]);
      await mutate(operation, a.id, false); // A leaf alone cannot manage a colleague.
      await rule('manage', 'allow', 'selected', [a.id]);
      await mutate(operation, a.id, true);
      await mutate(operation, b.id, false);
      await revoke(operation);
      await mutate(operation, a.id, false); // Same cookie, successful grant now revoked.
      await rule(operation, 'allow', 'selected', [a.id]);
      await mutate(operation, a.id, true);
      await rule('manage', 'deny', 'selected', [a.id]);
      await mutate(operation, a.id, false);
      await rule('manage', 'allow', 'all');
      await mutate(operation, b.id, false); // manage alone still cannot supply B's leaf.
      await rule(operation, 'allow', 'all');
      await mutate(operation, b.id, true);
      await rule(operation, 'deny', 'selected', [a.id], privileged.id);
      await mutate(operation, a.id, false, privilegedCookie); // Deny beats seeded permission.
      await revoke(operation, privileged.id);
      await mutate(operation, a.id, true, privilegedCookie);
    });
  }

  await t.test('user_absences.manage: own/selected/all, revoke and deny never confer private reason authority', async () => {
    await reset();
    await rule('create', 'allow', 'all');
    await rule('update', 'allow', 'all');
    await rule('manage', 'allow', 'own');
    await mutate('create', a.id, false);
    await rule('manage', 'allow', 'selected', [a.id]);
    await mutate('create', a.id, true);
    await mutate('create', b.id, false);
    await mutate('create', a.id, false, actorCookie, { comment: 'Unauthorized private reason' });
    await mutate('update', a.id, false, actorCookie, { comment: 'Unauthorized overwrite' });
    await mutate('update', a.id, false, actorCookie, { comment: null });
    await rule('view_private_reasons', 'allow', 'selected', [a.id]);
    await mutate('create', a.id, true, actorCookie, { comment: 'Authorized private reason' });
    await mutate('update', a.id, true, actorCookie, { comment: 'Authorized overwrite' });
    await revoke('view_private_reasons');
    await mutate('update', a.id, false, actorCookie, { comment: 'Revoked private reason' });
    await revoke('manage');
    await mutate('create', a.id, false);
    await rule('manage', 'allow', 'all');
    await mutate('create', b.id, true);
    await rule('manage', 'deny', 'selected', [a.id], privileged.id);
    await mutate('create', a.id, false, privilegedCookie);
    await mutate('create', b.id, true, privilegedCookie);
    await revoke('manage', privileged.id);
    await mutate('create', a.id, true, privilegedCookie);
  });

  await t.test('selected target capabilities match the real operations without advertising all-user administration', async () => {
    await reset();
    try {
      await rule('access', 'deny', 'own');
      await rule('manage', 'allow', 'selected', [a.id]);
      await rule('create', 'allow', 'selected', [a.id]);
      await rule('update', 'allow', 'selected', [a.id]);
      await rule('delete', 'deny', 'selected', [a.id]);
      const response = await list();
      assert.equal(response.capabilities.canManage, true, 'A visible selected target can be created even when own access is denied');
      assert.equal(response.capabilities.canManageAll, false, 'Selected rights never advertise blanket administration');
      const target = response.items.find((item) => item.id === fixtures[1].id);
      const control = response.items.find((item) => item.id === fixtures[2].id);
      assert.ok(target && control);
      assert.deepEqual(target.capabilities, { canUpdate: true, canDelete: false, canViewPrivateReasons: false });
      assert.deepEqual(control.capabilities, { canUpdate: false, canDelete: false, canViewPrivateReasons: false });
      const directory = await expectStatus(await request(actorCookie, '/users'), 200);
      const users = await directory.json() as Array<{ id: string; capabilities: { canCreate: boolean; canViewPrivateReasons: boolean } }>;
      assert.deepEqual(users.find((item) => item.id === a.id)?.capabilities, { canCreate: true, canViewPrivateReasons: false });
      assert.equal(users.find((item) => item.id === b.id)?.capabilities.canCreate, false);
      assert.equal(users.some((item) => item.id === actor.id), false);
      await mutate('create', a.id, true);
      await mutate('update', a.id, true);
      await mutate('delete', a.id, false);
      await mutate('create', b.id, false);
      await revoke('update');
      assert.equal((await list()).items.find((item) => item.id === target.id)?.capabilities.canUpdate, false);
      await mutate('update', a.id, false);
      await revoke('create');
      assert.equal((await list()).capabilities.canManage, false);
      await mutate('create', a.id, false);
      await rule('view_private_reasons', 'allow', 'selected', [a.id]);
      const privateRead = (await list()).items.find((item) => item.id === target.id);
      assert.equal(privateRead?.capabilities.canViewPrivateReasons, true);
      assert.equal(privateRead?.comment, fixtures[1].comment);
    } finally { await reset(); }
  });

  await t.test('user_absences.access: parent deny defeats all leaves, hides reasons and prevents all mutation effects', async () => {
    await reset();
    for (const suffix of ['read', 'view_all', 'create', 'update', 'delete', 'manage', 'view_private_reasons']) {
      await rule(suffix, 'allow', 'all');
    }
    await rule('access', 'allow', 'own');
    await assertVisible(targetIds);
    await rule('access', 'allow', 'selected', [a.id]);
    await assertVisible(targetIds);
    await rule('access', 'allow', 'all');
    await assertVisible(targetIds);
    await rule('access', 'deny', 'selected', [a.id]);
    await assertVisible([actor.id, b.id]);
    for (const operation of ['create', 'update', 'delete'] as const) await mutate(operation, a.id, false);
    await mutate('update', b.id, true, actorCookie, { comment: 'Unblocked B private reason' });
    await rule('access', 'deny', 'own');
    await assertVisible([a.id, b.id]);
    for (const operation of ['create', 'update', 'delete'] as const) await mutate(operation, actor.id, false);
    await rule('access', 'deny', 'all');
    await assertVisible([]);
    for (const operation of ['create', 'update', 'delete'] as const) await mutate(operation, a.id, false);
    await revoke('access');
    await assertVisible(targetIds);
    await assertReasons(targetIds);
    await mutate('update', a.id, true, actorCookie, { comment: 'Restored parent access' });
    await reset();
    await assertReasons([actor.id]);
    // No manual fixture cleanup: the sequential runner drops this isolated schema.
  });
});
