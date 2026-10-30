import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createCoreTestObject, cleanupCoreTestObject, SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import type { CreatePositionDto } from '../src/modules/object-scheduling/scheduling.dto';
import type { PositionView, PreviewResponse } from '../src/modules/object-scheduling/scheduling.types';
import { legacyFactDay, todayMoscow } from '../src/modules/object-scheduling/scheduling-calendar';
import { TimesheetsService } from '../src/modules/timesheets/timesheets.service';
import { normalizeRatePolicy } from '../src/modules/timesheets/utils/timesheet-rate-policy.util';
import { Prisma } from '@prisma/client';

interface Attendance {id: string; version: number; dailyRateSnapshot: number; ratePolicySnapshot: unknown; status: string; operationDate: string}
interface Contour {id: string; version: number; code: string; dailyRate: number}

test('scheduling HTTP → snapshots → daily aggregate → timesheet', async t => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Use the isolated integration harness');
  const prisma = new PrismaClient();
  const {app, baseUrl} = await createTestApp();
  const cookies = {
    founder: await loginAndGetCookieHeader({baseUrl, login: 'founder', password: 'founder123'}),
    manager: await loginAndGetCookieHeader({baseUrl, login: 'manager1', password: 'manager123'}),
  };
  const today = todayMoscow();
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0,10);
  const employeeId = SEEDED_EMPLOYEE_IDS.ivan;
  const objects: string[] = [];
  t.after(async () => {
    for (const objectId of objects) {
      await prisma.objectShiftAttendance.deleteMany({where: {objectId}});
      await cleanupCoreTestObject(prisma, objectId);
    }
    await app.close(); await prisma.$disconnect();
  });
  async function request<T>(path: string, method = 'GET', body?: unknown, status = 200, actor: keyof typeof cookies = 'founder'): Promise<T> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {method, headers: {Cookie: cookies[actor], 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data as T;
  }
  async function fixture() {const {objectId} = await createCoreTestObject(prisma, {includeManagerAssignment: true}); objects.push(objectId); return objectId;}
  function plan(contourId: string | null = null): CreatePositionDto {
    return {clientKey: randomUUID(), name: 'Уборка', headcount: 2, requiredPerShift: 1, effectiveFrom: today, template: {kind: 'weekly', weekdays: [1,2,3,4,5,6,7]}, groups: [{key: 'A', name: 'День', offsetDays: 0, assignments: [{employeeId, from: today}], timeRanges: [{key: 'day', start: '08:00', end: '16:00', endDayOffset: 0, contourId}]}]};
  }
  const path = (id: string) => `/objects/${id}/scheduling`;
  async function position(objectId: string, input = plan()) {return request<PositionView>(`${path(objectId)}/positions`, 'POST', input, 201);}
  async function confirm(objectId: string, p: PositionView, options: {groupKey?: string; timeRangeKey?: string; requestKey?: string; operationDate?: string} = {}, status = 201) {
    return request<Attendance>(`${path(objectId)}/attendance/confirm`, 'POST', {requestKey: options.requestKey ?? randomUUID(), positionId: p.id, revisionId: p.revisions.at(-1)!.id, groupKey: options.groupKey ?? 'A', timeRangeKey: options.timeRangeKey ?? 'day', employeeId, operationDate: options.operationDate ?? today}, status);
  }
  async function entry(objectId: string) {return prisma.timesheetDayEntry.findFirstOrThrow({where: {row: {employeeId, timesheetMonth: {objectId}}, dayOfMonth: Number(today.slice(8))}});}

  await t.test('pre-create and saved previews are bounded, side-effect free, phase-stable and temporal', async () => {
    const objectId = await fixture(); const input = plan();
    input.template = {kind: 'cycle', sequence: [true,true,false,false], anchorDate: today};
    input.groups.push({...input.groups[0], key: 'B', name: 'Вторая', offsetDays: 2, assignments: [{employeeId: SEEDED_EMPLOYEE_IDS.sergey, from: today}]});
    const draft = await request<PreviewResponse>('/object-scheduling/preview', 'POST', {from: today, to: tomorrow, draft: input}, 201);
    assert.equal(draft.coverage[0].required, 1); assert.equal(draft.coverage[0].uncovered, 0); assert.equal(draft.recommendedGroups, 2);
    const p = await position(objectId, input);
    await request(`${path(objectId)}/positions`, 'POST', input, 201);
    assert.equal(await prisma.objectStaffPosition.count({where: {objectId}}), 1);
    const preview = await request<PreviewResponse>(`${path(objectId)}/preview`, 'POST', {from: today, to: tomorrow}, 201);
    assert.equal(preview.coverage[0].uncovered, 0);
    assert.equal(await prisma.objectAttendanceFact.count({where: {objectId}}), 0);
    assert.equal(await prisma.timesheetMonth.count({where: {objectId}}), 0);
    await request(`${path(objectId)}/preview`, 'POST', {from: '2026-01-01', to: '2026-05-01'}, 400);
    await request(`${path(objectId)}/preview`, 'POST', {from: '2026-02-30', to: '2026-03-01'}, 400);
    const {clientKey, ...fields} = input; assert.ok(clientKey);
    const v2 = await request<PositionView>(`${path(objectId)}/positions/${p.id}`, 'PUT', {...fields, expectedVersion: 1, name: 'Сразу исправлено'}, 200);
    assert.equal(v2.version, 2); assert.equal(v2.revisions.length, 2);
    const latest = await request<PreviewResponse>(`${path(objectId)}/preview`, 'POST', {from: today, to: today}, 201);
    assert.ok(latest.shifts.every(s => s.revisionId === v2.revisions[1].id));
    await request(`${path(objectId)}/positions/${p.id}`, 'PUT', {...fields, expectedVersion: 1}, 409);
    const unanchored = plan(); unanchored.template = {kind: 'cycle', sequence: [true,false,false,false]};
    const templatePreview = await request<PreviewResponse>('/object-scheduling/preview', 'POST', {from: today, to: today, draft: unanchored}, 201);
    assert.equal(templatePreview.shifts.length, 0); assert.ok(templatePreview.warnings.some(w => w.code === 'ANCHOR_REQUIRED'));
  });

  await t.test('default contour deduplicates across groups, time ranges, positions and concurrent retries', async () => {
    const objectId = await fixture(); const input = plan();
    input.groups[0].timeRanges.push({key: 'evening', start: '16:00', end: '20:00', endDayOffset: 0});
    const p = await position(objectId, input); const p2 = await position(objectId);
    const requestKey = randomUUID();
    const first = await Promise.all([confirm(objectId, p, {requestKey}), confirm(objectId, p, {requestKey})]);
    assert.equal(first[0].id, first[1].id);
    await confirm(objectId, p, {timeRangeKey: 'evening'}); await confirm(objectId, p2);
    assert.equal(await prisma.objectShiftAttendance.count({where: {objectId, status: 'confirmed'}}), 3);
    assert.equal(await prisma.objectAttendanceFact.count({where: {objectId}}), 1);
    assert.equal((await entry(objectId)).dayValue, 2500);
    await request(`/objects/${objectId}/attendance`, 'POST', {operationDate: today, employeeIds: []}, 409);
    await request(`${path(objectId)}/attendance/confirm`, 'POST', {requestKey, positionId: p2.id, revisionId: p2.revisions[0].id, groupKey: 'A', timeRangeKey: 'day', employeeId, operationDate: today}, 409);
    const [year, month, dayOfMonth] = today.split('-').map(Number);
    await request('/timesheets/entries', 'POST', {objectId, year, month, employeeId, dayOfMonth, dayValue: 9999, comment: 'Сохранить ручную сумму'}, 201);
    const all = await prisma.objectShiftAttendance.findMany({where: {objectId}});
    for (const item of all) await request(`${path(objectId)}/attendance/${item.id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Ошибка отметки'}, 201);
    const final = await entry(objectId);
    assert.equal(final.dayValue, 9999); assert.equal(final.autoValue, 0); assert.equal(final.comment, 'Сохранить ручную сумму');
    assert.equal(await prisma.objectAttendanceFact.count({where: {objectId}}), 0);
    // A network replay cannot resurrect a cancelled exit; a new key is explicit reconfirmation.
    const {clientKey, ...changedPlan} = input; assert.ok(clientKey);
    await request(`${path(objectId)}/positions/${p.id}`, 'PUT', {...changedPlan, expectedVersion: 1, name: 'Новая версия после отмены'}, 200);
    const replay = await confirm(objectId, p, {requestKey}); assert.equal(replay.status, 'cancelled');
    const newKey = randomUUID(); const restored = await confirm(objectId, p, {requestKey: newKey});
    assert.equal(restored.status, 'confirmed'); assert.equal(restored.version, 3);
    assert.equal(restored.id, first[0].id); assert.equal(restored.dailyRateSnapshot, 2500);
    assert.equal((await entry(objectId)).autoValue, 2500); assert.equal((await entry(objectId)).dayValue, 9999);
    await confirm(objectId, p2, {requestKey: newKey}, 409);
    await request(`${path(objectId)}/attendance/${restored.id}/cancel`, 'POST', {expectedVersion: 3, reason: 'Повторная отмена'}, 201);
    const retry = await confirm(objectId, p, {requestKey: newKey}); assert.equal(retry.status, 'cancelled');
    assert.equal((await entry(objectId)).autoValue, 0);
  });

  await t.test('explicit day/night contours sum once; seasonal rate snapshots survive edits and cancellation', async () => {
    const objectId = await fixture();
    const day = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'day', name: 'День', dailyRate: 1000, summerDailyRate: 1200, winterDailyRate: null}, 201);
    const night = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'night', name: 'Ночь', dailyRate: 2000}, 201);
    const input = plan(day.id); input.groups[0].timeRanges.push({key: 'night', start: '20:00', end: '06:00', endDayOffset: 1, contourId: night.id});
    const p = await position(objectId, input);
    const dayFact = await confirm(objectId, p); const nightFact = await confirm(objectId, p, {timeRangeKey: 'night'});
    assert.equal(dayFact.dailyRateSnapshot, 1200); assert.equal(nightFact.dailyRateSnapshot, 2000);
    assert.equal((await entry(objectId)).dayValue, 3200);
    await request(`${path(objectId)}/contours/${day.id}`, 'PATCH', {expectedVersion: 1, dailyRate: 9000, summerDailyRate: 9900}, 200);
    await confirm(objectId, p); assert.equal((await entry(objectId)).dayValue, 3200);
    await request(`${path(objectId)}/attendance/${nightFact.id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Ночная смена снята'}, 201);
    assert.equal((await entry(objectId)).dayValue, 1200);
    await request(`${path(objectId)}/attendance/${dayFact.id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Проверка повторного подтверждения'}, 201);
    const restored = await confirm(objectId, p);
    assert.equal(restored.dailyRateSnapshot, 1200); assert.equal(restored.version, 3);
    assert.equal((await entry(objectId)).dayValue, 1200);
    assert.deepEqual((await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: dayFact.id}})).ratePolicySnapshot, dayFact.ratePolicySnapshot);
    const preview = await request<PreviewResponse>(`${path(objectId)}/preview`, 'POST', {from: today, to: today}, 201);
    assert.ok(preview.coverage[0].intervals.every(i => i.required === 1));
    assert.ok(preview.shifts.some(s => s.endsAt.startsWith(tomorrow)));
  });

  await t.test('reconfirming cancelled A100 conflicts with active same-contour B200 without changing snapshots or daily pay', async () => {
    const objectId = await fixture();
    const contour = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'shared', name: 'Общий контур', dailyRate: 100}, 201);
    const a = await position(objectId, plan(contour.id));
    const original = await confirm(objectId, a);
    assert.equal(original.dailyRateSnapshot, 100);
    await request(`${path(objectId)}/attendance/${original.id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Отмена A до смены ставки'}, 201);
    await request(`${path(objectId)}/contours/${contour.id}`, 'PATCH', {expectedVersion: 1, dailyRate: 200}, 200);
    const b = await position(objectId, plan(contour.id));
    const active = await confirm(objectId, b);
    assert.equal(active.dailyRateSnapshot, 200);
    const beforeA = await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: original.id}});
    const beforeB = await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: active.id}});
    const beforeDaily = await prisma.objectAttendanceFact.findFirstOrThrow({where: {objectId, employeeId}});
    const beforeEntry = await entry(objectId);
    assert.equal(beforeEntry.dayValue, 200);
    const requestKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await request<{code: string}>(`${path(objectId)}/attendance/confirm`, 'POST', {requestKey, positionId: a.id, revisionId: a.revisions[0].id, groupKey: 'A', timeRangeKey: 'day', employeeId, operationDate: today}, 409);
      assert.equal(failure.code, 'CONTOUR_SNAPSHOT_CONFLICT');
    }
    assert.deepEqual(await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: original.id}}), beforeA);
    assert.deepEqual(await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: active.id}}), beforeB);
    assert.deepEqual(await prisma.objectAttendanceFact.findFirstOrThrow({where: {objectId, employeeId}}), beforeDaily);
    assert.deepEqual(await entry(objectId), beforeEntry);
    assert.equal(beforeA.status, 'cancelled'); assert.equal(beforeA.dailyRateSnapshot, 100);
    assert.equal(beforeB.status, 'confirmed'); assert.equal(beforeB.dailyRateSnapshot, 200);
  });

  await t.test('monthly pay remains one daily allocation and rejects explicit daily contours', async () => {
    const objectId = await fixture();
    await prisma.object.update({where: {id: objectId}, data: {paymentType: 'monthly', monthlySalary: 31000, paymentScheduleWeekdays: ['mon','tue','wed','thu','fri','sat','sun']}});
    const p = await position(objectId); const p2 = await position(objectId);
    await confirm(objectId, p); const initial = await entry(objectId);
    assert.ok(initial.dayValue > 0);
    await confirm(objectId, p2); assert.equal((await entry(objectId)).dayValue, initial.dayValue);
    const contour = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'daily', name: 'Дневной', dailyRate: 1000}, 201);
    const explicit = await position(objectId, plan(contour.id));
    const failure = await request<{code: string}>(`${path(objectId)}/attendance/confirm`, 'POST', {requestKey: randomUUID(), positionId: explicit.id, revisionId: explicit.revisions[0].id, groupKey: 'A', timeRangeKey: 'day', employeeId, operationDate: today}, 409);
    assert.equal(failure.code, 'INCOMPATIBLE_PAY_MODES');
    assert.equal((await entry(objectId)).dayValue, initial.dayValue);
  });

  await t.test('scoped manager selects any ready object conditions including future B today, but cannot edit rates or select foreign contours', async () => {
    const objectId = await fixture();
    const a = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'a', name: 'Текущий', dailyRate: 100}, 201);
    const b = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'b', name: 'Будущий', dailyRate: 200}, 201);
    const input = plan(a.id); const p = await position(objectId, input);
    const future = plan(b.id); const {clientKey: futureKey, ...futureFields} = future; assert.ok(futureKey);
    await request(`${path(objectId)}/positions/${p.id}`, 'PUT', {...futureFields, effectiveFrom: tomorrow, expectedVersion: 1}, 200);
    const selected = await request<PositionView>(`${path(objectId)}/positions/${p.id}`, 'PUT', {...futureFields, effectiveFrom: today, expectedVersion: 2}, 200, 'manager');
    assert.equal(selected.version, 3);
    const capabilities = await request<{capabilities: {selectPayConditions: boolean; manageRates: boolean}}>(`${path(objectId)}/positions`, 'GET', undefined, 200, 'manager');
    assert.equal(capabilities.capabilities.selectPayConditions, true); assert.equal(capabilities.capabilities.manageRates, false);
    await request(`${path(objectId)}/contours`, 'POST', {code: 'forbidden', name: 'Запрещено', dailyRate: 300}, 403, 'manager');
    await request(`${path(objectId)}/contours/${b.id}`, 'PATCH', {expectedVersion: 1, dailyRate: 300}, 403, 'manager');
    const foreignObject = await fixture();
    const foreign = await request<Contour>(`${path(foreignObject)}/contours`, 'POST', {code: 'foreign', name: 'Чужой', dailyRate: 100}, 201);
    const foreignPlan = plan(foreign.id); const {clientKey: foreignKey, ...foreignFields} = foreignPlan; assert.ok(foreignKey);
    await request(`${path(objectId)}/positions/${p.id}`, 'PUT', {...foreignFields, expectedVersion: 3}, 400, 'manager');
    await request(`${path(objectId)}/positions`, 'POST', plan(b.id), 201, 'manager');
    const {clientKey, ...currentFields} = input; assert.ok(clientKey);
    const allowed = await request<PositionView>(`${path(objectId)}/positions/${p.id}`, 'PUT', {...currentFields, name: 'Выбраны прежние готовые условия', expectedVersion: 3}, 200, 'manager');
    assert.equal(allowed.version, 4);
    const preview = await request<PreviewResponse>(`${path(objectId)}/preview`, 'POST', {from: today, to: tomorrow, positionIds: [p.id]}, 201);
    assert.ok(preview.shifts.filter(s => s.operationDate === today).every(s => s.contourId === a.id));
    assert.ok(preview.shifts.filter(s => s.operationDate === tomorrow).every(s => s.contourId === b.id));
  });

  await t.test('monthly cancellation redistributes the capped amount using frozen snapshots and preserves manual final values', async () => {
    const objectId = await fixture();
    const now = new Date(`${today}T00:00:00Z`);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1)).toISOString().slice(0,10);
    const dates = Array.from({length: 4}, (_, index) => `${start.slice(0,8)}${String(index+1).padStart(2,'0')}`);
    const [year, month] = start.split('-').map(Number);
    await prisma.objectEmployeeAssignment.update({where: {objectId_employeeId: {objectId, employeeId}}, data: {ratePolicyType: 'monthly_fixed', ratePolicyBaseAmount: 100, ratePolicyWorkingDaysInMonth: 3, ratePolicyUpdatedAt: new Date(`${start}T00:00:00+03:00`)}});
    const input = plan(); input.groups[0].assignments[0].from = start;
    const p = await position(objectId, input);
    // Simulate an already-existing schedule from last month in this isolated fixture.
    await prisma.objectScheduleVersion.update({where: {id: p.revisions[0].id}, data: {effectiveFrom: new Date(`${start}T00:00:00Z`)}});
    const facts: Attendance[] = [];
    for (const operationDate of dates) facts.push(await confirm(objectId, p, {operationDate}));
    const entries = () => prisma.timesheetDayEntry.findMany({where: {row: {employeeId, timesheetMonth: {objectId, year, month}}}, orderBy: {dayOfMonth: 'asc'}});
    assert.equal((await entries()).reduce((sum, row) => sum+row.autoValue, 0), 100);
    await prisma.objectEmployeeAssignment.update({where: {objectId_employeeId: {objectId, employeeId}}, data: {ratePolicyBaseAmount: 999, ratePolicyUpdatedAt: new Date()}});
    await request(`${path(objectId)}/attendance/${facts[0].id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Снят ранний выход из четырёх'}, 201);
    const afterCancel = await entries();
    assert.equal(afterCancel[0].autoValue, 0);
    assert.equal(afterCancel.reduce((sum, row) => sum+row.autoValue, 0), 100);
    assert.equal(afterCancel.reduce((sum, row) => sum+row.dayValue, 0), 100);
    // Historical manual correction is a pre-existing fixture: its public API
    // correctly remains restricted to the current calendar month.
    await request('/timesheets/entries', 'POST', {objectId, year, month, employeeId, dayOfMonth: 2, dayValue: 77, comment: 'Ручной итог сохраняется при перераспределении'}, 400);
    await prisma.timesheetDayEntry.update({where: {id: afterCancel[1].id}, data: {dayValue: 77, manualValue: 77, isChangedManually: true, difference: 77-afterCancel[1].autoValue, comment: 'Ручной итог сохраняется при перераспределении'}});
    await request(`${path(objectId)}/attendance/${facts[2].id}/cancel`, 'POST', {expectedVersion: 1, reason: 'Снят ещё один выход'}, 201);
    const afterSecondCancel = await entries();
    assert.equal(afterSecondCancel.reduce((sum, row) => sum+row.autoValue, 0), 67);
    assert.equal(afterSecondCancel[1].dayValue, 77);
    assert.equal(afterSecondCancel[1].difference, 77-afterSecondCancel[1].autoValue);
    const restored = await confirm(objectId, p, {operationDate: dates[0]});
    assert.equal(restored.dailyRateSnapshot, facts[0].dailyRateSnapshot);
    const finalEntries = await entries();
    assert.equal(finalEntries.reduce((sum, row) => sum+row.autoValue, 0), 100);
    assert.equal(finalEntries[1].dayValue, 77); assert.equal(finalEntries[1].isChangedManually, true);
    assert.equal(finalEntries[1].comment, 'Ручной итог сохраняется при перераспределении');
    for (const fact of facts) assert.deepEqual((await prisma.objectShiftAttendance.findUniqueOrThrow({where: {id: fact.id}})).ratePolicySnapshot, fact.ratePolicySnapshot);
  });

  await t.test('ACL, availability, legacy, closed and future day protection are enforced before writes', async () => {
    const objectId = await fixture(); const p = await position(objectId);
    await request(`${path(objectId)}/contours`, 'POST', {code: 'forbidden', name: 'Запрещено', dailyRate: 1}, 403, 'manager');
    const contour = await request<Contour>(`${path(objectId)}/contours`, 'POST', {code: 'valid', name: 'Разрешено', dailyRate: 1000}, 201);
    await request(`${path(objectId)}/positions`, 'POST', plan(contour.id), 201, 'manager');
    await request(`${path(objectId)}/positions`, 'POST', {...plan(), headcount: -1}, 400);
    await request(`${path(objectId)}/positions`, 'POST', {...plan(), requiredPerShift: 0}, 400);
    const foreign = await fixture();
    await prisma.objectAssignment.deleteMany({where: {objectId: foreign, user: {login: 'manager1'}}});
    await request(`${path(foreign)}/positions`, 'GET', undefined, 403, 'manager');
    await confirm(objectId, p, {operationDate: tomorrow}, 409);
    const founder = await prisma.user.findUniqueOrThrow({where: {login: 'founder'}});
    const window = await prisma.employeeAvailabilityWindow.create({data: {employeeId, startDate: new Date(`${today}T00:00:00+03:00`), endDate: new Date(`${tomorrow}T00:00:00+03:00`), availabilityMode: 'full_day', availabilityStatus: 'unavailable', createdByUserId: founder.id}});
    const unavailable = await request<PreviewResponse>(`${path(objectId)}/preview`, 'POST', {from: today, to: today}, 201);
    assert.ok(unavailable.warnings.some(w => w.code === 'UNAVAILABLE'));
    await confirm(objectId, p, {}, 409); await prisma.employeeAvailabilityWindow.delete({where: {id: window.id}});
    await request(`/objects/${objectId}/attendance`, 'POST', {operationDate: today, employeeIds: [employeeId]}, 201);
    const conflict = await request<{code: string}>(`${path(objectId)}/attendance/confirm`, 'POST', {requestKey: randomUUID(), positionId: p.id, revisionId: p.revisions[0].id, groupKey: 'A', timeRangeKey: 'day', employeeId, operationDate: today}, 409);
    assert.equal(conflict.code, 'LEGACY_ATTENDANCE_CONFLICT');
    const [year, month] = today.split('-').map(Number);
    await prisma.timesheetMonth.update({where: {objectId_year_month: {objectId, year, month}}, data: {status: 'closed'}});
    await confirm(objectId, p, {}, 409);
    assert.equal(await prisma.objectShiftAttendance.count({where: {objectId}}), 0);
  });

  await t.test('employee selection creates scoped staffing/history atomically; invalid employee rolls back', async () => {
    const objectId = await fixture(); const input = plan();
    await prisma.objectEmployeeAssignment.deleteMany({where: {objectId, employeeId}});
    await request(`${path(objectId)}/positions`, 'POST', input, 403, 'manager');
    const founder = await prisma.user.findUniqueOrThrow({where: {login: 'founder'}});
    const permission = await prisma.permission.findUniqueOrThrow({where: {code: 'employees.assignments.manage'}});
    await prisma.userPermission.upsert({where: {userId_permissionId: {userId: founder.id, permissionId: permission.id}}, create: {userId: founder.id, permissionId: permission.id}, update: {}});
    // Login again to fetch the current canonical permission set.
    cookies.founder = await loginAndGetCookieHeader({baseUrl, login: 'founder', password: 'founder123'});
    await position(objectId, input);
    assert.equal(await prisma.objectEmployeeAssignment.count({where: {objectId, employeeId, isActive: true}}), 1);
    assert.equal(await prisma.employeeObjectAssignmentHistory.count({where: {objectId, employeeId}}), 1);
    const invalid = plan(); invalid.groups[0].assignments.push({employeeId: randomUUID(), from: today});
    await request(`${path(objectId)}/positions`, 'POST', invalid, 400);
    assert.equal(await prisma.objectStaffPosition.count({where: {objectId}}), 1);
  });

  await t.test('legacy daily aggregate feeds the exact first/last/month/year day in both runtime timezones', async () => {
    const zone = process.env.TZ;
    const founder = await prisma.user.findUniqueOrThrow({where: {login: 'founder'}});
    try {
      for (const timezone of ['UTC', 'Europe/Moscow']) for (const date of ['2024-02-29','2024-03-01','2024-12-31','2025-01-01']) {
        process.env.TZ = timezone;
        const objectId = await fixture(); const [year, month, dayOfMonth] = date.split('-').map(Number);
        await prisma.$transaction(async tx => {
          const container = await tx.timesheetMonth.create({data: {objectId, year, month, createdByUserId: founder.id}});
          const row = await tx.timesheetEmployeeRow.create({data: {timesheetMonthId: container.id, employeeId, employeeNameSnapshot: 'Date boundary fixture'}});
          await tx.objectAttendanceFact.create({data: {objectId, employeeId, operationDate: legacyFactDay(date), dailyRateSnapshot: 2500, source: 'shifts', ratePolicySnapshot: normalizeRatePolicy({ratePolicyType: 'daily_rate', ratePolicyBaseAmount: 2500}, 2500) as unknown as Prisma.InputJsonValue}});
          await app.get(TimesheetsService).syncAttendanceDay(tx, {objectId, timesheetMonthId: container.id, year, month, dayOfMonth, actorUserId: founder.id, previousFactEmployeeIds: [], employeeIds: [employeeId]});
          const entries = await tx.timesheetDayEntry.findMany({where: {rowId: row.id}});
          assert.deepEqual(entries.map(e => [e.dayOfMonth,e.dayValue]), [[dayOfMonth,2500]], `${timezone}:${date}`);
        });
      }
    } finally { process.env.TZ = zone; }
  });
});
