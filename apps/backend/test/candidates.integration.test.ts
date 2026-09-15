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

async function request(
  baseUrl: string,
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

test('candidate registry, object assignment and scoped immutable feedback flow', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const cookies = new Map<string, string>();
  for (const [login, password, canManage, canRespond] of users) {
    const cookie = await loginAndGetCookieHeader({ baseUrl, login, password });
    cookies.set(login, cookie);
    const me = await request(baseUrl, cookie, '/auth/me');
    assert.equal(me.status, 200);
    const capabilities = (
      (await me.json()) as { capabilities: Record<string, boolean> }
    ).capabilities;
    assert.equal(capabilities.canAccessCandidates, true);
    assert.equal(capabilities.canManageCandidates, canManage);
    assert.equal(capabilities.canRespondToCandidates, canRespond);
    assert.equal((await request(baseUrl, cookie, '/candidates')).status, 200);
  }

  const hrCookie = cookies.get('hr1')!;
  const managerCookie = cookies.get('manager1')!;
  const [managerOne, managerTwo, operationManager, founderUser] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
      prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
      prisma.user.findUniqueOrThrow({ where: { login: 'berendyakov' } }),
      prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    ]);

  const candidateObject = await prisma.object.create({
    data: {
      name: 'Candidates integration object',
      address: 'Integration test',
      status: 'active',
      createdByUserId: founderUser.id,
    },
  });

  const deniedCreate = await request(baseUrl, managerCookie, '/candidates', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Denied',
      phone: '+79990000000',
      candidateType: 'regular',
      objectId: candidateObject.id,
      managerUserId: managerOne.id,
    }),
  });
  assert.equal(deniedCreate.status, 403);

  const incompleteRegular = await request(baseUrl, hrCookie, '/candidates', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Неполный кандидат',
      phone: '+79990000001',
      candidateType: 'regular',
    }),
  });
  assert.equal(incompleteRegular.status, 400);

  const create = await request(baseUrl, hrCookie, '/candidates', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Иванов Кандидат Тестовый',
      phone: '+79990001122',
      comment: 'Первичный контакт',
      candidateType: 'regular',
      objectId: candidateObject.id,
      managerUserId: managerOne.id,
    }),
  });
  assert.equal(create.status, 201);
  let candidate = (await create.json()) as any;
  assert.equal(candidate.object?.id, candidateObject.id);
  assert.equal(candidate.currentAssignment?.manager.id, managerOne.id);
  assert.equal(candidate.slaState, 'awaiting_response');
  assert.equal(
    new Date(candidate.currentAssignment.responseDueAt).getTime() -
      new Date(candidate.currentAssignment.assignedAt).getTime(),
    2 * 60 * 60 * 1000,
  );

  const reserve = await request(baseUrl, hrCookie, '/candidates', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Резервный Кандидат',
      phone: '+79990002233',
      candidateType: 'reserve',
    }),
  });
  assert.equal(reserve.status, 201);
  let reserveBody = (await reserve.json()) as any;
  const reserveId = reserveBody.id as string;
  assert.equal(reserveBody.object, null);
  assert.equal(reserveBody.currentAssignment, null);
  assert.equal(reserveBody.slaState, 'unassigned');

  const linkReserveObject = await request(
    baseUrl,
    hrCookie,
    `/candidates/${reserveId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: reserveBody.version,
        objectId: candidateObject.id,
      }),
    },
  );
  assert.equal(linkReserveObject.status, 200);
  reserveBody = await linkReserveObject.json();
  assert.equal(reserveBody.object?.id, candidateObject.id);
  assert.ok(
    await prisma.auditEvent.findFirst({
      where: {
        entityType: 'candidate',
        entityId: reserveId,
        action: 'candidate.object_changed',
      },
    }),
  );

  const clearReserveObject = await request(
    baseUrl,
    hrCookie,
    `/candidates/${reserveId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: reserveBody.version,
        objectId: null,
      }),
    },
  );
  assert.equal(clearReserveObject.status, 200);
  reserveBody = await clearReserveObject.json();
  assert.equal(reserveBody.object, null);

  const search = await request(
    baseUrl,
    managerCookie,
    '/candidates?q=79990001122&candidateType=regular&status=new&page=1&limit=1&sort=fullName&sortDirection=asc',
  );
  assert.equal(search.status, 200);
  const searchPayload = (await search.json()) as {
    total: number;
    items: Array<{
      id: string;
      object: { id: string } | null;
      currentAssignment: { manager: { id: string } } | null;
    }>;
  };
  assert.equal(searchPayload.total, 1);
  assert.equal(searchPayload.items[0]?.id, candidate.id);
  assert.equal(searchPayload.items[0]?.object?.id, candidateObject.id);
  assert.equal(
    searchPayload.items[0]?.currentAssignment?.manager.id,
    managerOne.id,
  );

  const reserveList = await request(
    baseUrl,
    managerCookie,
    '/candidates?candidateType=reserve&archiveState=active',
  );
  assert.deepEqual(
    ((await reserveList.json()) as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    ),
    [reserveId],
  );

  const invalidAssignment = await request(
    baseUrl,
    hrCookie,
    `/candidates/${candidate.id}/assignments`,
    {
      method: 'POST',
      body: JSON.stringify({
        managerUserId: founderUser.id,
        expectedVersion: candidate.version,
      }),
    },
  );
  assert.equal(invalidAssignment.status, 409);

  const managerFilter = await request(
    baseUrl,
    hrCookie,
    `/candidates?managerUserId=${managerOne.id}&slaState=awaiting_response`,
  );
  assert.equal(((await managerFilter.json()) as { total: number }).total, 1);

  const impossibleFilter = await request(
    baseUrl,
    hrCookie,
    `/candidates?managerUserId=${managerOne.id}&slaState=unassigned`,
  );
  assert.equal(((await impossibleFilter.json()) as { total: number }).total, 0);

  const otherResponse = await request(
    baseUrl,
    cookies.get('manager2')!,
    `/candidates/${candidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Попытка чужой обратной связи' }),
    },
  );
  assert.equal(otherResponse.status, 403);

  const afterDeniedFeedback = (await (
    await request(baseUrl, hrCookie, `/candidates/${candidate.id}`)
  ).json()) as any;
  assert.equal(afterDeniedFeedback.currentAssignment.firstRespondedAt, null);
  assert.equal(afterDeniedFeedback.status, 'new');
  assert.equal(afterDeniedFeedback.responses.length, 0);

  const assignedResponse = await request(
    baseUrl,
    managerCookie,
    `/candidates/${candidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: 'Подходит, готов взять',
      }),
    },
  );
  assert.equal(assignedResponse.status, 201);
  candidate = await assignedResponse.json();
  const firstRespondedAt = candidate.currentAssignment.firstRespondedAt;
  assert.ok(firstRespondedAt);
  assert.equal(candidate.status, 'in_progress');
  assert.equal(candidate.slaState, 'responded');
  assert.equal(candidate.responses.length, 1);

  const secondResponse = await request(
    baseUrl,
    managerCookie,
    `/candidates/${candidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Смотрит в среду' }),
    },
  );
  assert.equal(secondResponse.status, 201);
  candidate = await secondResponse.json();
  assert.equal(candidate.currentAssignment.firstRespondedAt, firstRespondedAt);
  assert.equal(candidate.responses.length, 2);

  const registryAfterFeedback = await request(
    baseUrl,
    hrCookie,
    `/candidates?q=${encodeURIComponent('Иванов Кандидат Тестовый')}`,
  );
  const registryAfterFeedbackBody = (await registryAfterFeedback.json()) as {
    items: Array<{
      id: string;
      latestFeedback: { text: string; author: { id: string } } | null;
    }>;
  };
  const registryCandidate = registryAfterFeedbackBody.items.find(
    (item) => item.id === candidate.id,
  );
  assert.equal(registryCandidate?.latestFeedback?.text, 'Смотрит в среду');
  assert.equal(registryCandidate?.latestFeedback?.author.id, managerOne.id);

  const versionBeforeRace = candidate.version;
  const race = await Promise.all([
    request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, {
      method: 'POST',
      body: JSON.stringify({
        managerUserId: managerTwo.id,
        expectedVersion: versionBeforeRace,
      }),
    }),
    request(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, {
      method: 'POST',
      body: JSON.stringify({
        managerUserId: operationManager.id,
        expectedVersion: versionBeforeRace,
      }),
    }),
  ]);
  assert.deepEqual(
    race.map((response) => response.status).sort(),
    [201, 409],
  );

  candidate = await (
    await request(baseUrl, hrCookie, `/candidates/${candidate.id}`)
  ).json();
  assert.equal(
    candidate.assignments.filter(
      (item: { endedAt: string | null }) => !item.endedAt,
    ).length,
    1,
  );
  assert.equal(candidate.assignments.length, 2);
  assert.equal(candidate.responses.length, 2);

  const oldManagerAfterReassign = await request(
    baseUrl,
    managerCookie,
    `/candidates/${candidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Старый менеджер не должен отвечать' }),
    },
  );
  assert.equal(oldManagerAfterReassign.status, 403);

  const activeManagerId = candidate.currentAssignment.manager.id as string;
  const activeManagerCookie =
    activeManagerId === managerTwo.id
      ? cookies.get('manager2')!
      : cookies.get('berendyakov')!;
  const newManagerFeedback = await request(
    baseUrl,
    activeManagerCookie,
    `/candidates/${candidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Обратная связь нового менеджера' }),
    },
  );
  assert.equal(newManagerFeedback.status, 201);
  candidate = await newManagerFeedback.json();
  assert.equal(candidate.responses.length, 3);

  const accepted = await request(
    baseUrl,
    hrCookie,
    `/candidates/${candidate.id}/status`,
    {
      method: 'POST',
      body: JSON.stringify({
        status: 'accepted',
        expectedVersion: candidate.version,
      }),
    },
  );
  assert.equal(accepted.status, 201);
  candidate = await accepted.json();
  assert.equal(candidate.currentAssignment, null);
  assert.equal(candidate.slaState, 'unassigned');
  assert.ok(
    candidate.assignments.some(
      (item: { firstRespondedAt: string | null }) => item.firstRespondedAt,
    ),
  );

  const noRole = await prisma.user.create({
    data: {
      login: `candidate-direct-${Date.now()}`,
      fullName: 'Direct Permission User',
      passwordHash: await hashPassword('direct123'),
      isActive: true,
    },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: ['candidates.view', 'candidates.respond'] } },
  });
  await prisma.userPermission.createMany({
    data: permissions.map((permission) => ({
      userId: noRole.id,
      permissionId: permission.id,
    })),
  });
  const directCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: noRole.login,
    password: 'direct123',
  });
  assert.equal((await request(baseUrl, directCookie, '/candidates')).status, 200);

  const directResponse = await request(
    baseUrl,
    directCookie,
    `/candidates/${reserveId}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Direct permission response' }),
    },
  );
  assert.equal(directResponse.status, 403);

  assert.equal(
    (
      await request(baseUrl, hrCookie, `/candidates/${reserveId}/archive`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: reserveBody.version }),
      })
    ).status,
    201,
  );

  const archivedReserve = await request(
    baseUrl,
    managerCookie,
    '/candidates?candidateType=reserve&archiveState=archived',
  );
  assert.deepEqual(
    (
      (await archivedReserve.json()) as { items: Array<{ id: string }> }
    ).items.map((item) => item.id),
    [reserveId],
  );

  const activeReserve = await request(
    baseUrl,
    managerCookie,
    '/candidates?candidateType=reserve&archiveState=active',
  );
  assert.equal(((await activeReserve.json()) as { total: number }).total, 0);
});
