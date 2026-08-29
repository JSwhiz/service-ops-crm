import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { CandidateReminderService } from '../src/modules/candidates/candidate-reminder.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

async function api(baseUrl: string, cookie: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, { ...init, headers: { Cookie: cookie, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
}

test('candidate SLA reminders and generic notifications are idempotent and isolated', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const notificationService = app.get(NotificationsService);
  const workerOne = new CandidateReminderService(prisma as any, notificationService);
  const workerTwo = new CandidateReminderService(prisma as any, notificationService);
  const [hrCookie, managerCookie, managerTwoCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
  ]);
  const [managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);

  const created = await api(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Кандидат SLA', candidateType: 'regular' }) });
  let candidate = (await created.json()) as any;
  const assigned = await api(baseUrl, hrCookie, `/candidates/${candidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerOne.id, expectedVersion: candidate.version }) });
  candidate = await assigned.json();
  const assignmentId = candidate.currentAssignment.id as string;
  assert.equal(await workerOne.processOverdueAssignments(new Date()), 0);

  const overdueAt = new Date(Date.now() - 60_000);
  await prisma.candidateManagerAssignment.update({ where: { id: assignmentId }, data: { responseDueAt: overdueAt } });
  const concurrent = await Promise.all([workerOne.processOverdueAssignments(), workerTwo.processOverdueAssignments()]);
  assert.equal(concurrent.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(await prisma.notification.count({ where: { recipientUserId: managerOne.id, type: 'candidate.response_overdue', entityId: candidate.id } }), 1);
  assert.ok((await prisma.candidateManagerAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).reminderSentAt);

  const unread = await api(baseUrl, managerCookie, '/notifications/unread-count');
  assert.equal(unread.status, 200);
  assert.equal(((await unread.json()) as { count: number }).count, 2);
  const list = await api(baseUrl, managerCookie, '/notifications?page=1&limit=1');
  const listPayload = (await list.json()) as { items: Array<{ id: string; targetUrl: string }>; total: number; totalPages: number };
  assert.equal(listPayload.total, 2);
  assert.equal(listPayload.totalPages, 2);
  assert.equal(listPayload.items[0]?.targetUrl, `/candidates/${candidate.id}`);
  assert.equal((await api(baseUrl, managerTwoCookie, '/notifications/unread-count').then((response) => response.json()) as { count: number }).count, 0);
  assert.equal((await api(baseUrl, managerTwoCookie, `/notifications/${listPayload.items[0]!.id}/read`, { method: 'POST' })).status, 404);

  const markRead = await api(baseUrl, managerCookie, `/notifications/${listPayload.items[0]!.id}/read`, { method: 'POST' });
  assert.equal(markRead.status, 201);
  assert.ok(((await markRead.json()) as { readAt: string | null }).readAt);
  const markAll = await api(baseUrl, managerCookie, '/notifications/read-all', { method: 'POST' });
  assert.equal(markAll.status, 201);
  assert.equal(((await api(baseUrl, managerCookie, '/notifications/unread-count').then((response) => response.json())) as { count: number }).count, 0);

  await Promise.all([
    notificationService.create({ recipientUserId: managerOne.id, type: 'test', title: 'Dedupe', dedupeKey: 'candidate-notification-dedupe' }),
    notificationService.create({ recipientUserId: managerOne.id, type: 'test', title: 'Dedupe', dedupeKey: 'candidate-notification-dedupe' }),
  ]);
  assert.equal(await prisma.notification.count({ where: { recipientUserId: managerOne.id, dedupeKey: 'candidate-notification-dedupe' } }), 1);

  const responseCandidate = await api(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Ответ до SLA', candidateType: 'regular' }) }).then((response) => response.json()) as any;
  const responseAssigned = await api(baseUrl, hrCookie, `/candidates/${responseCandidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerOne.id, expectedVersion: responseCandidate.version }) }).then((response) => response.json()) as any;
  await api(baseUrl, managerCookie, `/candidates/${responseCandidate.id}/responses`, { method: 'POST', body: JSON.stringify({ text: 'Ответ вовремя' }) });
  await prisma.candidateManagerAssignment.update({ where: { id: responseAssigned.currentAssignment.id }, data: { responseDueAt: overdueAt } });
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(await prisma.notification.count({ where: { type: 'candidate.response_overdue', entityId: responseCandidate.id } }), 0);

  const reassignCandidate = await api(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: 'Переназначение SLA', candidateType: 'regular' }) }).then((response) => response.json()) as any;
  const firstAssignment = await api(baseUrl, hrCookie, `/candidates/${reassignCandidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerOne.id, expectedVersion: reassignCandidate.version }) }).then((response) => response.json()) as any;
  const oldAssignmentId = firstAssignment.currentAssignment.id;
  await api(baseUrl, hrCookie, `/candidates/${reassignCandidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerTwo.id, expectedVersion: firstAssignment.version }) });
  await prisma.candidateManagerAssignment.update({ where: { id: oldAssignmentId }, data: { responseDueAt: overdueAt } });
  assert.equal(await workerOne.processOverdueAssignments(), 0);
  assert.equal(await prisma.notification.count({ where: { type: 'candidate.response_overdue', entityId: reassignCandidate.id } }), 0);

  for (const terminalAction of ['accepted', 'rejected', 'archive'] as const) {
    const terminalCandidate = await api(baseUrl, hrCookie, '/candidates', { method: 'POST', body: JSON.stringify({ fullName: `Terminal ${terminalAction}`, candidateType: 'regular' }) }).then((response) => response.json()) as any;
    const terminalAssigned = await api(baseUrl, hrCookie, `/candidates/${terminalCandidate.id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId: managerOne.id, expectedVersion: terminalCandidate.version }) }).then((response) => response.json()) as any;
    const terminalAssignmentId = terminalAssigned.currentAssignment.id as string;
    const terminalResponse = terminalAction === 'archive'
      ? await api(baseUrl, hrCookie, `/candidates/${terminalCandidate.id}/archive`, { method: 'POST', body: JSON.stringify({ expectedVersion: terminalAssigned.version }) })
      : await api(baseUrl, hrCookie, `/candidates/${terminalCandidate.id}/status`, { method: 'POST', body: JSON.stringify({ status: terminalAction, expectedVersion: terminalAssigned.version }) });
    assert.equal(terminalResponse.status, 201);
    await prisma.candidateManagerAssignment.update({ where: { id: terminalAssignmentId }, data: { responseDueAt: overdueAt } });
    assert.equal(await workerOne.processOverdueAssignments(), 0);
    assert.equal(await prisma.notification.count({ where: { type: 'candidate.response_overdue', entityId: terminalCandidate.id } }), 0);
  }
});
