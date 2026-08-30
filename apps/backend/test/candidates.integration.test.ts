import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

const users = [
  ['founder', 'founder123', true, false],
  ['stepanova', 'stepanova123', true, false],
  ['director', 'director123', true, false],
  ['nikitina', 'nikitina123', true, false],
  ['deputy1', 'deputy123', true, false],
  ['hr1', 'hr123', true, false],
  ['berendyakov', 'berendyakov123', false, true],
  ['manager1', 'manager123', false, true],
  ['manager2', 'manager123', false, true],
] as const;

async function request(baseUrl: string, cookie: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: { Cookie: cookie, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
}

test('candidate registry, access, assignment and immutable response flow', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });

  const cookies = new Map<string, string>();
  for (const [login, password, canManage, canRespond] of users) {
    const cookie = await loginAndGetCookieHeader({ baseUrl, login, password });
    cookies.set(login, cookie);
    const me = await request(baseUrl, cookie, '/auth/me');
    assert.equal(me.status, 200);
    const capabilities = ((await me.json()) as { capabilities: Record<string, boolean> }).capabilities;
    assert.equal(capabilities.canAccessCandidates, true);
    assert.equal(capabilities.canManageCandidates, canManage);
    assert.equal(capabilities.canRespondToCandidates, canRespond);
    assert.equal((await request(baseUrl, cookie, '/candidates')).status, 200);
  }

  const managerCookie = cookies.get('manager1')!;
  assert.equal((await request(baseUrl, managerCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Denied', candidateType: 'regular' }) })).status, 403);

  const hrCookie = cookies.get('hr1')!;
  const create = await request(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Иванов Кандидат Тестовый', phone: '+79990001122', comment: 'Первичный контакт', candidateType: 'regular' }) });
  assert.equal(create.status, 201);
  let candidate = (await create.json()) as any;
  assert.equal(candidate.slaState, 'unassigned');
  assert.equal(candidate.currentAssignment, null);

  const reserve = await request(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Резервный Кандидат', candidateType: 'reserve' }) });
  assert.equal(reserve.status, 201);
  const reserveId = ((await reserve.json()) as { id: string }).id;

  const search = await request(baseUrl, managerCookie, '/candidates?q=79990001122&candidateType=regular&status=new&page=1&limit=1&sort=fullName&sortDirection=asc');
  assert.equal(search.status, 200);
  const searchPayload = (await search.json()) as { total: number; items: Array<{ id: string }> };
  assert.equal(searchPayload.total, 1);
  assert.equal(searchPayload.items[0]?.id, candidate.id);
  const reserveList = await request(baseUrl, managerCookie, '/candidates?candidateType=reserve&archiveState=active');
  assert.deepEqual(((await reserveList.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id), [reserveId]);

  const managerOne = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const [managerTwo, operationManager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'berendyakov' } }),
  ]);
  const founderUser = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const invalidAssignment = await request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: founderUser.id, expectedVersion: candidate.version }) });
  assert.equal(invalidAssignment.status, 409);
  const assign = await request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerOne.id, expectedVersion: candidate.version }) });
  assert.equal(assign.status, 201);
  candidate = await assign.json();
  assert.equal(candidate.currentAssignment.manager.id, managerOne.id);
  assert.equal(candidate.slaState, 'awaiting_response');
  assert.equal(new Date(candidate.currentAssignment.responseDueAt).getTime() - new Date(candidate.currentAssignment.assignedAt).getTime(), 2 * 60 * 60 * 1000);

  const managerFilter = await request(baseUrl, hrCookie, `/candidates?managerUserId=${managerOne.id}&slaState=awaiting_response`);
  assert.equal(((await managerFilter.json()) as { total: number }).total, 1);
  const impossibleFilter = await request(baseUrl, hrCookie, `/candidates?managerUserId=${managerOne.id}&slaState=unassigned`);
  assert.equal(((await impossibleFilter.json()) as { total: number }).total, 0);

  const otherResponse = await request(baseUrl, cookies.get('manager2')!, `/candidates/${candidate.id}/responses`, { method: 'POST', body: JSON.stringify({ text: 'Ответ другого менеджера' }) });
  assert.equal(otherResponse.status, 201);
  candidate = await otherResponse.json();
  assert.equal(candidate.currentAssignment.firstRespondedAt, null);
  assert.equal(candidate.status, 'new');

  const assignedResponse = await request(baseUrl, managerCookie, `/candidates/${candidate.id}/responses`, { method: 'POST', body: JSON.stringify({ text: 'Первый ответ назначенного менеджера' }) });
  assert.equal(assignedResponse.status, 201);
  candidate = await assignedResponse.json();
  const firstRespondedAt = candidate.currentAssignment.firstRespondedAt;
  assert.ok(firstRespondedAt);
  assert.equal(candidate.status, 'in_progress');
  assert.equal(candidate.slaState, 'responded');

  const secondResponse = await request(baseUrl, managerCookie, `/candidates/${candidate.id}/responses`, { method: 'POST', body: JSON.stringify({ text: 'Второй ответ' }) });
  candidate = await secondResponse.json();
  assert.equal(candidate.currentAssignment.firstRespondedAt, firstRespondedAt);
  assert.equal(candidate.responses.length, 3);

  const versionBeforeRace = candidate.version;
  const race = await Promise.all([
    request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerTwo.id, expectedVersion: versionBeforeRace }) }),
    request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: operationManager.id, expectedVersion: versionBeforeRace }) }),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
  candidate = await (await request(baseUrl, hrCookie, `/candidates/${candidate.id}`)).json();
  assert.equal(candidate.assignments.filter((item: { endedAt: string | null }) => !item.endedAt).length, 1);
  assert.equal(candidate.assignments.length, 2);

  const accepted = await request(baseUrl, hrCookie, `/candidates/${candidate.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'accepted', expectedVersion: candidate.version }),
  });
  assert.equal(accepted.status, 201);
  candidate = await accepted.json();
  assert.equal(candidate.currentAssignment, null);
  assert.equal(candidate.slaState, 'unassigned');
  assert.ok(candidate.assignments.some((item: { firstRespondedAt: string | null }) => item.firstRespondedAt));

  const noRole = await prisma.user.create({ data: { login: `candidate-direct-${Date.now()}`, fullName: 'Direct Permission User', passwordHash: await hashPassword('direct123'), isActive: true } });
  const permissions = await prisma.permission.findMany({ where: { code: { in: ['candidates.view', 'candidates.respond'] } } });
  await prisma.userPermission.createMany({ data: permissions.map((permission) => ({ userId: noRole.id, permissionId: permission.id })) });
  const directCookie = await loginAndGetCookieHeader({ baseUrl, login: noRole.login, password: 'direct123' });
  assert.equal((await request(baseUrl, directCookie, '/candidates')).status, 200);
  const directResponse = await request(baseUrl, directCookie, `/candidates/${reserveId}/responses`, { method: 'POST', body: JSON.stringify({ text: 'Direct permission response' }) });
  assert.equal(directResponse.status, 201);
  const reserveAfterResponse = (await directResponse.json()) as { version: number };
  assert.equal((await request(baseUrl, hrCookie, `/candidates/${reserveId}/archive`, { method: 'POST', body: JSON.stringify({ expectedVersion: reserveAfterResponse.version }) })).status, 201);
  const archivedReserve = await request(baseUrl, managerCookie, '/candidates?candidateType=reserve&archiveState=archived');
  assert.deepEqual(((await archivedReserve.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id), [reserveId]);
  const activeReserve = await request(baseUrl, managerCookie, '/candidates?candidateType=reserve&archiveState=active');
  assert.equal(((await activeReserve.json()) as { total: number }).total, 0);
});
