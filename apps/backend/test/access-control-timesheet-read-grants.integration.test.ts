import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { PrismaClient } from '@prisma/client';

import type { TimesheetResponseDto } from '../src/modules/timesheets/dto/timesheet-response.dto';
import type { TimesheetOverviewResponseDto } from '../src/modules/timesheets/dto/timesheet-overview-response.dto';
import type { TimesheetCorrectionItemDto } from '../src/modules/timesheets/dto/timesheet-correction-item.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Inspect real worksheet entries, without treating a ZIP signature as ACL proof.
// This deliberately supports the existing bounded, non-streaming XLSX writer.
function worksheetXml(buffer: Buffer): string {
  const sheets: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 6) & 8, 0, 'Unexpected streaming ZIP descriptor');
    const method = buffer.readUInt16LE(offset + 8);
    const length = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    assert.ok(start + length <= buffer.length);
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      assert.ok(method === 0 || method === 8);
      const data = buffer.subarray(start, start + length);
      sheets.push((method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    }
    offset = start + length;
  }
  assert.ok(sheets.length > 0, 'Response must contain real worksheet XML');
  return sheets.join('\n');
}

test('timesheet read grants scope real sheets, overview, XLSX and histories without bypassing independent boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definitions = ACCESS_ACTION_CATALOG.filter(({ module }) => module === 'timesheet');
  assert.deepEqual(definitions.map(({ code }) => code).sort(), [
    'access', 'read', 'overview', 'export', 'attendance.edit', 'amount.edit', 'manual_correction', 'exceptions.create', 'corrections.read',
  ].map((suffix) => `timesheet.${suffix}`).sort());
  const aliases = ['timesheet.attendance.edit', 'timesheet.manual_correction'];
  for (const definition of definitions) {
    assert.deepEqual(definition.allowedScopes, ['own', 'assigned', 'selected', 'all']);
    assert.equal(definition.manageable, !aliases.includes(definition.code));
    if (aliases.includes(definition.code)) assert.equal(definition.constraint, 'unsupported_standalone_operation');
  }
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds = new Set<string>();
  const reset = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await reset(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `timesheet-read-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const employee = await prisma.employee.create({ data: { fullName: `${marker}-employee`, employmentStatus: 'active' } });
  const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const current = { year: moscow.getUTCFullYear(), month: moscow.getUTCMonth() + 1, dayOfMonth: moscow.getUTCDate() };
  const historical = { year: current.year - 1, month: 2 };
  const fixtures = await Promise.all(['assigned-A', 'assigned-B', 'owned', 'foreign-A', 'foreign-B'].map(async (label, index) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated read fixture', status: 'active', paymentType: 'daily', dailyRate: 0,
      createdByUserId: label === 'owned' ? actor.id : founder.id,
      ...(label.startsWith('assigned') ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
    } });
    const amount = 1501 + index;
    const monthIds: string[] = [];
    for (const period of [historical, current]) {
      const month = await prisma.timesheetMonth.create({ data: { objectId: object.id, year: period.year, month: period.month, createdByUserId: founder.id } });
      monthIds.push(month.id);
      const row = await prisma.timesheetEmployeeRow.create({ data: { timesheetMonthId: month.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName } });
      const isHistorical = period === historical;
      await prisma.timesheetDayEntry.create({ data: {
        rowId: row.id, dayOfMonth: isHistorical ? 1 : current.dayOfMonth,
        autoValue: 0, dayValue: isHistorical ? amount : 0, manualValue: isHistorical ? amount : null,
        difference: isHistorical ? amount : 0, isChangedManually: isHistorical,
        comment: isHistorical ? `${marker}-${label}-saved-reason` : null,
        calculationExplanation: isHistorical ? `${marker}-${label}-saved-calculation` : null,
        createdByUserId: founder.id, updatedByUserId: founder.id,
      } });
    }
    await prisma.objectPayrollCredit.create({ data: {
      objectId: object.id, employeeId: employee.id, operationDate: new Date(`${historical.year}-02-01T00:00:00Z`),
      sourceKey: `read-fixture:${marker}:${index}`, amount, explanation: `${marker}-${label}-credit`, createdByUserId: founder.id,
      policySnapshot: {
        ratePolicyType: 'daily_rate', baseAmount: amount, scheduleCode: null,
        roundingMode: 'none', roundingStep: null, standardShiftHours: 8,
        workingDaysInMonth: null, excludedHolidayDays: null, notes: 'Saved daily-rate read fixture',
      },
    } });
    return { ...object, label, amount, monthIds };
  }));
  const [a, b, owned, foreignA, foreignB] = fixtures;
  const objectIds = fixtures.map(({ id }) => id);
  const periodQuery = (objectId?: string, period = historical) => new URLSearchParams({
    year: String(period.year), month: String(period.month), ...(objectId ? { objectId } : {}),
  }).toString();
  const request = (path: string, body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    assert.equal(response.status, expected, await response.clone().text());
    return await response.json() as T;
  };
  type Scope = 'own' | 'assigned' | 'selected' | 'all';
  const rule = async (actionCode: string, effect: 'allow' | 'deny', scope: Scope = 'all', selectedIds: string[] = []) => {
    assert.ok(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)?.allowedScopes.includes(scope));
    const saved = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
    ruleIds.add(saved.id);
    return saved;
  };
  const revoke = async (actionCode: string) => {
    const saved = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    ruleIds.delete(saved.id);
  };
  const capture = async () => ({
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    months: await prisma.timesheetMonth.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    rows: await prisma.timesheetEmployeeRow.findMany({ where: { timesheetMonth: { objectId: { in: objectIds } } }, orderBy: { id: 'asc' } }),
    entries: await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId: { in: objectIds } } } }, orderBy: { id: 'asc' } }),
    attendance: await prisma.objectAttendanceFact.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    credits: await prisma.objectPayrollCredit.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    staffing: await prisma.objectEmployeeAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    exceptions: await prisma.timesheetManualException.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { createdByUserId: actor.id }, orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  });
  const denied = async (path: string, body?: unknown, expected = 403) => {
    const before = await capture();
    const response = await request(path, body);
    assert.equal(response.status, expected, await response.text());
    assert.deepEqual(await capture(), before, 'Rejected read/export/write must not create/backfill money, attendance, months, exceptions or audit');
  };
  const read = async (target: typeof a, period = historical) => {
    const sheet = await json<TimesheetResponseDto>(await request(`/timesheets?${periodQuery(target.id, period)}`));
    assert.equal(sheet.objectId, target.id);
    assert.equal(sheet.objectName, target.name);
    const row = sheet.rows.find(({ employeeId }) => employeeId === employee.id)!;
    assert.ok(row);
    if (period === historical) {
      assert.equal(row.rowTotal, target.amount);
      assert.equal(row.entries.find(({ dayOfMonth }) => dayOfMonth === 1)!.finalValue, target.amount);
    }
    return sheet;
  };
  const overview = async (expectedIds: string[]) => {
    const result = await json<TimesheetOverviewResponseDto>(await request(`/timesheets/overview?${periodQuery()}&employeeId=${employee.id}`));
    assert.deepEqual(result.rows.map(({ objectId }) => objectId).sort(), [...expectedIds].sort());
    assert.equal(result.totals.monthTotal, fixtures.filter(({ id }) => expectedIds.includes(id)).reduce((sum, { amount }) => sum + amount, 0));
    for (const row of result.rows) assert.equal(row.monthTotal, fixtures.find(({ id }) => id === row.objectId)!.amount);
    return result;
  };
  const references = async (expectedIds: string[]) => {
    const items = await json<Array<{ id: string; name: string }>>(await request(`/timesheets/overview/references/objects?q=${encodeURIComponent(marker)}`));
    assert.deepEqual(items.map(({ id }) => id).sort(), [...expectedIds].sort());
  };
  const exported = async (path: string, expectedIds: string[]) => {
    const response = await request(path);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
    assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="timesheet/);
    const xml = worksheetXml(Buffer.from(await response.arrayBuffer()));
    for (const target of fixtures) assert.equal(xml.includes(target.name), expectedIds.includes(target.id), `Export scope for ${target.label}`);
    if (expectedIds.length) assert.ok(xml.includes(employee.fullName));
    return xml;
  };
  const overviewExport = (ids: string[]) => exported(`/timesheets/overview/export?${periodQuery()}&employeeId=${employee.id}`, ids);
  const baseline = [a.id, b.id];

  for (const scope of ['own', 'assigned', 'selected', 'all'] as const) await t.test(`timesheet.read ${scope}: real object contexts, additive baseline, deny and old-cookie revoke`, async (suite) => {
    suite.after(reset);
    const before = await capture();
    await references(baseline);
    await denied(`/timesheets?${periodQuery(owned.id)}`); // Creator is not a baseline timesheet manager assignment.
    await denied(`/timesheets?${periodQuery(foreignA.id)}`);
    const addition = scope === 'own' ? [owned.id] : scope === 'selected' ? [foreignA.id] : scope === 'all' ? objectIds : [];
    const expected = [...new Set([...baseline, ...addition])];
    await rule('timesheet.read', 'allow', scope, scope === 'selected' ? [foreignA.id] : []);
    await references(expected);
    for (const target of fixtures) {
      if (expected.includes(target.id)) await read(target);
      else await denied(`/timesheets?${periodQuery(target.id)}`);
    }
    await overview(baseline); // Read alone must not grant the independent overview leaf on foreign targets.
    await rule('timesheet.overview', 'allow', scope, scope === 'selected' ? [foreignA.id] : []);
    await overview(expected);
    await rule('timesheet.read', 'deny', scope, scope === 'selected' ? [a.id] : []);
    const retained = scope === 'own' || scope === 'selected' ? scope === 'selected' ? [b.id] : baseline : [];
    await references(retained);
    await overview(retained);
    await revoke('timesheet.read');
    await references(baseline);
    await overview(baseline);
    assert.deepEqual(await capture(), before);
  });

  await t.test('timesheet.access selected/all deny subtracts sheet, overview, reference, corrections and export without opening foreign scope', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('timesheet.access', 'allow');
    await denied(`/timesheets?${periodQuery(foreignA.id)}`);
    await rule('timesheet.access', 'deny', 'selected', [a.id]);
    await denied(`/timesheets?${periodQuery(a.id)}`);
    await denied(`/timesheets/corrections?${periodQuery(a.id)}`);
    await denied(`/timesheets/export?${periodQuery(a.id)}`);
    await overview([b.id]); await references([b.id]); await overviewExport([b.id]);
    await read(b);
    await rule('timesheet.access', 'deny');
    await overview([]); await references([]); await overviewExport([]);
    await denied(`/timesheets?${periodQuery(b.id)}`);
    await revoke('timesheet.access');
    await overview(baseline); await read(a);
    assert.deepEqual(await capture(), before);
  });

  await t.test('timesheet.overview grant/deny/revoke is separate from object sheet/export and cannot bypass read denial', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('timesheet.read', 'allow', 'selected', [foreignA.id, foreignB.id]);
    await read(foreignA); await overview(baseline);
    await rule('timesheet.overview', 'allow', 'selected', [foreignA.id]);
    await overview([...baseline, foreignA.id]);
    await rule('timesheet.overview', 'deny', 'selected', [a.id]);
    await overview([b.id]); await read(a);
    await exported(`/timesheets/export?${periodQuery(a.id)}`, [a.id]);
    await rule('timesheet.overview', 'deny');
    await overview([]); await read(b);
    await revoke('timesheet.overview');
    await overview(baseline);
    await rule('timesheet.overview', 'allow');
    await rule('timesheet.read', 'deny', 'selected', [a.id]);
    await overview([b.id]);
    await revoke('timesheet.read');
    await overview(baseline);
    assert.deepEqual(await capture(), before);
  });

  await t.test('timesheet.export scopes actual XLSX rows independently; own/assigned/selected/all and read/parent denials are intersected', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('timesheet.read', 'allow');
    for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
      await rule('timesheet.export', 'allow', scope, scope === 'selected' ? [foreignA.id] : []);
      const expected = [...new Set([...baseline, ...(scope === 'own' ? [owned.id] : scope === 'selected' ? [foreignA.id] : scope === 'all' ? objectIds : [])])];
      await overviewExport(expected);
    }
    await rule('timesheet.export', 'deny', 'selected', [a.id]);
    await denied(`/timesheets/export?${periodQuery(a.id)}`);
    const exportCapability = async (objectId?: string) => {
      const view = await json<{ capabilities: { canExport: boolean } }>(await request(`/timesheets/overview?${periodQuery(objectId)}`));
      return view.capabilities.canExport;
    };
    assert.equal(await exportCapability(a.id), false, 'Selected export deny must disable A, not read its details as authority');
    assert.equal(await exportCapability(b.id), true, 'Independent control B retains export');
    await overviewExport([b.id]); await read(a);
    await revoke('timesheet.export');
    await overviewExport(baseline);
    await rule('timesheet.export', 'allow');
    for (const code of ['timesheet.read', 'objects.read', 'objects.access']) {
      await rule(code, 'deny', 'selected', [a.id]);
      await denied(`/timesheets/export?${periodQuery(a.id)}`);
      await overviewExport(code === 'timesheet.read' ? [b.id] : objectIds.filter((id) => id !== a.id));
      await revoke(code);
      if (code === 'timesheet.read') await rule('timesheet.read', 'allow');
    }
    await rule('timesheet.export', 'deny');
    await denied(`/timesheets/export?${periodQuery(b.id)}`);
    await overviewExport([]);
    assert.equal(await exportCapability(), false, 'An all-deny never advertises an export, including an empty selection');
    assert.deepEqual(await capture(), before);
  });

  await t.test('timesheet.corrections.read gates saved reasons independently and never backfills missing months', async (suite) => {
    suite.after(reset);
    const before = await capture();
    await rule('timesheet.read', 'allow', 'selected', [foreignA.id, foreignB.id]);
    await denied(`/timesheets/corrections?${periodQuery(foreignA.id)}`);
    await rule('timesheet.corrections.read', 'allow', 'selected', [foreignA.id]);
    const corrections = await json<TimesheetCorrectionItemDto[]>(await request(`/timesheets/corrections?${periodQuery(foreignA.id)}`));
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0]!.employeeId, employee.id);
    assert.equal(corrections[0]!.dayValue, foreignA.amount);
    assert.equal(corrections[0]!.comment, `${marker}-${foreignA.label}-saved-reason`);
    assert.equal(corrections[0]!.hasFact, false);
    assert.equal(corrections[0]!.updatedByUserId, founder.id);
    await denied(`/timesheets/corrections?${periodQuery(foreignB.id)}`);
    await revoke('timesheet.corrections.read');
    await denied(`/timesheets/corrections?${periodQuery(foreignA.id)}`);
    await rule('timesheet.corrections.read', 'deny', 'selected', [a.id]);
    await denied(`/timesheets/corrections?${periodQuery(a.id)}`); await read(a);
    await json(await request(`/timesheets/corrections?${periodQuery(b.id)}`));
    await revoke('timesheet.corrections.read');
    const missing = { year: historical.year, month: 3 };
    assert.deepEqual(await json(await request(`/timesheets/corrections?${periodQuery(a.id, missing)}`)), []);
    await json(await request(`/timesheets?${periodQuery(a.id, missing)}`));
    await json(await request(`/timesheets/overview?${periodQuery(a.id, missing)}&employeeId=${employee.id}`));
    assert.deepEqual(await capture(), before, 'All read surfaces must preserve absent container and historical entries');
  });

  await t.test('timesheet grants are not compensation breakdown grants; rate/budget/object denies retain control B', async (suite) => {
    suite.after(reset);
    const before = await capture();
    const explanation = (id: string) => `/objects/${id}/scheduling/compensation/explanation?${periodQuery()}&employeeId=${employee.id}`;
    await rule('timesheet.read', 'allow');
    await rule('timesheet.overview', 'allow');
    await rule('timesheet.export', 'allow');
    await read(foreignA);
    await denied(explanation(foreignA.id));
    const result = await json<{ rows: Array<{ employeeId: string; advanceTotal: number; entries: Array<{ amount: number }> }> }>(await request(explanation(a.id)));
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]!.employeeId, employee.id);
    assert.equal(result.rows[0]!.advanceTotal, a.amount);
    for (const code of ['objects.rates.read', 'objects.budget.read', 'objects.read', 'objects.access']) {
      await rule(code, 'deny', 'selected', [a.id]);
      await denied(explanation(a.id));
      await json(await request(explanation(b.id)));
      await revoke(code);
    }
    await rule('employees.view', 'deny', 'selected', [employee.id]);
    const hidden = await json<{ rows: unknown[] }>(await request(explanation(a.id)));
    assert.deepEqual(hidden.rows, []);
    assert.deepEqual(await capture(), before);
  });

  await t.test('unsupported attendance/manual aliases cannot grant a second money operation; persisted manual deny remains negative compatibility', async (suite) => {
    suite.after(reset);
    const before = await capture();
    for (const actionCode of aliases) {
      const body = { expectedVersion: actor.accessVersion, reason: 'Unsupported aliases stay constrained', changes: [{ actionCode, effect: 'allow', scope: 'all' }] };
      const response = await request(`/users-access/admin/users/${actor.id}/preview`, body, founderCookie);
      assert.equal(response.status, 400, await response.text());
      await rule(actionCode, 'allow'); // Deliberately persisted old data, not an admin-supported grant.
      assert.equal((await read(a, current)).capabilities.canManualCorrection, false);
      await denied('/timesheets/entries', { objectId: a.id, employeeId: employee.id, ...current, dayValue: 2000, comment: marker });
      await revoke(actionCode);
    }
    await rule('timesheet.amount.edit', 'allow', 'selected', [a.id]);
    assert.equal((await read(a, current)).capabilities.canManualCorrection, true);
    await rule('timesheet.manual_correction', 'deny', 'selected', [a.id]);
    assert.equal((await read(a, current)).capabilities.canManualCorrection, false);
    await denied('/timesheets/entries', { objectId: a.id, employeeId: employee.id, ...current, dayValue: 2000, comment: marker });
    await revoke('timesheet.manual_correction');
    assert.equal((await read(a, current)).capabilities.canManualCorrection, true);
    assert.deepEqual(await capture(), before);
  });

  await t.test('timesheet.exceptions.create remains a pending request, not direct money; closed period still readable/exportable but immutable', async (suite) => {
    suite.after(reset);
    await rule('timesheet.read', 'allow', 'selected', [foreignA.id, foreignB.id]);
    const body = { objectId: foreignA.id, employeeId: employee.id, ...current, dayValue: 2789, comment: `${marker}-exception` };
    await denied('/timesheets/exceptions', body);
    await rule('timesheet.exceptions.create', 'allow', 'selected', [foreignA.id]);
    await denied('/timesheets/exceptions', { ...body, objectId: foreignB.id });
    await denied('/timesheets/entries', body);
    const before = await capture();
    const pending = await json<{ id: string; status: string; sourceEntityId: string; approvalType: string }>(await request('/timesheets/exceptions', body), 201);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.approvalType, 'manual_timesheet_exception_confirmation');
    const after = await capture();
    const added = after.exceptions.filter((row) => !before.exceptions.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0]!.id, pending.sourceEntityId);
    assert.equal(added[0]!.requestedByUserId, actor.id);
    assert.equal(added[0]!.requestedDayValue, body.dayValue);
    assert.equal(after.approvals.length, before.approvals.length + 1);
    assert.equal(after.audit.length, before.audit.length + 1);
    for (const key of ['objects', 'assignments', 'months', 'rows', 'entries', 'attendance', 'credits', 'staffing'] as const) assert.deepEqual(after[key], before[key]);
    await rule('timesheet.exceptions.create', 'deny', 'selected', [foreignA.id]);
    await denied('/timesheets/exceptions', body); // Deny wins before duplicate-pending conflict.
    await revoke('timesheet.exceptions.create');
    await denied('/timesheets/exceptions', body);
    await reset();
    await rule('timesheet.amount.edit', 'allow');
    await rule('timesheet.exceptions.create', 'allow');
    const closed = await prisma.timesheetMonth.findUniqueOrThrow({ where: { objectId_year_month: { objectId: b.id, year: current.year, month: current.month } } });
    await prisma.timesheetMonth.update({ where: { id: closed.id }, data: { status: 'closed' } });
    try {
      const sheet = await read(b, current);
      assert.equal(sheet.status, 'closed');
      assert.equal(sheet.capabilities.canManualCorrection, false);
      assert.deepEqual(sheet.rows[0]!.capabilities, { canManualCorrection: false, canRequestCorrection: false });
      await denied('/timesheets/entries', { ...body, objectId: b.id });
      await denied('/timesheets/exceptions', { ...body, objectId: b.id }, 409);
      const beforeExport = await capture();
      await exported(`/timesheets/export?${periodQuery(b.id, current)}`, [b.id]);
      assert.deepEqual(await capture(), beforeExport);
    } finally { await prisma.timesheetMonth.update({ where: { id: closed.id }, data: { status: closed.status } }); }
  });
  assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId: { in: objectIds } } }), 0);
  assert.deepEqual((await prisma.userRole.findMany({ where: { userId: actor.id }, include: { role: true } })).map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userPermission.count({ where: { userId: actor.id } }), 0);
  // Main owns execution. No successful amount edit, attendance mutation, approval
  // application, complete Excel application/formula QA or browser/admin-save proof.
});
