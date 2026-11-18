import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { UserAbsencesService } from '../src/modules/user-absences/user-absences.service';
import type { UserAbsenceListResponseDto, UserAbsenceResponseDto, UserAbsenceUserOptionDto } from '../src/modules/user-absences/dto/user-absence.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('calendar PATCH preserves a concurrently saved private reason, explicit-null authority and inactive-target flags', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [actor, target] = await Promise.all(['manager1', 'manager2'].map((login) => prisma.user.findUniqueOrThrow({ where: { login } })));
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const privileged = await loginAndGetCookieHeader({ baseUrl, login: 'kireeva', password: 'kireeva123' });
  await prisma.userAccessRule.createMany({ data: ['user_absences.update', 'user_absences.manage'].map((actionCode) => ({
    userId: actor.id, actionCode, effect: 'allow', scope: 'selected', selectedIds: [target.id],
  })) });
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1/user-absences${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async <T,>(response: Response, expected = 200) => {
    assert.equal(response.status, expected, await response.clone().text());
    return response.json() as Promise<T>;
  };
  const created = await json<UserAbsenceResponseDto>(await request('', 'POST', {
    userId: target.id, absenceType: 'vacation', startDate: '2042-03-10', endDate: '2042-03-10', comment: 'Initial private reason',
  }, privileged), 201);
  const snapshot = async () => ({
    rows: await prisma.$queryRaw`SELECT * FROM "user_absences" WHERE "id" = ${created.id}`,
    audits: await prisma.auditEvent.findMany({ where: { entityType: 'user_absence', entityId: created.id }, orderBy: { id: 'asc' } }),
  });

  await t.test('metadata PATCH paused after its initial read preserves a later private update and exact old/new audit', async () => {
    const before = await snapshot();
    const service = app.get(UserAbsencesService) as unknown as { getById: (...args: unknown[]) => Promise<UserAbsenceResponseDto> };
    const original = service.getById;
    let unblock!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    let pause = true;
    service.getById = async (...args) => {
      const result = await original.apply(service, args);
      // Pause the first read before a transaction is opened; the competing
      // committed edit is real, but no artificial wait consumes a DB timeout.
      if (pause && args[0] === created.id) { pause = false; reached(); await gate; }
      return result;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const metadata = request(`/${created.id}`, 'PATCH', { absenceType: 'sick_leave' });
    // Attach a rejection handler immediately so a setup failure cannot leave a
    // rejected in-flight fetch unobserved while the gate is released in finally.
    void metadata.catch(() => undefined);
    try {
      await Promise.race([entered, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Metadata request did not reach controlled initial-read boundary')), 10_000);
        timer.unref();
      })]);
      await json(await request(`/${created.id}`, 'PATCH', { comment: 'New independently saved private reason' }, privileged));
      unblock();
      const result = await json<UserAbsenceResponseDto>(await metadata);
      assert.equal(result.comment, null, 'Metadata grant must not disclose the preserved private value');
      assert.deepEqual(result.capabilities, { canUpdate: true, canDelete: false, canViewPrivateReasons: false });
      const after = await snapshot();
      const row = (after.rows as Array<{ comment: string; absenceType: string }>)[0];
      assert.equal(row.comment, 'New independently saved private reason');
      assert.equal(row.absenceType, 'sick_leave');
      const added = after.audits.filter((event) => !before.audits.some((old) => old.id === event.id));
      assert.equal(added.length, 2, 'Each successful PATCH must produce exactly one audit event');
      const own = added.filter((event) => event.actorUserId === actor.id);
      assert.equal(own.length, 1);
      const last = own[0];
      assert.equal(last.action, 'user_absence.updated');
      const latestValues = {
        userId: target.id, absenceType: 'vacation',
        startDate: '2042-03-10', endDate: '2042-03-10', comment: row.comment,
      };
      assert.deepEqual(last.oldValues, latestValues);
      assert.deepEqual(last.newValues, { ...latestValues, absenceType: 'sick_leave' });
      assert.deepEqual(last.metadata, { targetUserId: target.id });
    } finally {
      if (timer) clearTimeout(timer);
      unblock();
      await metadata.catch(() => undefined);
      service.getById = original;
    }
  });
  await t.test('explicit null cannot clear a foreign private reason without permission; authorized null clears with audit', async () => {
    const before = await snapshot();
    const denied = await request(`/${created.id}`, 'PATCH', { comment: null });
    assert.equal(denied.status, 403);
    assert.deepEqual(await snapshot(), before);
    const result = await json<UserAbsenceResponseDto>(await request(`/${created.id}`, 'PATCH', { comment: null }, privileged));
    assert.equal(result.comment, null);
    const after = await snapshot();
    assert.equal((after.rows as Array<{ comment: null }>)[0].comment, null);
    const added = after.audits.filter((event) => !before.audits.some((old) => old.id === event.id));
    assert.equal(added.length, 1);
    assert.equal((added[0].oldValues as { comment: string }).comment, 'New independently saved private reason');
    assert.equal((added[0].newValues as { comment: null }).comment, null);
  });
  await t.test('inactive target remains readable without actionable flags or write effects', async () => {
    await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
    try {
      const before = await snapshot();
      const list = await json<UserAbsenceListResponseDto>(await request(`?userId=${target.id}`));
      const item = list.items.find((entry) => entry.id === created.id);
      assert.ok(item);
      assert.equal(item.capabilities.canUpdate, false);
      assert.equal(item.capabilities.canDelete, false);
      const users = await json<UserAbsenceUserOptionDto[]>(await request('/users'));
      assert.equal(users.some((entry) => entry.id === target.id), false);
      const rejected = await request(`/${created.id}`, 'PATCH', { absenceType: 'vacation' });
      assert.equal(rejected.status, 404, await rejected.clone().text());
      assert.deepEqual(await snapshot(), before);
    } finally { await prisma.user.update({ where: { id: target.id }, data: { isActive: true } }); }
  });
});
