import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface EmployeeDocuments {
  id: string;
  employeeType: string;
  version: number;
  passportReceived: boolean;
  passportReceivedAt: string | null;
  passportReceivedByUserId: string | null;
  passportReceivedByName: string | null;
  contractReceived: boolean;
  contractReceivedAt: string | null;
  contractReceivedByUserId: string | null;
  contractReceivedByName: string | null;
}

test('substitution employees and document receipt changes retain server authors, audit and registry filters', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  const marker = `Документы ${randomUUID()}`;
  const [hrCookie, directorCookie, readerCookie, hr, director] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'director', password: 'director123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    prisma.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'director' } }),
  ]);
  const request = (path: string, cookie: string, method = 'GET', body?: object) => fetch(`${baseUrl}/api/v1/employees${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = async (body: object): Promise<EmployeeDocuments> => {
    const response = await request('', hrCookie, 'POST', { fullName: marker, ...body });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json() as Promise<EmployeeDocuments>;
  };
  const defaults = await create({});
  assert.equal(defaults.employeeType, 'regular');
  assert.equal(defaults.passportReceived, false);
  assert.equal(defaults.contractReceived, false);
  assert.equal(defaults.passportReceivedAt, null);
  assert.equal(defaults.passportReceivedByUserId, null);
  assert.equal(defaults.contractReceivedAt, null);
  assert.equal(defaults.contractReceivedByUserId, null);
  const oneTime = await create({ employeeType: 'one_time', contractReceived: true });
  assert.equal(oneTime.employeeType, 'one_time');
  assert.equal(oneTime.contractReceivedByUserId, hr.id);
  const created = await create({ employeeType: 'substitution', passportReceived: true });
  assert.equal(created.employeeType, 'substitution');
  assert.equal(created.passportReceived, true);
  assert.ok(created.passportReceivedAt);
  assert.equal(created.passportReceivedByUserId, hr.id);
  assert.equal(created.passportReceivedByName, hr.fullName);
  assert.equal(created.contractReceivedAt, null);

  const changeResponse = await request(`/${created.id}`, directorCookie, 'PATCH', {
    expectedVersion: created.version, passportReceived: false, contractReceived: true,
  });
  assert.equal(changeResponse.status, 200);
  const changed = await changeResponse.json() as EmployeeDocuments;
  assert.equal(changed.passportReceived, false);
  assert.equal(changed.contractReceived, true);
  assert.equal(changed.passportReceivedByUserId, director.id);
  assert.equal(changed.contractReceivedByUserId, director.id);
  assert.equal(changed.passportReceivedByName, director.fullName);
  assert.equal(changed.contractReceivedByName, director.fullName);
  assert.ok(changed.passportReceivedAt);
  assert.ok(changed.contractReceivedAt);

  const unchangedResponse = await request(`/${created.id}`, hrCookie, 'PATCH', {
    expectedVersion: changed.version, passportReceived: false, notes: 'Другие сведения',
  });
  assert.equal(unchangedResponse.status, 200);
  const unchanged = await unchangedResponse.json() as EmployeeDocuments;
  for (const field of ['passportReceivedAt', 'passportReceivedByUserId', 'contractReceivedAt', 'contractReceivedByUserId'] as const) {
    assert.equal(unchanged[field], changed[field], field);
  }
  const stale = await request(`/${created.id}`, hrCookie, 'PATCH', {
    expectedVersion: created.version, passportReceived: true,
  });
  assert.equal(stale.status, 409);
  const readOnlyMutation = await request(`/${created.id}`, readerCookie, 'PATCH', {
    expectedVersion: unchanged.version, passportReceived: true,
  });
  assert.equal(readOnlyMutation.status, 403);

  for (const employeeType of ['regular', 'one_time', 'substitution']) {
    const response = await request(`?search=${encodeURIComponent(marker)}&employeeType=${employeeType}`, hrCookie);
    assert.equal(response.status, 200);
    const list = await response.json() as { items: EmployeeDocuments[]; total: number };
    assert.equal(list.total, 1);
    assert.equal(list.items[0].employeeType, employeeType);
  }
  for (const [filter, expectedIds] of [
    ['passportReceived=false', [defaults.id, oneTime.id, created.id]],
    ['passportReceived=true', []],
    ['contractReceived=true', [oneTime.id, created.id]],
    ['passportReceived=false&contractReceived=false', [defaults.id]],
    ['employeeType=substitution&passportReceived=false&contractReceived=true', [created.id]],
  ] as const) {
    const response = await request(`?search=${encodeURIComponent(marker)}&${filter}`, hrCookie);
    assert.equal(response.status, 200);
    const list = await response.json() as { items: EmployeeDocuments[]; total: number };
    assert.equal(list.total, expectedIds.length, filter);
    assert.deepEqual(list.items.map((item) => item.id).sort(), [...expectedIds].sort(), filter);
  }

  for (const invalid of [null, 'true', 1]) {
    for (const field of ['passportReceived', 'contractReceived']) {
      assert.equal((await request('', hrCookie, 'POST', { fullName: marker, [field]: invalid })).status, 400);
      assert.equal((await request(`/${created.id}`, hrCookie, 'PATCH', { expectedVersion: unchanged.version, [field]: invalid })).status, 400);
    }
  }
  assert.equal((await request('?passportReceived=yes', hrCookie)).status, 400);
  assert.equal((await request('?contractReceived=0', hrCookie)).status, 400);
  assert.equal((await request(`/${created.id}`, hrCookie, 'PATCH', {
    expectedVersion: unchanged.version, passportReceivedByUserId: hr.id,
  })).status, 400);

  const typeChangeResponse = await request(`/${oneTime.id}`, hrCookie, 'PATCH', {
    expectedVersion: oneTime.version, employeeType: 'substitution',
  });
  assert.equal(typeChangeResponse.status, 200);
  const typeChanged = await typeChangeResponse.json() as EmployeeDocuments;
  assert.equal(typeChanged.employeeType, 'substitution');
  assert.equal(typeChanged.contractReceivedAt, oneTime.contractReceivedAt);
  const substitutionListResponse = await request(`?search=${encodeURIComponent(marker)}&employeeType=substitution`, hrCookie);
  assert.equal(substitutionListResponse.status, 200);
  const substitutionList = await substitutionListResponse.json() as { items: EmployeeDocuments[]; total: number };
  assert.equal(substitutionList.total, 2);
  assert.deepEqual(substitutionList.items.map((item) => item.id).sort(), [created.id, oneTime.id].sort());

  const events = await prisma.auditEvent.findMany({
    where: { entityType: 'employee', entityId: created.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(events.length, 3);
  assert.equal(events[0].actorUserId, hr.id);
  assert.equal(events[1].actorUserId, director.id);
  assert.equal((events[1].oldValues as Record<string, unknown>).passportReceived, true);
  assert.equal((events[1].newValues as Record<string, unknown>).passportReceived, false);
  assert.equal((events[1].newValues as Record<string, unknown>).passportReceivedAt, changed.passportReceivedAt);
  assert.equal((events[1].newValues as Record<string, unknown>).passportReceivedByUserId, director.id);
  assert.equal((events[1].oldValues as Record<string, unknown>).contractReceived, false);
  assert.equal((events[1].newValues as Record<string, unknown>).contractReceived, true);
});
