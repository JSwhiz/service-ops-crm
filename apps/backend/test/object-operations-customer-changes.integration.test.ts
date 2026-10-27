import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ChatsService } from '../src/modules/chats/chats.service';
import { ObjectDailyReportPublicationService } from '../src/modules/object-operations/object-daily-report-publication.service';
import { moscowDateKey } from '../src/modules/objects/utils/object-season.util';
import { createCoreTestObject, SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';

async function fixture(t: test.TestContext, withManager = true) {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Run through the isolated integration runner');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: withManager });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const cookie = async (login: string, password: string) => loginAndGetCookieHeader({ baseUrl, login, password });
  const request = (auth: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { prisma, app, objectId, founder, cookie, request };
}

test('named HR permissions read report history and redacted audit; ordinary HR and writes remain denied', async (t) => {
  const { prisma, objectId, founder, cookie, request } = await fixture(t, false);
  await prisma.objectDailyReport.createMany({ data: [
    { objectId, reportDate: new Date('2020-01-10'), content: 'Исторический отчёт', updatedByUserId: founder.id },
    { objectId, reportDate: new Date(`${moscowDateKey()}T00:00:00`), content: 'Сегодня', updatedByUserId: founder.id },
  ] });
  await prisma.objectComment.create({ data: { objectId, content: 'Private operations comment', createdByUserId: founder.id } });
  const audit = await prisma.objectAuditLog.create({ data: { objectId, actorUserId: founder.id, actionCode: 'object.updated', payload: {
    name: 'Visible history', dailyRate: 4500, monthlyBudget: 10000, baseProfile: { dailyRate: 99 }, ratePolicySnapshot: { baseAmount: 500 },
    changes: { address: 'New address', monthlySalary: 150000, actualAmount: 123, excessAmount: 20 },
  } } });

  for (const login of ['lazutina', 'kireeva']) {
    const auth = await cookie(login, `${login}123`);
    const response = await request(auth, `/objects/${objectId}/daily-reports`);
    assert.equal(response.status, 200);
    const reports = await response.json() as Array<{ content: string }>;
    assert.equal(reports.length, 2);
    const filtered = await request(auth, `/objects/${objectId}/daily-reports?date=2020-01-10`);
    assert.equal(filtered.status, 200);
    assert.equal((await filtered.json() as unknown[]).length, 1);
    assert.equal((await request(auth, `/objects/${objectId}/daily-reports?date=2020-02-31`)).status, 400);
    const feed = await request(auth, `/objects/${objectId}/feed`);
    assert.equal(feed.status, 200);
    assert.ok((await feed.json() as Array<{ type: string }>).every((item) => item.type === 'daily_report'));
    const history = await request(auth, `/objects/${objectId}/audit`);
    assert.equal(history.status, 200);
    const rows = await history.json() as Array<{ id: string; payload: Record<string, unknown> }>;
    const payload = rows.find((item) => item.id === audit.id)?.payload;
    assert.ok(payload);
    assert.equal(payload.name, 'Visible history');
    for (const key of ['dailyRate', 'monthlyBudget', 'baseProfile', 'ratePolicySnapshot']) assert.equal(key in payload, false);
    assert.deepEqual(payload.changes, { address: 'New address' });
    for (const endpoint of ['comments', 'attendance/today', 'compensation-rates', 'arrival-photo/today']) {
      assert.equal((await request(auth, `/objects/${objectId}/${endpoint}`)).status, 403, endpoint);
    }
    assert.equal((await request(auth, `/objects/${objectId}/daily-report/today`, 'PUT', { content: 'Forbidden edit' })).status, 403);
    assert.equal((await request(auth, `/objects/${objectId}/daily-report/today/submit`, 'POST', { expectedRevision: 1 })).status, 403);
  }
  const hr = await cookie('hr1', 'hr123');
  assert.equal((await request(hr, `/objects/${objectId}/daily-reports`)).status, 403);
  assert.equal((await request(hr, `/objects/${objectId}/audit`)).status, 404, 'inaccessible objects are not enumerated');
});

test('quick presence suggests only eligible saved people without creating facts, and respects empty confirmations', async (t) => {
  const { prisma, objectId, founder, cookie, request } = await fixture(t);
  const auth = await cookie('manager1', 'manager123');
  const today = moscowDateKey();
  const yesterdayDate = new Date(`${today}T12:00:00Z`); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  assert.equal((await request(auth, `/objects/${objectId}/attendance`, 'POST', { operationDate: yesterday, employeeIds: [SEEDED_EMPLOYEE_IDS.ivan, SEEDED_EMPLOYEE_IDS.sergey] })).status, 201);
  const window = await prisma.employeeAvailabilityWindow.create({ data: { employeeId: SEEDED_EMPLOYEE_IDS.sergey, startDate: new Date(`${today}T00:00:00`), endDate: new Date(`${today}T23:59:59`), availabilityStatus: 'unavailable', createdByUserId: founder.id } });
  t.after(async () => { const cleanup = new PrismaClient(); await cleanup.employeeAvailabilityWindow.delete({ where: { id: window.id } }); await cleanup.$disconnect(); });
  const before = await prisma.objectAttendanceFact.count({ where: { objectId } });
  const first = await request(auth, `/objects/${objectId}/attendance/today`);
  assert.equal(first.status, 200);
  const suggested = await first.json() as { employeeIds: string[]; employeeFacts: unknown[]; suggestedEmployeeIds: string[]; prefillSourceDate: string; submittedAt: string | null };
  assert.deepEqual(suggested.employeeIds, []); assert.deepEqual(suggested.employeeFacts, []);
  assert.deepEqual(suggested.suggestedEmployeeIds, [SEEDED_EMPLOYEE_IDS.ivan]);
  assert.equal(suggested.prefillSourceDate, yesterday); assert.equal(suggested.submittedAt, null);
  assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), before);
  assert.equal((await request(auth, `/objects/${objectId}/attendance`, 'POST', { operationDate: yesterday, employeeIds: [] })).status, 201);
  const emptyHistory = await (await request(auth, `/objects/${objectId}/attendance/today`)).json() as { suggestedEmployeeIds: string[] };
  assert.deepEqual(emptyHistory.suggestedEmployeeIds, []);
  assert.equal((await request(auth, `/objects/${objectId}/attendance`, 'POST', { operationDate: today, employeeIds: [] })).status, 201);
  const confirmed = await (await request(auth, `/objects/${objectId}/attendance/today`)).json() as { employeeIds: string[]; submittedAt: string | null; submittedBy: { fullName: string }; prefillSourceDate: string | null };
  assert.deepEqual(confirmed.employeeIds, []); assert.ok(confirmed.submittedAt); assert.ok(confirmed.submittedBy.fullName); assert.equal(confirmed.prefillSourceDate, null);
});

