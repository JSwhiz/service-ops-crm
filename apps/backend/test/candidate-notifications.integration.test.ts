import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { CandidateReminderService } from '../src/modules/candidates/candidate-reminder.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

async function api(
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
    },
  });
}

test('candidate SLA reminders and generic notifications are idempotent and isolated', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const notificationService = app.get(NotificationsService);
  const workerOne = new CandidateReminderService(
    prisma as any,
    notificationService,
  );
  const workerTwo = new CandidateReminderService(
    prisma as any,
    notificationService,
  );

  const [hrCookie, managerCookie, managerTwoCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'hr1',
      password: 'hr123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager2',
      password: 'manager123',
    }),
  ]);

  const [managerOne, managerTwo, candidateObject] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.object.findFirstOrThrow({ where: { deletedAt: null } }),
  ]);

  let phoneSequence = 1000;
  const createRegular = async (
    fullName: string,
    managerUserId = managerOne.id,
  ): Promise<any> => {
    phoneSequence += 1;
    const response = await api(baseUrl, hrCookie, '/candidates', {
      method: 'POST',
      body: JSON.stringify({
        fullName,
        phone: `+7999111${String(phoneSequence).padStart(4, '0')}`,
        candidateType: 'regular',
        objectId: candidateObject.id,
        managerUserId,
      }),
    });
    assert.equal(response.status, 201);
    const candidate = (await response.json()) as any;
    assert.equal(candidate.object?.id, candidateObject.id);
    assert.equal(candidate.currentAssignment?.manager.id, managerUserId);
    return candidate;
  };

  const candidate = await createRegular('Кандидат SLA');
  const assignmentId = candidate.currentAssignment.id as string;
  assert.equal(await workerOne.processOverdueAssignments(new Date()), 0);

  const overdueAt = new Date(Date.now() - 60_000);
  await prisma.candidateManagerAssignment.update({
    where: { id: assignmentId },
    data: { responseDueAt: overdueAt },
  });

  const concurrent = await Promise.all([
    workerOne.processOverdueAssignments(),
    workerTwo.processOverdueAssignments(),
  ]);
  assert.equal(concurrent.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(
    await prisma.notification.count({
      where: {
        recipientUserId: managerOne.id,
        type: 'candidate.response_overdue',
        entityId: candidate.id,
      },
    }),
    1,
  );
  assert.ok(
    (
      await prisma.candidateManagerAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      })
    ).reminderSentAt,
  );

  const unread = await api(baseUrl, managerCookie, '/notifications/unread-count');
  assert.equal(unread.status, 200);
  assert.equal(((await unread.json()) as { count: number }).count, 2);

  const list = await api(
    baseUrl,
    managerCookie,
    '/notifications?page=1&limit=1',
  );
  const listPayload = (await list.json()) as {
    items: Array<{ id: string; targetUrl: string }>;
    total: number;
    totalPages: number;
  };
  assert.equal(listPayload.total, 2);
  assert.equal(listPayload.totalPages, 2);
  assert.equal(listPayload.items[0]?.targetUrl, `/candidates/${candidate.id}`);

  assert.equal(
    (
      (await api(
        baseUrl,
        managerTwoCookie,
        '/notifications/unread-count',
      ).then((response) => response.json())) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      await api(
        baseUrl,
        managerTwoCookie,
        `/notifications/${listPayload.items[0]!.id}/read`,
        { method: 'POST' },
      )
    ).status,
    404,
  );

  const markRead = await api(
    baseUrl,
    managerCookie,
    `/notifications/${listPayload.items[0]!.id}/read`,
    { method: 'POST' },
  );
  assert.equal(markRead.status, 201);
  assert.ok(((await markRead.json()) as { readAt: string | null }).readAt);

  const markAll = await api(
    baseUrl,
    managerCookie,
    '/notifications/read-all',
    { method: 'POST' },
  );
  assert.equal(markAll.status, 201);
  assert.equal(
    (
      (await api(baseUrl, managerCookie, '/notifications/unread-count').then(
        (response) => response.json(),
      )) as { count: number }
    ).count,
    0,
  );

  await Promise.all([
    notificationService.create({
      recipientUserId: managerOne.id,
      type: 'test',
      title: 'Dedupe',
      dedupeKey: 'candidate-notification-dedupe',
    }),
    notificationService.create({
      recipientUserId: managerOne.id,
      type: 'test',
      title: 'Dedupe',
      dedupeKey: 'candidate-notification-dedupe',
    }),
  ]);
  assert.equal(
    await prisma.notification.count({
      where: {
        recipientUserId: managerOne.id,
        dedupeKey: 'candidate-notification-dedupe',
      },
    }),
    1,
  );

  const responseCandidate = await createRegular('Ответ до SLA');
  const responseAssignmentId = responseCandidate.currentAssignment.id as string;
  const feedback = await api(
    baseUrl,
    managerCookie,
    `/candidates/${responseCandidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Обратная связь вовремя' }),
    },
  );
  assert.equal(feedback.status, 201);

  await prisma.candidateManagerAssignment.update({
    where: { id: responseAssignmentId },
    data: { responseDueAt: overdueAt },
  });
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(
    await prisma.notification.count({
      where: {
        type: 'candidate.response_overdue',
        entityId: responseCandidate.id,
      },
    }),
    0,
  );

  const reassignCandidate = await createRegular('Переназначение SLA');
  const oldAssignmentId = reassignCandidate.currentAssignment.id as string;
  const reassigned = await api(
    baseUrl,
    hrCookie,
    `/candidates/${reassignCandidate.id}/assignments`,
    {
      method: 'POST',
      body: JSON.stringify({
        managerUserId: managerTwo.id,
        expectedVersion: reassignCandidate.version,
      }),
    },
  );
  assert.equal(reassigned.status, 201);
  const reassignedBody = (await reassigned.json()) as any;
  assert.equal(reassignedBody.currentAssignment.manager.id, managerTwo.id);

  await prisma.candidateManagerAssignment.update({
    where: { id: oldAssignmentId },
    data: { responseDueAt: overdueAt },
  });
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(
    await prisma.notification.count({
      where: {
        type: 'candidate.response_overdue',
        entityId: reassignCandidate.id,
      },
    }),
    0,
  );

  const oldManagerFeedback = await api(
    baseUrl,
    managerCookie,
    `/candidates/${reassignCandidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Старый менеджер' }),
    },
  );
  assert.equal(oldManagerFeedback.status, 403);

  const newManagerFeedback = await api(
    baseUrl,
    managerTwoCookie,
    `/candidates/${reassignCandidate.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ text: 'Новый менеджер отвечает' }),
    },
  );
  assert.equal(newManagerFeedback.status, 201);

  for (const terminalAction of ['accepted', 'rejected', 'archive'] as const) {
    const terminalCandidate = await createRegular(
      `Terminal ${terminalAction}`,
    );
    const terminalAssignmentId =
      terminalCandidate.currentAssignment.id as string;

    const terminalResponse =
      terminalAction === 'archive'
        ? await api(
            baseUrl,
            hrCookie,
            `/candidates/${terminalCandidate.id}/archive`,
            {
              method: 'POST',
              body: JSON.stringify({
                expectedVersion: terminalCandidate.version,
              }),
            },
          )
        : await api(
            baseUrl,
            hrCookie,
            `/candidates/${terminalCandidate.id}/status`,
            {
              method: 'POST',
              body: JSON.stringify({
                status: terminalAction,
                expectedVersion: terminalCandidate.version,
              }),
            },
          );

    assert.equal(terminalResponse.status, 201);
    await prisma.candidateManagerAssignment.update({
      where: { id: terminalAssignmentId },
      data: { responseDueAt: overdueAt },
    });
    assert.equal(await workerOne.processOverdueAssignments(), 0);
    assert.equal(
      await prisma.notification.count({
        where: {
          type: 'candidate.response_overdue',
          entityId: terminalCandidate.id,
        },
      }),
      0,
    );
  }
});
