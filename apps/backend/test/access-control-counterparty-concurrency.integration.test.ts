import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { CounterpartiesService } from '../src/modules/counterparties/counterparties.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('counterparty concurrent relationship changes reject stale HTTP writes without extra effects', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds: string[] = [];
  t.after(async () => {
    try { await prisma.userAccessRule.deleteMany({ where: { id: { in: ruleIds } } }); }
    finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, include: { roles: { include: { role: true } } } });
  assert.deepEqual(manager.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: manager.id, actionCode: { startsWith: 'counterparties.' } } }), 0);
  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const marker = `counterparty-race-${randomUUID()}`;
  const request = (path: string, method = 'POST', cookie = managerCookie) => fetch(`${baseUrl}/api/v1/counterparties${path}`, {
    method, headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000),
  });
  const expectStatus = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };

  const fixture = async (label: string) => {
    const counterparties = await Promise.all(['A', 'B', 'C'].map((suffix) => prisma.counterparty.create({ data: {
      name: `${marker}-${label}-${suffix}`, notes: 'Concurrency fixture', createdByUserId: founder.id,
    } })));
    const [a, b, c] = counterparties;
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}-object`, address: 'Isolated concurrency fixture', status: 'active',
      createdByUserId: founder.id, counterpartyId: a!.id, masterForCounterpartyId: a!.id,
      assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    // Every paused request has a real selected leaf grant, not a fabricated role.
    const allow = await prisma.userAccessRule.create({ data: {
      userId: manager.id, actionCode: 'counterparties.objects.link', effect: 'allow', scope: 'selected',
      selectedIds: counterparties.map(({ id }) => id),
    } });
    ruleIds.push(allow.id);
    const capture = async () => ({
      counterparties: await prisma.counterparty.findMany({ where: { id: { in: counterparties.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      object: await prisma.object.findUniqueOrThrow({ where: { id: object.id } }),
      assignments: await prisma.objectAssignment.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      events: await prisma.auditEvent.findMany({ where: { OR: [
        { entityType: 'counterparty', entityId: { in: counterparties.map(({ id }) => id) } },
        { entityType: 'object', entityId: object.id },
      ] }, orderBy: { id: 'asc' } }),
      objectLogs: await prisma.objectAuditLog.findMany({ where: { objectId: object.id }, orderBy: { id: 'asc' } }),
      movements: await prisma.inventoryMovement.findMany({ where: { relatedObjectId: object.id }, orderBy: { id: 'asc' } }),
    });
    return { a: a!, b: b!, c: c!, object, capture, allowId: allow.id };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Snapshot = Awaited<ReturnType<Fixture['capture']>>;
  // Observe a real initial read; do not replace its data, mock a transaction,
  // count arbitrary background transactions or pause while holding DB locks.
  type ReadBoundary = {
    loadLinkableObject: (user: { id: string }, id: string, database?: unknown) => Promise<{
      id: string; counterpartyId: string | null; masterForCounterpartyId: string | null;
    }>;
  };
  const service = app.get(CounterpartiesService) as unknown as ReadBoundary;
  const originalRead = service.loadLinkableObject;
  t.after(() => { service.loadLinkableObject = originalRead; });
  const race = async (data: Fixture, path: string, method: string, compete: (before: Snapshot) => Promise<void>, statuses = [409]) => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    let claimed = false;
    service.loadLinkableObject = async (user, id, database) => {
      const result = await originalRead.call(service, user, id, database);
      if (!claimed && user.id === manager.id && id === data.object.id && database === undefined) {
        claimed = true;
        assert.equal(result.counterpartyId, data.a.id);
        assert.equal(result.masterForCounterpartyId, data.a.id);
        entered();
        await gate;
      }
      return result;
    };
    const stale = request(path, method);
    void stale.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([reached, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Stale request did not reach the initial non-transactional object read')), 5_000);
      })]);
      if (timer) { clearTimeout(timer); timer = undefined; }
      const before = await data.capture();
      await compete(before); // Winner must commit over actual HTTP before resume.
      const committed = await data.capture();
      release();
      const response = await stale;
      const body = await response.text();
      assert.ok(statuses.includes(response.status), `Expected ${statuses.join('/')} from stale write, got ${response.status}: ${body}`);
      assert.equal(claimed, true);
      assert.deepEqual(await data.capture(), committed,
        'Rejected stale request must retain the winner exactly: no field/master/link, assignment, inventory or extra audit changes');
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await stale.catch(() => undefined);
      service.loadLinkableObject = originalRead;
      await prisma.userAccessRule.delete({ where: { id: data.allowId } });
      ruleIds.splice(ruleIds.indexOf(data.allowId), 1);
    }
  };
  const relinkWinner = async (data: Fixture, before: Snapshot) => {
    await expectStatus(await request(`/${data.b.id}/objects/${data.object.id}`, 'POST', founderCookie), 201);
    await expectStatus(await request(`/${data.b.id}/master-object/${data.object.id}`, 'POST', founderCookie), 201);
    const after = await data.capture();
    assert.deepEqual(after.object, { ...before.object, counterpartyId: data.b.id,
      masterForCounterpartyId: data.b.id, updatedAt: after.object.updatedAt });
    assert.deepEqual(after.counterparties, before.counterparties);
    assert.deepEqual(after.assignments, before.assignments);
    assert.deepEqual(after.movements, before.movements);
    const added = after.events.filter((row) => !before.events.some(({ id }) => id === row.id));
    assert.deepEqual(added.map((row) => `${row.entityType}:${row.entityId}:${row.action}`).sort(), [
      `counterparty:${data.a.id}:counterparty.master_object_cleared`,
      `counterparty:${data.a.id}:counterparty.object_unlinked_by_relink`,
      `counterparty:${data.b.id}:counterparty.object_linked`,
      `counterparty:${data.b.id}:counterparty.master_object_changed`,
      `object:${data.object.id}:object.counterparty_changed`,
    ].sort());
    assert.ok(added.every((row) => row.actorUserId === founder.id));
    const linked = added.find((row) => row.action === 'counterparty.object_linked')!;
    assert.deepEqual(linked.oldValues, { previousCounterpartyId: data.a.id });
    assert.deepEqual(linked.newValues, { objectId: data.object.id });
    const logs = after.objectLogs.filter((row) => !before.objectLogs.some(({ id }) => id === row.id));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.actorUserId, founder.id);
    assert.equal(logs[0]!.actionCode, 'object.counterparty_changed');
    assert.deepEqual(logs[0]!.payload, { oldCounterpartyId: data.a.id, newCounterpartyId: data.b.id });
  };

  await t.test('stale unlink A cannot detach the committed B relationship or erase B master/audits', async () => {
    const data = await fixture('unlink');
    await race(data, `/${data.a.id}/objects/${data.object.id}`, 'DELETE', (before) => relinkWinner(data, before));
  });

  await t.test('stale relink A to C cannot overwrite a committed relink/master B or manufacture old-A audit', async () => {
    const data = await fixture('relink');
    await race(data, `/${data.c.id}/objects/${data.object.id}`, 'POST', (before) => relinkWinner(data, before));
  });

  await t.test('stale relink also rejects a master-only change while the old counterparty remains A', async () => {
    const data = await fixture('master-only');
    await race(data, `/${data.b.id}/objects/${data.object.id}`, 'POST', async (before) => {
      await expectStatus(await request(`/${data.a.id}/master-object`, 'DELETE', founderCookie), 200);
      const after = await data.capture();
      assert.deepEqual(after.object, { ...before.object, masterForCounterpartyId: null, updatedAt: after.object.updatedAt });
      assert.deepEqual(after.counterparties, before.counterparties);
      assert.deepEqual(after.objectLogs, before.objectLogs);
      for (const key of ['assignments', 'movements'] as const) assert.deepEqual(after[key], before[key]);
      const added = after.events.filter((row) => !before.events.some(({ id }) => id === row.id));
      assert.equal(added.length, 1);
      assert.equal(added[0]!.entityId, data.a.id);
      assert.equal(added[0]!.action, 'counterparty.master_object_cleared');
      assert.equal(added[0]!.actorUserId, founder.id);
      assert.deepEqual(added[0]!.oldValues, { objectId: data.object.id });
    });
  });

  await t.test('destination archived after initial read cannot receive the stale link', async () => {
    const data = await fixture('archive-destination');
    await race(data, `/${data.b.id}/objects/${data.object.id}`, 'POST', async (before) => {
      await expectStatus(await request(`/${data.b.id}/archive`, 'POST', founderCookie), 201);
      const after = await data.capture();
      const archived = after.counterparties.find(({ id }) => id === data.b.id)!;
      assert.deepEqual(archived, { ...data.b, status: 'archived', updatedAt: archived.updatedAt });
      assert.deepEqual(after.counterparties.filter(({ id }) => id !== data.b.id), before.counterparties.filter(({ id }) => id !== data.b.id));
      for (const key of ['object', 'objectLogs', 'assignments', 'movements'] as const) assert.deepEqual(after[key], before[key]);
      const added = after.events.filter((row) => !before.events.some(({ id }) => id === row.id));
      assert.equal(added.length, 1);
      assert.equal(added[0]!.entityId, data.b.id);
      assert.equal(added[0]!.action, 'counterparty.archived');
      assert.equal(added[0]!.actorUserId, founder.id);
      assert.deepEqual(added[0]!.oldValues, { status: 'active' });
      assert.deepEqual(added[0]!.newValues, { status: 'archived' });
    }, [409, 400]);
  });
  // Main owns execution and isolated-schema disposal. This covers controlled
  // stale-read interleavings, not load/deadlock testing or browser/admin-save flows.
});
