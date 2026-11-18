import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface RegistryPage {
  items: Array<{ id: string; status: string }>;
  total: number;
  archiveCounts: { active: number; archived: number };
}

test('customer objects: scoped archive counts and repeated window-cleaning visits', { timeout: 120_000 }, async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const managerRole = await db.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const marker = `customer-object-${randomUUID()}`;
  const reader = await db.user.create({ data: { login: marker, fullName: marker, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: managerRole.id } } } });
  const admin = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const request = (cookie: string, route: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${route}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  async function json<T>(response: Response, expected = 200): Promise<T> {
    const text = await response.text(); assert.equal(response.status, expected, text); return JSON.parse(text) as T;
  }
  const makeObject = (suffix: string, status: string, deletedAt: Date | null = null) => db.object.create({ data: {
    name: `${marker}-${suffix}`, address: 'Тестовый адрес', status, deletedAt, createdByUserId: founder.id,
    assignments: { create: { userId: founder.id, assignmentRoleCode: 'responsible', isActive: true } },
  } });
  const active = await makeObject('active', 'active');
  const frozen = await makeObject('frozen', 'frozen');
  const archived = await makeObject('archived', 'archived');
  await makeObject('outside-readable-scope', 'active');
  await makeObject('soft-deleted', 'archived', new Date());
  const changes = [{ actionCode: 'objects.read', effect: 'allow', scope: 'selected', selectedIds: [active.id, frozen.id, archived.id] }];
  const proposal = { expectedVersion: reader.accessVersion, reason: 'Scoped registry fixture only', changes };
  const preview = await json<{ previewToken: string; previewHash: string }>(await request(admin, `/users-access/admin/users/${reader.id}/preview`, 'POST', proposal), 201);
  await json(await request(admin, `/users-access/admin/users/${reader.id}/save`, 'POST', { ...proposal, previewToken: preview.previewToken, previewHash: preview.previewHash }), 201);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const q = encodeURIComponent(marker);

  await t.test('default active excludes archive; counts follow full authorized search, never page size/private matches', async () => {
    const before = await db.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } });
    const page = await json<RegistryPage>(await request(cookie, `/objects?q=${q}&page=1&limit=1`));
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.notEqual(page.items[0].status, 'archived');
    assert.deepEqual(page.archiveCounts, { active: 2, archived: 1 });
    const archivePage = await json<RegistryPage>(await request(cookie, `/objects?q=${q}&archiveState=archived&page=1&limit=10`));
    assert.deepEqual(archivePage.items.map(item => item.id), [archived.id]);
    assert.deepEqual(archivePage.archiveCounts, page.archiveCounts);
    const narrowed = await json<RegistryPage>(await request(cookie, `/objects?q=${q}&status=frozen&page=1&limit=10`));
    assert.deepEqual(narrowed.items.map(item => item.id), [frozen.id]);
    assert.deepEqual(narrowed.archiveCounts, { active: 2, archived: 1 });
    const empty = await json<RegistryPage>(await request(cookie, `/objects?q=${q}-missing&page=1&limit=10`));
    assert.deepEqual(empty.archiveCounts, { active: 0, archived: 0 });
    const oldLink = await json<RegistryPage>(await request(cookie, `/objects?q=${q}&status=archived&page=1&limit=10`));
    assert.deepEqual(oldLink.items.map(item => item.id), [archived.id]);
    await json(await request(cookie, `/objects/${archived.id}`));
    assert.deepEqual(await db.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }), before);
  });

  await t.test('window-cleaning round trip keeps duplicates and legacy flag; invalid graph refuses without partial persistence', async () => {
    const legacy = await makeObject('legacy-window', 'active');
    await db.object.update({ where: { id: legacy.id }, data: { summerWindowCleaning: true } });
    type WindowCard = { summerWindowCleaning: boolean; windowCleaningMode: string | null; windowCleaningSeasons: string[] };
    const before = await json<WindowCard>(await request(admin, `/objects/${legacy.id}`));
    assert.equal(before.windowCleaningMode, null);
    assert.deepEqual(before.windowCleaningSeasons, []);
    await json(await request(admin, `/objects/${legacy.id}`, 'PATCH', { windowCleaningMode: 'scheduled', windowCleaningSeasons: ['spring', 'spring', 'autumn'] }));
    const saved = await json<WindowCard>(await request(admin, `/objects/${legacy.id}`));
    assert.equal(saved.summerWindowCleaning, true);
    assert.equal(saved.windowCleaningMode, 'scheduled');
    assert.deepEqual(saved.windowCleaningSeasons, ['spring', 'spring', 'autumn']);
    const dbBeforeInvalid = await db.object.findUniqueOrThrow({ where: { id: legacy.id } });
    await json(await request(admin, `/objects/${legacy.id}`, 'PATCH', { windowCleaningMode: 'scheduled', windowCleaningSeasons: [] }), 400);
    await json(await request(admin, `/objects/${legacy.id}`, 'PATCH', { windowCleaningMode: 'scheduled', windowCleaningSeasons: ['winter'] }), 400);
    assert.deepEqual(await db.object.findUniqueOrThrow({ where: { id: legacy.id } }), dbBeforeInvalid);
    await json(await request(admin, `/objects/${legacy.id}`, 'PATCH', { windowCleaningMode: 'on_request' }));
    const requested = await json<WindowCard>(await request(admin, `/objects/${legacy.id}`));
    assert.equal(requested.windowCleaningMode, 'on_request');
    assert.deepEqual(requested.windowCleaningSeasons, []);
    assert.equal(requested.summerWindowCleaning, true);
  });
});