test('manager creates scoped substitution from existing rate; conflicts, catalog rights and historical snapshots stay protected', async (t) => {
  const { prisma, objectId, founder, cookie, request } = await fixture(t);
  const { objectId: outside } = await createCoreTestObject(prisma);
  const replacement = await prisma.employee.create({ data: { fullName: 'Подменный тестовый', employeeType: 'substitution', employmentStatus: 'active' } });
  const rate = await prisma.objectCompensationRate.create({ data: { objectId, name: 'Подмена 3700', category: 'substitution', ratePolicyType: 'daily_rate', baseAmount: 3700, createdByUserId: founder.id } });
  const otherRate = await prisma.objectCompensationRate.create({ data: { objectId: outside, name: 'Чужой тариф', category: 'substitution', ratePolicyType: 'daily_rate', baseAmount: 999, createdByUserId: founder.id } });
  const auth = await cookie('manager1', 'manager123');
  const today = moscowDateKey();
  const payload = { employeeId: SEEDED_EMPLOYEE_IDS.ivan, substituteEmployeeId: replacement.id, rateOptionId: rate.id, startDate: today, endDate: today, reason: 'Подмена на смену' };
  assert.equal((await request(auth, `/objects/${outside}/substitutions`, 'POST', payload)).status, 403);
  assert.equal((await request(auth, `/objects/${objectId}/substitutions`, 'POST', { ...payload, rateOptionId: otherRate.id })).status, 400);
  const results = await Promise.all([request(auth, `/objects/${objectId}/substitutions`, 'POST', payload), request(auth, `/objects/${objectId}/substitutions`, 'POST', payload)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal((await request(auth, `/objects/${objectId}/compensation-rates/${rate.id}`, 'PUT', { baseAmount: 1 })).status, 403);
  const response = await request(auth, `/objects/${objectId}/attendance`, 'POST', { operationDate: today, employeeIds: [replacement.id] });
  assert.equal(response.status, 201);
  const saved = await prisma.objectAttendanceFact.findFirstOrThrow({ where: { objectId, employeeId: replacement.id } });
  assert.equal(saved.dailyRateSnapshot, 3700);
  await prisma.objectCompensationRate.update({ where: { id: rate.id }, data: { baseAmount: 9000 } });
  assert.equal((await request(auth, `/objects/${objectId}/attendance`, 'POST', { operationDate: today, employeeIds: [replacement.id], employeeFacts: [{ employeeId: replacement.id, workedHours: 0 }] })).status, 201);
  const after = await prisma.objectAttendanceFact.findUniqueOrThrow({ where: { id: saved.id } });
  assert.equal(after.dailyRateSnapshot, 3700); assert.equal(after.workedHours, 0);
  const attendance = await (await request(auth, `/objects/${objectId}/attendance/today`)).json() as { employeeFacts: Array<{ employeeName: string; createdBy: { fullName: string }; updatedAt: string }> };
  assert.equal(attendance.employeeFacts[0]?.employeeName, replacement.fullName); assert.ok(attendance.employeeFacts[0]?.createdBy?.fullName); assert.ok(attendance.employeeFacts[0]?.updatedAt);
});

test('daily report drafts never publish; explicit final submission and updates are idempotent and retry durable delivery', async (t) => {
  const { prisma, app, objectId, cookie, request } = await fixture(t);
  const auth = await cookie('manager1', 'manager123');
  const publications = app.get(ObjectDailyReportPublicationService);
  publications.onModuleDestroy();
  const chats = app.get(ChatsService);
  const realCreate = chats.createSystemMessage.bind(chats);
  chats.createSystemMessage = async () => { throw new Error('Simulated transport outage'); };
  t.after(() => { chats.createSystemMessage = realCreate; });
  const draftResponse = await request(auth, `/objects/${objectId}/daily-report/today`, 'PUT', { content: 'Первый результат', expectedRevision: 0 });
  assert.equal(draftResponse.status, 200);
  const draft = await draftResponse.json() as { id: string; revision: number; submittedRevision: number };
  assert.equal(draft.submittedRevision, 0);
  assert.equal(await prisma.objectDailyReportPublication.count({ where: { reportId: draft.id } }), 0);
  const submissions = await Promise.all([1, 2].map(() => request(auth, `/objects/${objectId}/daily-report/today/submit`, 'POST', { expectedRevision: draft.revision })));
  assert.ok(submissions.every((response) => response.status === 201));
  assert.equal(await prisma.objectDailyReportPublication.count({ where: { reportId: draft.id } }), 1);
  const queued = await prisma.objectDailyReportPublication.findFirstOrThrow({ where: { reportId: draft.id } });
  assert.equal(queued.publishedAt, null); assert.equal(queued.content, 'Первый результат');
  const edit = await request(auth, `/objects/${objectId}/daily-report/today`, 'PUT', { content: 'Уточнённый результат', expectedRevision: draft.revision });
  assert.equal(edit.status, 200);
  const revised = await edit.json() as { revision: number };
  assert.equal((await request(auth, `/objects/${objectId}/daily-report/today/submit`, 'POST', { expectedRevision: draft.revision })).status, 201);
  assert.equal(await prisma.objectDailyReportPublication.count({ where: { reportId: draft.id } }), 1, 'retry cannot submit new draft');
  assert.equal((await request(auth, `/objects/${objectId}/daily-report/today`, 'PUT', { content: 'Stale write', expectedRevision: draft.revision })).status, 409);
  assert.equal((await request(auth, `/objects/${objectId}/daily-report/today/submit`, 'POST', { expectedRevision: revised.revision })).status, 201);
  chats.createSystemMessage = realCreate;
  await publications.flush();
  await publications.flush();
  const messages = await prisma.chatMessage.findMany({ where: { systemEventKey: { startsWith: `object-daily-report:${draft.id}:` } }, orderBy: { createdAt: 'asc' } });
  assert.equal(messages.length, 2);
  assert.match(messages[0]!.text ?? '', /Первый результат/); assert.match(messages[1]!.text ?? '', /Обновление ежедневного отчёта/); assert.match(messages[1]!.text ?? '', /Уточнённый результат/);
  assert.equal((messages[1]!.metadata as { reportId: string }).reportId, draft.id);
  // Simulate process death after chat insert but before outbox acknowledgement.
  await prisma.objectDailyReportPublication.update({ where: { id: queued.id }, data: { publishedAt: null } });
  await publications.flush();
  assert.equal(await prisma.chatMessage.count({ where: { systemEventKey: { startsWith: `object-daily-report:${draft.id}:` } } }), 2);
});
