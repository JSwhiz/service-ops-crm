import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { cleanupCoreTestObject, createCoreTestObject, SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';
import type { PositionView } from '../src/modules/object-scheduling/scheduling.types';
import type { CreatePositionDto } from '../src/modules/object-scheduling/scheduling.dto';
import type { CompensationTermsDto } from '../src/modules/object-scheduling/compensation.dto';
import type { TimesheetResponseDto } from '../src/modules/timesheets/dto/timesheet-response.dto';
import type { TimesheetOverviewResponseDto } from '../src/modules/timesheets/dto/timesheet-overview-response.dto';
import { ObjectPlanningService } from '../src/modules/objects/object-planning.service';

interface Pending { status: string; adjustmentId: string; approvalRequestId: string }
interface Explanation { rows: Array<{ employeeId: string; advanceTotal: number; salaryTotal: number; entries: unknown[] }> }

// Read the actual exported worksheet, including cached formula values. No Excel
// dependency or external process is needed. ZIP metadata comes from its central directory.
function worksheet(buffer: Buffer): string {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'XLSX must contain a ZIP end record');
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const length = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString();
    if (name === 'xl/worksheets/sheet1.xml') {
      const local = buffer.readUInt32LE(offset + 42);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + buffer.readUInt32LE(offset + 20));
      const method = buffer.readUInt16LE(offset + 10);
      assert.ok(method === 0 || method === 8, 'supported XLSX compression');
      return (method === 8 ? inflateRawSync(data) : data).toString();
    }
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  assert.fail('XLSX must contain its main worksheet');
}

function exportedEmployee(xml: string, employeeName: string) {
  const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row =>
    [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(cell => ({
      column: /\br="([A-Z]+)\d+"/.exec(cell[1])?.[1],
      text: decode(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] ?? ''),
      number: /<v>([^<]+)<\/v>/.exec(cell[2])?.[1],
    })),
  );
  const header = rows.find(row => row.some(cell => cell.text === 'Аванс'));
  const employee = rows.find(row => row.some(cell => cell.text === employeeName));
  assert.ok(header); assert.ok(employee, `exported row for ${employeeName}`);
  const value = (label: string) => {
    const column = header.find(cell => cell.text === label)?.column;
    assert.ok(column, `export header ${label}`);
    const cell = employee.find(cell => cell.column === column);
    assert.ok(cell?.number !== undefined, `cached numeric value for ${label}`);
    return Number(cell.number);
  };
  return [value('Аванс'), value('ЗП'), value('Итого')];
}

