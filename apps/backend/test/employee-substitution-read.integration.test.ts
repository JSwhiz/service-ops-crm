import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { AccessChange } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Page = { total: number; limit: number; items: Array<{ id: string; employeeName: string; substituteEmployeeName: string; object: { id: string; name: string; canView: boolean } }> };
const leaf = 'objects.substitutions.read';

test('workforce read scopes before count/search/pagination, keeps source denies and fresh-cookie revoke without writes', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const marker = `workforce-read-${randomUUID()}`;
  const actor = await db.user.create({ data: { login: marker, fullName: marker, passwordHash: manager.passwordHash, isActive: true } });
  const objects = await Promise.all(['A', 'B'].map((name) => db.object.create({ data: { name: `${marker}-${name}`, address: marker, status: 'active', createdByUserId: founder.id } })));
  const [a, b] = objects;
  const employees = await Promise.all(['Основной', 'Подменный'].map((fullName) => db.employee.create({ data: { fullName: `${marker} ${fullName}`, employmentStatus: 'active' } })));
  const [primary, replacement] = employees;
  assert.ok(a && b && primary && replacement);
  const assignment = await db.objectAssignment.create({ data: { objectId: a.id, userId: actor.id, assignmentRoleCode: 'manager', isActive: true } });
  const rows = await Promise.all([a.id, b.id, null].map((objectId) => db.employeeSubstitution.create({ data: {
    objectId, employeeId: primary.id, substituteEmployeeId: replacement.id, createdByUserId: founder.id,
    startDate: new Date('2026-11-17T00:00:00+03:00'), endDate: null, status: 'active', reason: 'fixture only',
    ratePolicySnapshot: { amount: 987654, private: 'NEVER_EXPOSE_RATE' },
  } })));
  const ids = rows.map((row) => row.id);
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const adminCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const endpoint = `${baseUrl}/api/v1`;
  const saveRules = async (changes: AccessChange[]) => {
    const detail = await fetch(`${endpoint}/users-access/admin/users/${actor.id}`, { headers: { Cookie: adminCookie } });
    assert.equal(detail.status, 200);
    const { accessVersion } = await detail.json() as { accessVersion: number };
    const payload = { expectedVersion: accessVersion, reason: marker, changes };
    const preview = await fetch(`${endpoint}/users-access/admin/users/${actor.id}/preview`, {
      method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(preview.status, 201, await preview.clone().text());
    const result = await preview.json() as { previewToken: string; previewHash: string };
    const saved = await fetch(`${endpoint}/users-access/admin/users/${actor.id}/save`, {
      method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, previewToken: result.previewToken, previewHash: result.previewHash }),
    });
    assert.equal(saved.status, 201, await saved.clone().text());
  };
  const capture = async () => Promise.all([
    db.employeeSubstitution.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    db.object.findMany({ where: { id: { in: objects.map((x) => x.id) } }, orderBy: { id: 'asc' } }),
    db.employee.findMany({ where: { id: { in: employees.map((x) => x.id) } }, orderBy: { id: 'asc' } }),
    db.objectAssignment.findMany({ where: { id: assignment.id } }),
    db.user.findUnique({ where: { id: actor.id }, select: { accessVersion: true } }),
    db.userAccessRule.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    db.userAccessAudit.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    db.userAccessPreview.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    db.auditEvent.findMany({ where: { entityId: { in: [...ids, ...objects.map((x) => x.id)] } }, orderBy: { id: 'asc' } }),
  ]);
  const get = async (query = '', expected = 200): Promise<Page> => {
    const before = await capture();
    const response = await fetch(`${endpoint}/workforce-substitutions${query}`, { headers: { Cookie: actorCookie } });
    assert.equal(response.status, expected, await response.clone().text());
    assert.deepEqual(await capture(), before, 'GET never changes domain/ACL/history/preview/version rows');
    return await response.json() as Page;
  };

  await get('', 403); // No role or permission bearing full HR access; baseline is false.
  await saveRules([{ actionCode: leaf, effect: 'allow', scope: 'selected', selectedIds: [a.id] }]);
  const selected = await get('?limit=1');
  assert.equal(selected.total, 1);
  assert.equal(selected.items[0]?.object.id, a.id);
  assert.equal(selected.items[0]?.employeeName, primary.fullName);
  assert.equal(selected.items[0]?.substituteEmployeeName, replacement.fullName);
  await db.object.update({ where: { id: a.id }, data: { deletedAt: new Date(), status: 'archived' } });
  assert.equal((await get()).total, 0, 'soft-deleted source never enters scoped list/count');
  await get(`?objectId=${a.id}`, 403);
  await db.object.update({ where: { id: a.id }, data: { deletedAt: null } });
  assert.equal((await get()).total, 1, 'historical archived status alone does not erase readable history');
  await db.object.update({ where: { id: a.id }, data: { status: 'active' } });

  for (const forbidden of ['NEVER_EXPOSE_RATE', 'ratePolicySnapshot', 'rateOptionId', 'baseDailyRate', 'createdByUserId', 'password', 'reason', 'comment']) assert.ok(!JSON.stringify(selected).includes(forbidden));
  assert.equal((await get(`?q=${encodeURIComponent(b.name)}`)).total, 0);
  assert.equal((await get(`?q=${encodeURIComponent(primary.fullName)}`)).total, 1);
  assert.equal((await get('?to=2026-11-16')).total, 0);
  assert.equal((await get('?from=2026-11-18')).total, 1); // Open-ended interval overlaps.
  await get(`?objectId=${b.id}`, 403);
  assert.equal((await get(`?objectId=${a.id}`)).total, 1);
  await get('?limit=51', 400);
  await get('?from=2026-02-31', 400);
  await get('?from=2026-11-18&to=2026-11-17', 400);

  await saveRules([{ actionCode: leaf, effect: 'allow', scope: 'assigned', selectedIds: [] }]);
  assert.equal((await get()).items[0]?.object.id, a.id);
  await db.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
  assert.equal((await get()).total, 0, 'assigned uses live ObjectAssignment, never User delegation');
  await db.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: true } });
  await saveRules([{ actionCode: leaf, effect: 'allow', scope: 'selected', selectedIds: [a.id, b.id] }]);
  const firstPage = await get('?limit=1&page=1');
  const secondPage = await get('?limit=1&page=2');
  assert.equal(firstPage.total, 2, 'null-object row never enters count');
  assert.equal(secondPage.total, 2);
  assert.equal(firstPage.items.length, 1);
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(firstPage.items[0]?.id, secondPage.items[0]?.id, 'stable ordered pagination');
  await saveRules([{ actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [a.id] }]);
  const sourceDeny = await get();
  assert.equal(sourceDeny.total, 1);
  assert.equal(sourceDeny.items[0]?.object.id, b.id);
  assert.equal(sourceDeny.items[0]?.object.canView, false, 'limited names do not grant full object card');
  await saveRules([{ actionCode: 'objects.access', effect: 'deny', scope: 'selected', selectedIds: [b.id] }]);
  assert.equal((await get()).total, 0, 'root deny and source deny are both applied before count');
  await saveRules([
    { actionCode: 'objects.access', effect: 'default', scope: 'all', selectedIds: [] },
    { actionCode: 'objects.read', effect: 'default', scope: 'all', selectedIds: [] },
    { actionCode: 'employees.view', effect: 'deny', scope: 'selected', selectedIds: [primary.id] },
  ]);
  assert.equal((await get()).total, 0, 'explicit employee source deny still hides the name');
  await saveRules([{ actionCode: leaf, effect: 'deny', scope: 'selected', selectedIds: [a.id, b.id] }]);
  await get('', 403); // Same cookie, canonical access change, fresh request.
});