test('independent team compensation acceptance (isolated runner only)', async t => {
  // Fail before constructing a client or starting the application. A flag alone
  // is insufficient: the existing runner always generates integration_<pid>_<index>.
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Main must use scripts/run-integration-tests.mjs');
  assert.match(new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  // The maintenance regression invokes the real entry point explicitly. Keep
  // its interval from changing fixtures midway through monetary assertions.
  app.get(ObjectPlanningService).onModuleDestroy();
  const objects: string[] = [];
  async function cleanupCreatedObjects() {
      // Availability belongs to an Employee across all objects. A completed
      // scenario must release its shifts before another reuses seeded people.
      // Retain each ID until cleanup succeeds so the outer fallback can retry.
      for (const objectId of [...objects]) {
        const adjustments = await prisma.objectCompensationAdjustment.findMany({ where: { objectId }, select: { id: true } });
        await prisma.approvalRequest.deleteMany({ where: { sourceEntityId: { in: adjustments.map(item => item.id) } } });
        await prisma.objectCompensationAdjustment.deleteMany({ where: { objectId } });
        await prisma.objectPayrollCredit.deleteMany({ where: { objectId } });
        await prisma.objectTeamFundVersion.deleteMany({ where: { objectId } });
        await prisma.objectCompensationVersion.deleteMany({ where: { objectId } });
        await prisma.employeeSubstitution.deleteMany({ where: { objectId } });
        await prisma.objectShiftAttendance.deleteMany({ where: { objectId } });
        await cleanupCoreTestObject(prisma, objectId);
        await prisma.auditEvent.deleteMany({ where: { entityType: 'object', entityId: objectId } });
        objects.splice(objects.indexOf(objectId), 1);
      }
  }
  t.afterEach(async () => { await cleanupCreatedObjects(); });
  t.after(async () => {
    try { await cleanupCreatedObjects(); }
    finally { await app.close(); await prisma.$disconnect(); }
  });
  const cookies = {
    founder: await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    director: await loginAndGetCookieHeader({ baseUrl, login: 'director', password: 'director123' }),
    deputy: await loginAndGetCookieHeader({ baseUrl, login: 'deputy1', password: 'deputy123' }),
    manager: await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  };
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const employeeId = SEEDED_EMPLOYEE_IDS.ivan;
  const replacementId = SEEDED_EMPLOYEE_IDS.sergey;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const schedule = (id: string) => `/objects/${id}/scheduling`;
  const compensation = (id: string) => `${schedule(id)}/compensation`;
  async function request<T>(path: string, method = 'GET', body?: unknown, status = 200, actor: keyof typeof cookies = 'founder'): Promise<T> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method,
      headers: { Cookie: cookies[actor], 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data as T;
  }
  async function fixture() {
    const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
    objects.push(objectId);
    return objectId;
  }
  async function historicalPosition(objectId: string, from = '2026-03-01', contourId: string | null = null) {
    const input: CreatePositionDto = { clientKey: randomUUID(), name: 'Acceptance position', effectiveFrom: today,
      requiredPerShift: 1, headcount: 3, template: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] },
      groups: [{ key: 'A', name: 'Day', offsetDays: 0, assignments: [{ employeeId, from }],
        timeRanges: [{ key: 'day', start: '08:00', end: '16:00', endDayOffset: 0, contourId }],
      }],
    };
    const position = await request<PositionView>(`${schedule(objectId)}/positions`, 'POST', input, 201);
    // Historical fixtures represent data saved on that date. Backdating through
    // the public version endpoint is deliberately forbidden and tested separately.
    await prisma.objectScheduleVersion.update({ where: { id: position.revisions[0].id }, data: { effectiveFrom: new Date(`${from}T00:00:00Z`) } });
    return position;
  }
  async function storedTerms(objectId: string, terms: CompensationTermsDto, effectiveFrom = '2026-03-01', version = 1) {
    return prisma.objectCompensationVersion.create({ data: { objectId, scope: 'defaults', scopeId: objectId,
      version, requestKey: randomUUID(), effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`),
      terms: { ...terms, calculationVersion: 'half_salary_v2' }, createdByUserId: founder.id,
    } });
  }
  async function confirm(objectId: string, position: PositionView, operationDate: string, requestKey = randomUUID(), timeRangeKey = 'day') {
    const input = { requestKey, positionId: position.id, revisionId: position.revisions[0].id,
      groupKey: 'A', timeRangeKey, employeeId, operationDate };
    const pending = await request<Pending>(`${schedule(objectId)}/attendance/confirm`, 'POST', input, 201);
    assert.equal(pending.status, 'pending', 'founder must not bypass historical approval');
    assert.ok(pending.approvalRequestId);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    return prisma.objectShiftAttendance.findFirstOrThrow({ where: { objectId, employeeId, operationDate: new Date(`${operationDate}T00:00:00Z`) } });
  }
  async function amounts(objectId: string, operationDate: string) {
    const entries = await prisma.timesheetDayEntry.findMany({ where: { dayOfMonth: Number(operationDate.slice(8)),
      row: { timesheetMonth: { objectId, year: Number(operationDate.slice(0, 4)), month: Number(operationDate.slice(5, 7)) } },
    }, include: { row: { select: { employeeId: true } } } });
    return new Map(entries.map(entry => [entry.row.employeeId, entry.dayValue]));
  }
  async function adjustment(objectId: string, input: Record<string, unknown>) {
    const result = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', { requestKey: randomUUID(), reason: 'Independent contract acceptance', ...input }, 201);
    assert.equal(result.status, 'pending');
    assert.ok(result.approvalRequestId);
    return result;
  }
  async function download(path: string) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: cookies.founder } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/);
    return worksheet(Buffer.from(await response.arrayBuffer()));
  }

  async function savedMayHoliday(objectId: string) {
    const version = await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 30_000,
      paidHolidays: true, scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, '2026-05-01');
    const policy = { calculationVersion: 'half_salary_v2', compensationVersionId: version.id,
      ratePolicyType: 'monthly_fixed', baseAmount: 30_000, paidHolidays: true,
      normDaysFirstHalf: 15, normDaysSecondHalf: 16, scheduleCode: null,
      scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      roundingMode: 'none', roundingStep: null, standardShiftHours: 8,
      workingDaysInMonth: null, excludedHolidayDays: null, notes: null };
    const month = await prisma.timesheetMonth.create({ data: { objectId, year: 2026, month: 5, createdByUserId: founder.id } });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const row = await prisma.timesheetEmployeeRow.create({ data: { timesheetMonthId: month.id, employeeId, employeeNameSnapshot: employee.fullName } });
    await prisma.timesheetDayEntry.create({ data: { rowId: row.id, dayOfMonth: 1, autoValue: 1_000, dayValue: 1_000,
      ratePolicySnapshot: policy, calculationExplanation: 'Saved paid holiday, no attendance', createdByUserId: founder.id } });
    const credit = await prisma.objectPayrollCredit.create({ data: { objectId, employeeId, operationDate: new Date('2026-05-01T00:00:00Z'),
      sourceKey: `holiday:${employeeId}:2026-05-01:default`, amount: 1_000, policySnapshot: policy,
      explanation: 'Saved holiday credit before subsequent attendance', createdByUserId: founder.id } });
    return { credit, version, policy };
  }

  await t.test('saved holiday plus later legacy attendance pays one 1000 credit, not 2000', async () => {
    const objectId = await fixture();
    const { credit } = await savedMayHoliday(objectId);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    const payload = { operationDate: '2026-05-01', employeeIds: [employeeId] };
    const pending = await request<Pending>(`/objects/${objectId}/attendance`, 'POST', payload, 201);
    assert.equal(pending.status, 'pending');
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 1_000);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 1_000);
    const credits = await prisma.objectPayrollCredit.findMany({ where: { objectId } });
    assert.equal(credits.reduce((sum, item) => sum + item.amount, 0), 1_000);
    assert.equal(credits.find(item => item.id === credit.id)?.amount, 0, 'holiday source is superseded, with history retained');
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 1);
  });

  await t.test('legacy attendance with only the substitute transfers the primary holiday instead of paying both', async () => {
    const objectId = await fixture();
    const { credit } = await savedMayHoliday(objectId);
    await prisma.objectEmployeeAssignment.update({ where: { objectId_employeeId: { objectId, employeeId: replacementId } },
      data: { ratePolicyType: 'daily_rate', ratePolicyBaseAmount: 9_999, ratePolicyUpdatedAt: new Date('2026-04-01T00:00:00Z') } });
    await prisma.employeeSubstitution.create({ data: { objectId, employeeId, substituteEmployeeId: replacementId,
      startDate: new Date('2026-04-30T00:00:00Z'), endDate: new Date('2026-05-02T00:00:00Z'), status: 'active',
      reason: 'Legacy attendance only names the actual substitute', createdByUserId: founder.id } });
    const payload = { operationDate: '2026-05-01', employeeIds: [replacementId] };
    const pending = await request<Pending>(`/objects/${objectId}/attendance`, 'POST', payload, 201);
    assert.equal(pending.status, 'pending');
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 1_000);
    assert.equal((await amounts(objectId, '2026-05-01')).get(replacementId) ?? 0, 0);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 403, 'founder');
    assert.equal((await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount, 1_000);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await request(`/objects/${objectId}/attendance`, 'POST', payload, 201);
    const paid = await amounts(objectId, '2026-05-01');
    assert.equal(paid.get(employeeId) ?? 0, 0); assert.equal(paid.get(replacementId), 1_000);
    assert.equal([...paid.values()].reduce((sum, amount) => sum + amount, 0), 1_000);
    assert.equal((await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount, 0);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 1_000);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId, employeeId } }), 0);
    const replacementFact = await prisma.objectAttendanceFact.findFirstOrThrow({ where: { objectId, employeeId: replacementId } });
    assert.equal(replacementFact.dailyRateSnapshot, 1_000);
    assert.equal((replacementFact.ratePolicySnapshot as { baseAmount: number }).baseAmount, 30_000);
  });

  await t.test('legacy replacement cannot transfer a primary holiday while a saved manual 1000 amount remains', async () => {
    const objectId = await fixture(); const { credit } = await savedMayHoliday(objectId);
    const entry = await prisma.timesheetDayEntry.findFirstOrThrow({ where: { dayOfMonth: 1,
      row: { employeeId, timesheetMonth: { objectId, year: 2026, month: 5 } } } });
    const manual = await prisma.timesheetDayEntry.update({ where: { id: entry.id }, data: {
      dayValue: 1_000, manualValue: 1_000, isChangedManually: true, difference: 0,
      comment: 'Saved manual amount needs its own independent reconciliation', updatedByUserId: founder.id,
    } });
    await prisma.employeeSubstitution.create({ data: { objectId, employeeId, substituteEmployeeId: replacementId,
      startDate: new Date('2026-04-30T00:00:00Z'), endDate: new Date('2026-05-02T00:00:00Z'), status: 'active',
      reason: 'Replacement must not leave the primary manual amount paid too', createdByUserId: founder.id } });
    const response = await fetch(`${baseUrl}/api/v1/objects/${objectId}/attendance`, { method: 'POST',
      headers: { Cookie: cookies.founder, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationDate: '2026-05-01', employeeIds: [replacementId] }),
    });
    const result = await response.json() as Pending & { code?: string };
    // The guard may reject the request immediately or reject its independently
    // approved application. Neither path may first remove or duplicate money.
    assert.ok(response.status === 409 || response.status === 201, JSON.stringify(result));
    if (response.status === 201) {
      assert.equal(result.status, 'pending'); assert.ok(result.approvalRequestId);
      assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: manual.id } }), manual);
      const denied = await request<{ code: string }>(`/approvals/${result.approvalRequestId}/approve`, 'POST', {}, 409, 'director');
      assert.equal(denied.code, 'MANUAL_DAY_REQUIRES_RECONCILIATION');
    } else assert.equal(result.code, 'MANUAL_DAY_REQUIRES_RECONCILIATION');
    assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: manual.id } }), manual);
    assert.deepEqual(await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: credit.id } }), credit);
    const paid = await amounts(objectId, '2026-05-01');
    assert.equal(paid.get(employeeId), 1_000); assert.equal(paid.get(replacementId) ?? 0, 0);
    assert.equal([...paid.values()].reduce((sum, amount) => sum + amount, 0), 1_000);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 1);
  });

  await t.test('a primary holiday credit is transferred when the substitute first confirms; team still receives only 1000', async () => {
    const objectId = await fixture();
    const position = await historicalPosition(objectId, '2026-05-01');
    const { credit } = await savedMayHoliday(objectId);
    const substitution = await prisma.employeeSubstitution.create({ data: { objectId, employeeId,
      substituteEmployeeId: replacementId, startDate: new Date('2026-04-30T00:00:00Z'), endDate: new Date('2026-05-02T00:00:00Z'),
      status: 'active', reason: 'Replace an already credited holiday', createdByUserId: founder.id } });
    const payload = { requestKey: randomUUID(), positionId: position.id, revisionId: position.revisions[0].id,
      groupKey: 'A', timeRangeKey: 'day', employeeId, replacementEmployeeId: replacementId, substitutionId: substitution.id, operationDate: '2026-05-01' };
    const pending = await request<Pending>(`${schedule(objectId)}/attendance/confirm`, 'POST', payload, 201);
    assert.equal(pending.status, 'pending');
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 1_000);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await request(`${schedule(objectId)}/attendance/confirm`, 'POST', payload, 201);
    const paid = await amounts(objectId, '2026-05-01');
    assert.equal(paid.get(employeeId) ?? 0, 0); assert.equal(paid.get(replacementId), 1_000);
    assert.equal([...paid.values()].reduce((sum, value) => sum + value, 0), 1_000);
    assert.equal((await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount, 0);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 1_000);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId, employeeId } }), 0);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId, employeeId: replacementId } }), 1);
  });

  await t.test('two ranges in the same contour pay the full monthly schedule once, not half its salary', async () => {
    const objectId = await fixture();
    const contour = await prisma.objectPayContour.create({ data: { objectId, code: 'split-salary', name: 'One salary split into two daily ranges',
      dailyRate: 0, effectiveFrom: new Date('2026-03-01T00:00:00Z') } });
    const position = await historicalPosition(objectId, '2026-03-01', contour.id);
    // Exactly three payable days in each half, with two operational ranges on
    // every date. A contour pays once per employee/day, irrespective of ranges.
    const days = [2, 3, 4, 16, 17, 18];
    const groups = [{ key: 'A', name: 'Split day', offsetDays: 0, assignments: [{ employeeId, from: '2026-03-01' }], timeRanges: [
      { key: 'day', start: '08:00', end: '12:00', endDayOffset: 0, contourId: contour.id },
      { key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: contour.id },
    ] }];
    await prisma.objectScheduleVersion.update({ where: { id: position.revisions[0].id }, data: { groups,
      template: { kind: 'weekly', weekdays: [], exceptions: days.map(day => ({ date: `2026-03-${String(day).padStart(2, '0')}`, working: true })) } } });
    await prisma.objectCompensationVersion.create({ data: { objectId, scope: 'contour', scopeId: contour.id, version: 1,
      effectiveFrom: new Date('2026-03-01T00:00:00Z'), requestKey: randomUUID(), createdByUserId: founder.id,
      terms: { ratePolicyType: 'monthly_fixed', baseAmount: 10_000, paidHolidays: false, calculationVersion: 'half_salary_v2' } } });
    await prisma.objectTeamFundVersion.create({ data: { objectId, version: 1, requestKey: randomUUID(),
      effectiveFrom: new Date('2026-03-01T00:00:00Z'), monthlyAmount: 10_000,
      allocations: [{ positionId: position.id, contourId: contour.id, monthlyAmount: 10_000 }],
      reason: 'One monthly pool, not one per time range', createdByUserId: founder.id } });
    for (const day of days) {
      const date = `2026-03-${String(day).padStart(2, '0')}`;
      await confirm(objectId, position, date);
      await confirm(objectId, position, date, randomUUID(), 'afternoon');
    }
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    const row = ts.rows.find(item => item.employeeId === employeeId); assert.ok(row);
    assert.deepEqual([row.advanceTotal, row.salaryTotal, row.rowTotal], [5_000, 5_000, 10_000]);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 12);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 6);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 10_000);
  });

  await t.test('distinct morning and afternoon employees in one contour both confirm with requiredPerShift one and norm two', async () => {
    const objectId = await fixture();
    const contour = await prisma.objectPayContour.create({ data: { objectId, code: 'distinct-salary', name: 'Distinct morning and afternoon workers',
      dailyRate: 0, effectiveFrom: new Date('2026-03-01T00:00:00Z') } });
    const position = await historicalPosition(objectId, '2026-03-01', contour.id);
    await prisma.objectScheduleVersion.update({ where: { id: position.revisions[0].id }, data: {
      requiredPerShift: 1, headcount: 2,
      template: { kind: 'weekly', weekdays: [], exceptions: [
        { date: '2026-03-02', working: true }, { date: '2026-03-16', working: true },
      ] },
      groups: [
        { key: 'morning', name: 'Morning', offsetDays: 0, assignments: [{ employeeId, from: '2026-03-01' }],
          timeRanges: [{ key: 'morning', start: '08:00', end: '12:00', endDayOffset: 0, contourId: contour.id }] },
        { key: 'afternoon', name: 'Afternoon', offsetDays: 0, assignments: [{ employeeId: replacementId, from: '2026-03-01' }],
          timeRanges: [{ key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: contour.id }] },
      ],
    } });
    await prisma.objectCompensationVersion.create({ data: { objectId, scope: 'contour', scopeId: contour.id, version: 1,
      effectiveFrom: new Date('2026-03-01T00:00:00Z'), requestKey: randomUUID(), createdByUserId: founder.id,
      terms: { ratePolicyType: 'monthly_fixed', baseAmount: 10_000, paidHolidays: false, calculationVersion: 'half_salary_v2' } } });
    await prisma.objectTeamFundVersion.create({ data: { objectId, version: 1, requestKey: randomUUID(),
      effectiveFrom: new Date('2026-03-01T00:00:00Z'), monthlyAmount: 10_000,
      allocations: [{ positionId: position.id, contourId: contour.id, monthlyAmount: 10_000 }],
      reason: 'One shared pool covers both distinct daily workers', createdByUserId: founder.id } });
    for (const date of ['2026-03-02', '2026-03-16']) {
      for (const [groupKey, worker] of [['morning', employeeId], ['afternoon', replacementId]]) {
        const pending = await request<Pending>(`${schedule(objectId)}/attendance/confirm`, 'POST', {
          requestKey: randomUUID(), positionId: position.id, revisionId: position.revisions[0].id,
          groupKey, timeRangeKey: groupKey, employeeId: worker, operationDate: date,
        }, 201);
        assert.equal(pending.status, 'pending');
        await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
      }
      const paid = await amounts(objectId, date);
      assert.equal(paid.get(employeeId), 2_500); assert.equal(paid.get(replacementId), 2_500);
    }
    const shifts = await prisma.objectShiftAttendance.findMany({ where: { objectId } });
    assert.equal(shifts.length, 4);
    for (const shift of shifts) {
      const policy = shift.ratePolicySnapshot as { normDaysFirstHalf: number; normDaysSecondHalf: number };
      assert.deepEqual([policy.normDaysFirstHalf, policy.normDaysSecondHalf], [2, 2]);
    }
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.deepEqual([ts.advanceTotal, ts.salaryTotal, ts.monthTotal], [5_000, 5_000, 10_000]);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 4);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 10_000);
  });

  await t.test('excluding the middle holiday reconciles two thirds of a 5000 half to 3333, not 3334', async () => {
    const objectId = await fixture(); const position = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 10_000, scheduleWeekdays: ['sun'], paidHolidays: true });
    await confirm(objectId, position, '2026-03-01');
    const include = await adjustment(objectId, { kind: 'holiday_exception', operationDate: '2026-03-08', employeeId, paid: true });
    await request(`/approvals/${include.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await confirm(objectId, position, '2026-03-15');
    const holiday = await prisma.objectPayrollCredit.findFirstOrThrow({ where: { objectId, sourceKey: `holiday:${employeeId}:2026-03-08:default` } });
    assert.equal(holiday.amount, 1_666, 'middle unit of the saved 1667/1666/1667 sequence');
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 5_000);
    const input = { requestKey: randomUUID(), kind: 'holiday_exception', operationDate: '2026-03-08', employeeId,
      paid: false, reason: 'Explicitly exclude only the middle holiday' };
    const exclude = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', input, 201);
    assert.equal(exclude.status, 'pending');
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 5_000);
    await request(`/approvals/${exclude.approvalRequestId}/approve`, 'POST', {}, 403, 'founder');
    await request(`/approvals/${exclude.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    const replay = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', input, 201);
    assert.equal(replay.adjustmentId, exclude.adjustmentId);
    assert.equal((await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: holiday.id } })).amount, 0);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 3_333);
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.equal(ts.rows.find(row => row.employeeId === employeeId)?.advanceTotal, 3_333);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 2);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId, operationDate: new Date('2026-03-07T21:00:00Z') } }), 0);
  });

  await t.test('identical terms at three version boundaries conserve 5000 across three slots instead of paying 5001', async () => {
    const objectId = await fixture(); const position = await historicalPosition(objectId);
    // March 1, 8, 15 are the three Sundays in the first half. Saving otherwise
    // identical terms on each date must not restart 5000/3 rounding each time.
    const terms: CompensationTermsDto = { ratePolicyType: 'monthly_fixed', baseAmount: 10_000, scheduleWeekdays: ['sun'], paidHolidays: false };
    const versions = [];
    for (const [index, day] of [1, 8, 15].entries()) {
      versions.push(await storedTerms(objectId, terms, `2026-03-${String(day).padStart(2, '0')}`, index + 1));
    }
    const saved = [];
    for (const day of [1, 8, 15]) saved.push(await confirm(objectId, position, `2026-03-${String(day).padStart(2, '0')}`));
    assert.deepEqual(saved.map(shift => (shift.ratePolicySnapshot as { compensationVersionId: string }).compensationVersionId), versions.map(version => version.id));
    assert.equal(saved.reduce((sum, shift) => sum + shift.dailyRateSnapshot, 0), 5_000);
    const credits = await prisma.objectPayrollCredit.findMany({ where: { objectId } });
    assert.equal(credits.reduce((sum, credit) => sum + credit.amount, 0), 5_000);
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.equal(ts.rows.find(row => row.employeeId === employeeId)?.advanceTotal, 5_000);
    const cancel = await request<Pending>(`${schedule(objectId)}/attendance/${saved[1].id}/cancel`, 'POST', {
      expectedVersion: saved[1].version, reason: 'Remove the middle of three equal salary units',
    }, 201);
    assert.equal(cancel.status, 'pending');
    const beforeDecision = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.equal(beforeDecision.rows.find(row => row.employeeId === employeeId)?.advanceTotal, 5_000);
    await request(`/approvals/${cancel.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    const afterCancel = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.equal(afterCancel.rows.find(row => row.employeeId === employeeId)?.advanceTotal, 3_333,
      'two thirds of a 5000 half must round once; removing a rounded middle day must not leave 3334');
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 3_333);
    const restored = await confirm(objectId, position, '2026-03-08', randomUUID());
    assert.deepEqual(restored.ratePolicySnapshot, saved[1].ratePolicySnapshot, 'reconfirmation preserves original dated terms');
    const afterRestore = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    assert.equal(afterRestore.rows.find(row => row.employeeId === employeeId)?.advanceTotal, 5_000);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 5_000);
  });

  await t.test('maintenance finds a missed holiday without a planning-settings row, requests approval once and never invents attendance', async () => {
    const objectId = await fixture();
    const position = await historicalPosition(objectId, '2026-05-01');
    await prisma.objectScheduleVersion.update({ where: { id: position.revisions[0].id }, data: {
      groups: [{ key: 'A', name: 'One eligible holiday', offsetDays: 0,
        assignments: [{ employeeId, from: '2026-05-01', to: '2026-05-01' }],
        timeRanges: [{ key: 'day', start: '08:00', end: '16:00', endDayOffset: 0, contourId: null }] }],
    } });
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 30_000,
      paidHolidays: true, scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, '2026-05-01');
    assert.equal(await prisma.objectPlanningSettings.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0);
    const maintenance = app.get(ObjectPlanningService);
    await maintenance.runMaintenance();
    await maintenance.runMaintenance();
    const pending = await prisma.objectCompensationAdjustment.findMany({ where: { objectId, operationDate: new Date('2026-05-01T00:00:00Z'), status: 'pending' } });
    assert.equal(pending.length, 1, 'missed past holiday must be discovered and requested once despite absent consumables planning settings');
    const approval = await prisma.approvalRequest.findMany({ where: { sourceEntityId: pending[0].id } });
    assert.equal(approval.length, 1); assert.equal(approval[0].status, 'pending');
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0, 'maintenance cannot bypass retroactive approval');
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 0);
    await request(`/approvals/${approval[0].id}/approve`, 'POST', {}, 403, 'founder');
    await request(`/approvals/${approval[0].id}/approve`, 'POST', {}, 200, 'director');
    await maintenance.runMaintenance();
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 1_000);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 1_000);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectPlanningSettings.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId, operationDate: new Date('2026-05-01T00:00:00Z') } }), 1);
  });

  await t.test('holiday catch-up distinguishes two monthly contours and continues processing another object', async () => {
    const objectId = await fixture();
    const contourIds: string[] = [];
    for (const code of ['morning-holiday', 'afternoon-holiday']) {
      const contour = await prisma.objectPayContour.create({ data: { objectId, code, name: code,
        dailyRate: 0, effectiveFrom: new Date('2026-05-01T00:00:00Z') } });
      contourIds.push(contour.id);
    }
    const position = await historicalPosition(objectId, '2026-05-01', contourIds[0]);
    await prisma.objectScheduleVersion.update({ where: { id: position.revisions[0].id }, data: {
      groups: [{ key: 'A', name: 'Two separately paid contours', offsetDays: 0,
        assignments: [{ employeeId, from: '2026-05-01', to: '2026-05-01' }], timeRanges: [
          { key: 'day', start: '08:00', end: '12:00', endDayOffset: 0, contourId: contourIds[0] },
          { key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: contourIds[1] },
        ] }],
    } });
    for (const contourId of contourIds) await prisma.objectCompensationVersion.create({ data: {
      objectId, scope: 'contour', scopeId: contourId, version: 1, effectiveFrom: new Date('2026-05-01T00:00:00Z'),
      requestKey: randomUUID(), createdByUserId: founder.id,
      terms: { ratePolicyType: 'monthly_fixed', baseAmount: 30_000, paidHolidays: true, calculationVersion: 'half_salary_v2' },
    } });
    await prisma.objectTeamFundVersion.create({ data: { objectId, version: 1, requestKey: randomUUID(),
      effectiveFrom: new Date('2026-05-01T00:00:00Z'), monthlyAmount: 60_000,
      allocations: contourIds.map(contourId => ({ positionId: position.id, contourId, monthlyAmount: 30_000 })),
      reason: 'Two independent monthly contour pools', createdByUserId: founder.id } });

    const otherId = await fixture();
    const otherPosition = await historicalPosition(otherId, '2026-05-01');
    await prisma.objectScheduleVersion.update({ where: { id: otherPosition.revisions[0].id }, data: {
      groups: [{ key: 'A', name: 'Another object must still be processed', offsetDays: 0,
        assignments: [{ employeeId, from: '2026-05-01', to: '2026-05-01' }],
        timeRanges: [{ key: 'day', start: '17:00', end: '19:00', endDayOffset: 0, contourId: null }] }],
    } });
    await storedTerms(otherId, { ratePolicyType: 'monthly_fixed', baseAmount: 30_000, paidHolidays: true,
      scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, '2026-05-01');
    const maintenance = app.get(ObjectPlanningService);
    await maintenance.runMaintenance();
    await maintenance.runMaintenance();
    const pending = await prisma.objectCompensationAdjustment.findMany({ where: { objectId, operationDate: new Date('2026-05-01T00:00:00Z'), status: 'pending' } });
    const otherPending = await prisma.objectCompensationAdjustment.findMany({ where: { objectId: otherId, operationDate: new Date('2026-05-01T00:00:00Z'), status: 'pending' } });
    assert.equal(pending.length, 2, 'one independent request for each monthly contour, with no ambiguity abort');
    assert.deepEqual(pending.map(item => (item.payload as { contourId?: string }).contourId).sort(), [...contourIds].sort());
    assert.equal(otherPending.length, 1, 'the next object is processed in the same maintenance sweep');
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId: { in: [objectId, otherId] } } }), 0);
    for (const item of [...pending, ...otherPending]) {
      const approvals = await prisma.approvalRequest.findMany({ where: { sourceEntityId: item.id } });
      assert.equal(approvals.length, 1); assert.equal(approvals[0].status, 'pending');
      await request(`/approvals/${approvals[0].id}/approve`, 'POST', {}, 200, 'director');
    }
    await maintenance.runMaintenance();
    assert.equal((await amounts(objectId, '2026-05-01')).get(employeeId), 2_000);
    assert.equal((await amounts(otherId, '2026-05-01')).get(employeeId), 1_000);
    assert.equal((await prisma.objectPayrollCredit.aggregate({ where: { objectId }, _sum: { amount: true } }))._sum.amount, 2_000);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId } }), 2);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId: otherId } }), 1);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId: { in: [objectId, otherId] } } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId: { in: [objectId, otherId] } } }), 0);
  });

  await t.test('20k, first-half 5/10 and full second half: persisted 5000/10000 across all views and Excel', async () => {
    const objectId = await fixture();
    const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 20_000, scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    // March 2026: first half 10 weekdays, second half 12; explicit dates are an independent calendar oracle.
    for (const day of [2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30, 31]) {
      await confirm(objectId, p, `2026-03-${String(day).padStart(2, '0')}`);
    }
    const beforeEntries = await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } }, orderBy: { id: 'asc' } });
    const beforeCredits = await prisma.objectPayrollCredit.findMany({ where: { objectId }, orderBy: { id: 'asc' } });
    const totals = [
      beforeEntries.filter(entry => entry.dayOfMonth <= 15).reduce((sum, entry) => sum + entry.dayValue, 0),
      beforeEntries.filter(entry => entry.dayOfMonth > 15).reduce((sum, entry) => sum + entry.dayValue, 0),
    ];
    assert.deepEqual(totals, [5_000, 10_000]);
    const query = `objectId=${objectId}&year=2026&month=3`;
    const ts = await request<TimesheetResponseDto>(`/timesheets?${query}`);
    const overview = await request<TimesheetOverviewResponseDto>(`/timesheets/overview?${query}`);
    const explanation = await request<Explanation>(`${compensation(objectId)}/explanation?year=2026&month=3`);
    const row = ts.rows.find(item => item.employeeId === employeeId);
    const summary = overview.rows.find(item => item.employeeId === employeeId && item.objectId === objectId);
    const detail = explanation.rows.find(item => item.employeeId === employeeId);
    assert.ok(row); assert.ok(summary); assert.ok(detail);
    assert.deepEqual([row.advanceTotal, row.salaryTotal, row.rowTotal], [5_000, 10_000, 15_000]);
    assert.deepEqual([summary.advanceTotal, summary.salaryTotal, summary.monthTotal], [5_000, 10_000, 15_000]);
    assert.deepEqual([detail.advanceTotal, detail.salaryTotal], [5_000, 10_000]);
    for (const saved of beforeEntries) {
      assert.equal(row.entries.find(entry => entry.dayOfMonth === saved.dayOfMonth)?.finalValue, saved.dayValue);
      assert.equal(summary.entries.find(entry => entry.dayOfMonth === saved.dayOfMonth)?.finalValue, saved.dayValue);
    }
    const name = (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).fullName;
    assert.deepEqual(exportedEmployee(await download(`/timesheets/export?${query}`), name), [5_000, 10_000, 15_000]);
    assert.deepEqual(exportedEmployee(await download(`/timesheets/overview/export?${query}`), name), [5_000, 10_000, 15_000]);
    assert.deepEqual(await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } }, orderBy: { id: 'asc' } }), beforeEntries);
    assert.deepEqual(await prisma.objectPayrollCredit.findMany({ where: { objectId }, orderBy: { id: 'asc' } }), beforeCredits);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 17);
  });

  await t.test('odd monthly salary is conserved through persisted daily rounding, even entered out of order', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 10_001, scheduleWeekdays: ['mon'] });
    for (const day of [30, 9, 16, 2, 23]) await confirm(objectId, p, `2026-03-${String(day).padStart(2, '0')}`);
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    const row = ts.rows.find(item => item.employeeId === employeeId); assert.ok(row);
    assert.deepEqual([row.advanceTotal, row.salaryTotal, row.rowTotal], [5_001, 5_000, 10_001]);
  });

  await t.test('joining on March 9 retains a ten-day first-half norm and pays five worked days as 5000', async () => {
    const objectId = await fixture();
    await prisma.objectEmployeeAssignment.update({ where: { objectId_employeeId: { objectId, employeeId } }, data: { startDate: new Date('2026-03-08T21:00:00Z') } });
    const p = await historicalPosition(objectId, '2026-03-09');
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 20_000, scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    for (const day of [9, 10, 11, 12, 13]) await confirm(objectId, p, `2026-03-${String(day).padStart(2, '0')}`);
    const ts = await request<TimesheetResponseDto>(`/timesheets?objectId=${objectId}&year=2026&month=3`);
    const row = ts.rows.find(item => item.employeeId === employeeId); assert.ok(row);
    assert.equal(row.advanceTotal, 5_000);
    const saved = await prisma.objectShiftAttendance.findFirstOrThrow({ where: { objectId } });
    assert.equal((saved.ratePolicySnapshot as { normDaysFirstHalf: number }).normDaysFirstHalf, 10);
  });

  await t.test('new conditions and repeated reads/exports preserve legacy snapshots and manual historical money', async () => {
    const objectId = await fixture();
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const policy = { ratePolicyType: 'monthly_fixed', baseAmount: 20_000, scheduleCode: '5/2',
      scheduleWeekdays: [], roundingMode: 'none', roundingStep: null, standardShiftHours: 8,
      workingDaysInMonth: 22, excludedHolidayDays: null, notes: 'Saved before policy cutover' };
    const month = await prisma.timesheetMonth.create({ data: { objectId, year: 2026, month: 3, createdByUserId: founder.id } });
    const row = await prisma.timesheetEmployeeRow.create({ data: { timesheetMonthId: month.id, employeeId, employeeNameSnapshot: employee.fullName } });
    await prisma.timesheetDayEntry.createMany({ data: [
      { rowId: row.id, dayOfMonth: 2, autoValue: 777, dayValue: 777, ratePolicySnapshot: policy, createdByUserId: founder.id },
      { rowId: row.id, dayOfMonth: 16, autoValue: 500, dayValue: 543, manualValue: 543, difference: 43,
        isChangedManually: true, comment: 'Historical manual amount', ratePolicySnapshot: policy, createdByUserId: founder.id },
    ] });
    await prisma.objectAttendanceFact.create({ data: { objectId, employeeId, operationDate: new Date('2026-03-01T21:00:00Z'),
      dailyRateSnapshot: 777, ratePolicySnapshot: policy, createdByUserId: founder.id } });
    const savedEntries = await prisma.timesheetDayEntry.findMany({ where: { rowId: row.id }, orderBy: { dayOfMonth: 'asc' } });
    const savedFacts = await prisma.objectAttendanceFact.findMany({ where: { objectId } });
    await request(`${compensation(objectId)}/versions`, 'POST', { requestKey: randomUUID(), scope: 'defaults', effectiveFrom: today,
      expectedVersion: 0, terms: { ratePolicyType: 'monthly_fixed', baseAmount: 99_999, scheduleWeekdays: ['mon'] } }, 201);
    const query = `objectId=${objectId}&year=2026&month=3`;
    for (let read = 0; read < 2; read++) {
      const ts = await request<TimesheetResponseDto>(`/timesheets?${query}`);
      const overview = await request<TimesheetOverviewResponseDto>(`/timesheets/overview?${query}`);
      const detail = ts.rows.find(item => item.employeeId === employeeId);
      const summary = overview.rows.find(item => item.employeeId === employeeId); assert.ok(detail); assert.ok(summary);
      assert.deepEqual([detail.advanceTotal, detail.salaryTotal, detail.rowTotal], [777, 543, 1_320]);
      assert.deepEqual([summary.advanceTotal, summary.salaryTotal, summary.monthTotal], [777, 543, 1_320]);
      await request(`${compensation(objectId)}/explanation?year=2026&month=3`);
    }
    assert.deepEqual(exportedEmployee(await download(`/timesheets/export?${query}`), employee.fullName), [777, 543, 1_320]);
    assert.deepEqual(exportedEmployee(await download(`/timesheets/overview/export?${query}`), employee.fullName), [777, 543, 1_320]);
    assert.deepEqual(await prisma.timesheetDayEntry.findMany({ where: { rowId: row.id }, orderBy: { dayOfMonth: 'asc' } }), savedEntries);
    assert.deepEqual(await prisma.objectAttendanceFact.findMany({ where: { objectId } }), savedFacts);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0, 'viewing legacy history cannot backfill the new ledger');
  });

  await t.test('missing norm cannot create a zero attendance/accrual or a misleading successful calculation', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'monthly_fixed', baseAmount: 20_000 });
    const failure = await request<{ code: string; message: string }>(`${schedule(objectId)}/attendance/confirm`, 'POST', {
      requestKey: randomUUID(), positionId: p.id, revisionId: p.revisions[0].id, groupKey: 'A', timeRangeKey: 'day', employeeId, operationDate: '2026-03-02',
    }, 409);
    assert.equal(failure.code, 'SALARY_UNAVAILABLE'); assert.ok(failure.message.trim());
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.timesheetMonth.count({ where: { objectId } }), 0);
  });

  await t.test('1500 shift overridden to 1700 plus independent 700 extra work is exactly 2400; retries do not duplicate', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    const shift = await confirm(objectId, p, '2026-03-02');
    const overrideInput = { requestKey: randomUUID(), kind: 'shift_override', operationDate: '2026-03-02', attendanceId: shift.id, expectedVersion: shift.version, amount: 1_700, reason: 'Independent contract acceptance' };
    const change = await adjustment(objectId, overrideInput);
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    await request(`/approvals/${change.approvalRequestId}/approve`, 'POST', {}, 403, 'founder');
    await request(`/approvals/${change.approvalRequestId}/approve`, 'POST', {}, 403, 'deputy');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    await request(`/approvals/${change.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_700);
    const overrideReplay = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', overrideInput, 201);
    assert.equal(overrideReplay.adjustmentId, change.adjustmentId, 'retry must resolve before validating the now-stale expectedVersion');
    const requestKey = randomUUID();
    const payload = { requestKey, kind: 'extra_work', employeeId, operationDate: '2026-03-02', amount: 700, reason: 'Additional window cleaning' };
    const extra = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201, 'manager');
    assert.equal(extra.status, 'pending');
    const replay = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201, 'manager');
    assert.equal(replay.adjustmentId, extra.adjustmentId); assert.equal(replay.approvalRequestId, extra.approvalRequestId);
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_700);
    await request(`/approvals/${extra.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201, 'manager');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 2_400);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId, status: 'confirmed' } }), 1);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 1);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId, kind: 'extra_work' } }), 1);
  });

  await t.test('extra work can be a separate 700 credit without inventing a primary paid attendance', async () => {
    const objectId = await fixture();
    const payload = { requestKey: randomUUID(), kind: 'extra_work', employeeId, operationDate: '2026-03-02',
      amount: 700, reason: 'Separate additional work; no main shift was worked' };
    const pending = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201, 'manager');
    assert.equal(pending.status, 'pending');
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await request(`${compensation(objectId)}/adjustments`, 'POST', payload, 201, 'manager');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 700);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 1);
    const original = await prisma.objectCompensationAdjustment.findUniqueOrThrow({ where: { id: pending.adjustmentId } });
    const credit = await prisma.objectPayrollCredit.findFirstOrThrow({ where: { objectId } });
    const correctionPath = `${compensation(objectId)}/adjustments/${pending.adjustmentId}/correct`;
    const correctionPayload = { requestKey: randomUUID(), expectedCreditUpdatedAt: credit.updatedAt.toISOString(),
      amount: 0, reason: 'Cancel the standalone extra earning while retaining its history' };
    const cancellation = await request<Pending>(correctionPath, 'POST', correctionPayload, 201);
    assert.equal(cancellation.status, 'pending');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 700);
    await request(`/approvals/${cancellation.approvalRequestId}/approve`, 'POST', {}, 403, 'founder');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 700);
    await request(`/approvals/${cancellation.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    const cancellationReplay = await request<Pending>(correctionPath, 'POST', correctionPayload, 201);
    assert.equal(cancellationReplay.adjustmentId, cancellation.adjustmentId);
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 0);
    assert.equal((await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount, 0);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 1);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 0);
    assert.deepEqual(await prisma.objectCompensationAdjustment.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId, kind: 'extra_work_correction' } }), 1);
  });

  await t.test('replacement remains pending, then pays 1500 under primary terms instead of both employees', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    const shift = await confirm(objectId, p, '2026-03-02');
    // Two operational confirmations in the same implicit payment contour still
    // represent one payable exit. Both must cease paying the primary on transfer.
    const duplicatePosition = await historicalPosition(objectId);
    await confirm(objectId, duplicatePosition, '2026-03-02');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    await prisma.objectEmployeeAssignment.update({ where: { objectId_employeeId: { objectId, employeeId: replacementId } },
      data: { ratePolicyType: 'daily_rate', ratePolicyBaseAmount: 9_999, ratePolicyUpdatedAt: new Date('2026-03-01T00:00:00Z') } });
    const substitution = await prisma.employeeSubstitution.create({ data: { objectId, employeeId, substituteEmployeeId: replacementId,
      startDate: new Date('2026-03-01T00:00:00Z'), endDate: new Date('2026-03-03T00:00:00Z'), status: 'active', reason: 'Acceptance replacement', createdByUserId: founder.id,
    } });
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId, employeeId: replacementId } }), 0, 'HR planning alone is not attendance');
    assert.equal(await prisma.objectShiftAttendance.count({ where: { employeeId: replacementId, status: 'confirmed',
      startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt },
    } }), 0, 'previous scenarios must not leave a globally overlapping shift for this substitute');
    const payload = { requestKey: randomUUID(), kind: 'replacement', operationDate: '2026-03-02', attendanceId: shift.id,
      expectedVersion: shift.version, replacementEmployeeId: replacementId, substitutionId: substitution.id, reason: 'Replace the paid shift' };
    const pending = await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201);
    assert.equal(pending.status, 'pending');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 403, 'founder');
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 403, 'deputy');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    await request<Pending>(`${compensation(objectId)}/adjustments`, 'POST', payload, 201);
    const paid = await amounts(objectId, '2026-03-02');
    assert.equal(paid.get(employeeId) ?? 0, 0);
    assert.equal(paid.get(replacementId), 1_500);
    assert.equal([...paid.values()].reduce((sum, amount) => sum + amount, 0), 1_500);
    const transferred = await prisma.objectShiftAttendance.findUniqueOrThrow({ where: { id: shift.id } });
    assert.equal(transferred.employeeId, replacementId); assert.equal(transferred.dailyRateSnapshot, 1_500);
    assert.deepEqual(transferred.ratePolicySnapshot, shift.ratePolicySnapshot);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 1);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId, employeeId, status: 'confirmed' } }), 0);
  });

  await t.test('first confirmation of a covered substitution uses primary terms, not the substitute 9999 rate', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    const primary = await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    await prisma.objectEmployeeAssignment.update({ where: { objectId_employeeId: { objectId, employeeId: replacementId } },
      data: { ratePolicyType: 'daily_rate', ratePolicyBaseAmount: 9_999, ratePolicyUpdatedAt: new Date('2026-03-01T00:00:00Z') } });
    const substitution = await prisma.employeeSubstitution.create({ data: { objectId, employeeId, substituteEmployeeId: replacementId,
      startDate: new Date('2026-03-01T00:00:00Z'), endDate: new Date('2026-03-03T00:00:00Z'), status: 'active', reason: 'Covered primary shift', createdByUserId: founder.id } });
    const payload = { requestKey: randomUUID(), positionId: p.id, revisionId: p.revisions[0].id, groupKey: 'A', timeRangeKey: 'day',
      employeeId, replacementEmployeeId: replacementId, substitutionId: substitution.id, operationDate: '2026-03-02' };
    const pending = await request<Pending>(`${schedule(objectId)}/attendance/confirm`, 'POST', payload, 201);
    assert.equal(pending.status, 'pending');
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    await request(`/approvals/${pending.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    const replay = await request<{ dailyRateSnapshot: number }>(`${schedule(objectId)}/attendance/confirm`, 'POST', payload, 201);
    assert.equal(replay.dailyRateSnapshot, 1_500);
    const paid = await amounts(objectId, '2026-03-02');
    assert.equal(paid.get(employeeId) ?? 0, 0); assert.equal(paid.get(replacementId), 1_500);
    assert.equal([...paid.values()].reduce((sum, amount) => sum + amount, 0), 1_500);
    const saved = await prisma.objectShiftAttendance.findFirstOrThrow({ where: { objectId } });
    assert.equal((saved.ratePolicySnapshot as { compensationVersionId: string }).compensationVersionId, primary.id);
    assert.equal(await prisma.objectShiftAttendance.count({ where: { objectId } }), 1);
  });

  await t.test('a substitution covering only the end of a shift cannot transfer the entire paid exit', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    const shift = await confirm(objectId, p, '2026-03-02');
    const substitution = await prisma.employeeSubstitution.create({ data: { objectId, employeeId, substituteEmployeeId: replacementId,
      startDate: new Date('2026-03-02T12:00:00+03:00'), endDate: new Date('2026-03-02T16:00:00+03:00'),
      status: 'active', reason: 'Only half of 08:00–16:00 shift', createdByUserId: founder.id } });
    const response = await fetch(`${baseUrl}/api/v1${compensation(objectId)}/adjustments`, { method: 'POST',
      headers: { Cookie: cookies.founder, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: randomUUID(),
        kind: 'replacement', attendanceId: shift.id, expectedVersion: shift.version, operationDate: '2026-03-02',
        replacementEmployeeId: replacementId, substitutionId: substitution.id, reason: 'Must cover the whole paid shift' }),
    });
    assert.ok([400, 409].includes(response.status), `Partial coverage must be rejected: ${response.status} ${await response.text()}`);
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_500);
    assert.equal(await prisma.objectCompensationAdjustment.count({ where: { objectId, kind: 'replacement' } }), 0);
  });

  await t.test('two pending edits of one saved version: approval conflict leaves the first result intact', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    const shift = await confirm(objectId, p, '2026-03-02');
    const base = { kind: 'shift_override', operationDate: '2026-03-02', attendanceId: shift.id, expectedVersion: shift.version };
    const a = await adjustment(objectId, { ...base, amount: 1_700 });
    const b = await adjustment(objectId, { ...base, amount: 1_900 });
    await request(`/approvals/${a.approvalRequestId}/approve`, 'POST', {}, 200, 'director');
    const before = await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } } });
    await request(`/approvals/${b.approvalRequestId}/approve`, 'POST', {}, 409, 'director');
    assert.equal((await amounts(objectId, '2026-03-02')).get(employeeId), 1_700);
    assert.deepEqual(await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } } }), before);
    assert.equal((await prisma.objectCompensationAdjustment.findUniqueOrThrow({ where: { id: b.adjustmentId } })).status, 'pending');
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: b.approvalRequestId } })).status, 'pending');
  });

  await t.test('team-fund permission differs from rate permission; funding never creates attendance or divides by headcount', async () => {
    const objectId = await fixture();
    const terms = { requestKey: randomUUID(), scope: 'defaults', effectiveFrom: today, expectedVersion: 0,
      terms: { ratePolicyType: 'daily_rate', baseAmount: 1_500 } };
    await request(`${compensation(objectId)}/versions`, 'POST', terms, 403, 'manager');
    await request(`${compensation(objectId)}/versions`, 'POST', terms, 201, 'deputy');
    const fund = { requestKey: randomUUID(), effectiveFrom: today, expectedVersion: 0, monthlyAmount: 60_000, allocations: [], reason: 'Unallocated team fund' };
    await request(`${compensation(objectId)}/team-funds`, 'POST', fund, 403, 'deputy');
    await request(`${compensation(objectId)}/team-funds`, 'POST', fund, 403, 'manager');
    await request(`${compensation(objectId)}/team-funds`, 'POST', fund, 201);
    const deputy = await request<{ capabilities: { manageRates: boolean; manageTeamFund: boolean } }>(compensation(objectId), 'GET', undefined, 200, 'deputy');
    assert.equal(deputy.capabilities.manageRates, true); assert.equal(deputy.capabilities.manageTeamFund, false);
    assert.equal(await prisma.objectPayrollCredit.count({ where: { objectId } }), 0);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0);
    assert.equal(await prisma.timesheetMonth.count({ where: { objectId } }), 0);
  });

  await t.test('effective date, concurrent version requests, retry identity and cancellation keep historical facts stable', async () => {
    const objectId = await fixture(); const p = await historicalPosition(objectId);
    const old = await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 1_500 });
    await storedTerms(objectId, { ratePolicyType: 'daily_rate', baseAmount: 2_500 }, '2026-03-16', 2);
    const later = await confirm(objectId, p, '2026-03-16');
    const lateRecorded = await confirm(objectId, p, '2026-03-02');
    assert.equal(later.dailyRateSnapshot, 2_500); assert.equal(lateRecorded.dailyRateSnapshot, 1_500);
    assert.equal((lateRecorded.ratePolicySnapshot as { compensationVersionId: string }).compensationVersionId, old.id);
    const input = { requestKey: randomUUID(), scope: 'defaults', effectiveFrom: nextDay(today), expectedVersion: 2,
      terms: { ratePolicyType: 'daily_rate', baseAmount: 3_000 } };
    const path = `${compensation(objectId)}/versions`;
    const [a, b] = await Promise.all([
      request<{ version: { id: string } }>(path, 'POST', input, 201),
      request<{ version: { id: string } }>(path, 'POST', input, 201),
    ]);
    assert.equal(a.version.id, b.version.id);
    await request(path, 'POST', { ...input, terms: { ...input.terms, baseAmount: 3_001 } }, 409);
    await request(path, 'POST', { ...input, requestKey: randomUUID(), effectiveFrom: '2026-03-01' }, 409);
    const competing = (amount: number) => fetch(`${baseUrl}/api/v1${path}`, { method: 'POST', headers: { Cookie: cookies.founder, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, requestKey: randomUUID(), effectiveFrom: nextDay(nextDay(today)), expectedVersion: 3, terms: { ...input.terms, baseAmount: amount } }) });
    const race = await Promise.all([competing(4_000), competing(5_000)]);
    assert.deepEqual(race.map(response => response.status).sort(), [201, 409]);
    await request(`${path}/${a.version.id}/cancel`, 'POST', { expectedVersion: 3, reason: 'Cancel future conditions' }, 201);
    assert.equal(await prisma.objectCompensationVersion.count({ where: { objectId } }), 4);
    assert.deepEqual(await prisma.objectShiftAttendance.findUniqueOrThrow({ where: { id: lateRecorded.id } }), lateRecorded);
  });
});
