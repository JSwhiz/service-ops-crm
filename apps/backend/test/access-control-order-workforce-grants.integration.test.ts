import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { Prisma, PrismaClient } from '@prisma/client';

import type {
  OneTimeOrderAttendanceCoverageResponse,
  OneTimeOrderAttendanceResponse,
  OneTimeOrderTimesheetResponse,
  OneTimeOrderWorkforceEmployee,
} from '../src/modules/one-time-orders/one-time-order-workforce.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Main sequential isolated runner only. No live/server DB, uploads or transfers.
// Supported subset: employees.read/manage/payment.edit, attendance.read/edit,
// timesheet.read/export, payouts.read, escorts.manage (one_time_orders prefix).
// Scope matrix is selected/all; own/assigned rule variants, concurrency, closed
// order/cycle rollover, reconciliation/reversal and broad payroll remain gaps.
type WorkforceRow = {
  id: string; oneTimeOrderId: string; employeeId: string; workCycle: number;
  isActive: boolean; orderPayment: Prisma.Decimal | null; createdByUserId: string;
  removedByUserId: string | null; assignedAt: Date; removedAt: Date | null;
};
type DayRow = {
  id: string; oneTimeOrderId: string; employeeId: string; workCycle: number;
  attendancePresent: boolean; rateSnapshot: Prisma.Decimal; finalValue: Prisma.Decimal;
  automaticValue: Prisma.Decimal; updatedByUserId: string; manualOverride: boolean;
};
type Submission = { id: string; oneTimeOrderId: string; operationDate: Date; submittedByUserId: string };
type Escort = { id: string; version: number; escortUserId: string; employees: Array<{ employeeId: string }> };

// Read the tiny HTTP workbook itself; no filesystem or office process involved.
function worksheet(buffer: Buffer, name: string): string {
  assert.ok(buffer.length < 1_000_000);
  for (let offset = 0; offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50;) {
    const flags = buffer.readUInt16LE(offset + 6);
    assert.equal(flags & 8, 0, 'Bounded workbook has known local entry sizes');
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const path = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + size);
    if (path === name) {
      assert.ok(method === 0 || method === 8);
      return (method === 8 ? inflateRawSync(data, { maxOutputLength: 1_000_000 }) : data).toString('utf8');
    }
    offset = start + size;
  }
  assert.fail(`Missing worksheet ${name}`);
}

test('order workforce grants preserve scope, live revocation, attendance history and independent payout approval', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  for (const suffix of ['employees.read', 'employees.manage', 'employees.payment.edit', 'attendance.read', 'attendance.edit', 'timesheet.read', 'timesheet.export', 'payouts.read', 'escorts.manage']) {
    const action = ACCESS_ACTION_CATALOG.find((entry) => entry.code === `one_time_orders.${suffix}`);
    assert.ok(action?.manageable, suffix);
    for (const scope of ['selected', 'all'] as const) assert.ok(action.allowedScopes.includes(scope), suffix);
  }
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `acl-order-workforce-${randomUUID()}`;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const datePart = (type: string) => parts.find((part) => part.type === type)!.value;
  const date = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  const month = date.slice(0, 7);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const userFixture = async (label: string, roleCode: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    return prisma.user.create({ data: { login: `${marker}-${label}`, fullName: `${marker} ${label}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } } } });
  };
  const manager = await userFixture('assigned', 'manager');
  const delegate = await userFixture('delegate', 'operation_manager');
  const foreign = await userFixture('foreign-account', 'manager');
  const userIds = [manager.id, delegate.id, foreign.id];
  const identities = () => prisma.user.findMany({ where: { id: { in: userIds } }, include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
  const delegateCookie = await loginAndGetCookieHeader({ baseUrl, login: delegate.login, password: 'manager123' });
  const foreignCookie = await loginAndGetCookieHeader({ baseUrl, login: foreign.login, password: 'manager123' });
  // Every request below reuses these original cookies after personal-rule writes.
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: 'selected' | 'all', selectedIds: string[] = [], userId = manager.id, module = 'one_time_orders') => {
    assert.ok(userIds.includes(userId));
    const actionCode = `${module}.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (suffix: string, userId = manager.id, module = 'one_time_orders') => prisma.userAccessRule.deleteMany({ where: { userId, actionCode: `${module}.${suffix}` } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: userIds } } });
  const employee = await prisma.employee.create({ data: { fullName: `${marker}-cleaner`, employmentStatus: 'active', employeeType: 'one_time', baseDailyRate: 700 } });
  const spare = await prisma.employee.create({ data: { fullName: `${marker}-spare`, employmentStatus: 'active', employeeType: 'one_time', baseDailyRate: 900 } });
  const object = await prisma.object.create({ data: { name: marker, address: 'Isolated linked object', status: 'active', createdByUserId: founder.id } });
  const orders: Array<{ id: string }> = [];
  for (const label of ['A', 'B']) {
    // No scheduled date: manager conflict scheduling is outside this workforce test.
    orders.push(await json<{ id: string }>(await request('/one-time-orders', 'POST', {
      title: `${marker}-${label}`, executionAddress: 'Isolated test address', contactName: 'Synthetic client', status: 'in_progress',
      plannedPaymentMethod: 'cash', agreedSum: 0, linkedObjectId: object.id, managerUserIds: [manager.id, foreign.id],
    }, founderCookie), 201));
  }
  const [a, b] = orders;
  const orderIds = orders.map((order) => order.id);
  const root = (id: string) => `/one-time-orders/${id}`;
  const workforce = (id: string) => `${root(id)}/workforce`;
  const sheetPath = (id: string) => `${workforce(id)}/timesheet?month=${month}&workCycle=1`;
  for (const order of orders) {
    await json(await request(`${workforce(order.id)}/employees`, 'POST', { employeeId: employee.id }), 201);
    await json(await request(`${workforce(order.id)}/attendance/today`, 'POST', { operationDate: date, employeeIds: [employee.id] }), 201);
  }
  for (const userId of [manager.id, foreign.id]) await prisma.accountabilityAccount.create({ data: { userId, status: 'active' } });
  const snapshot = async () => {
    const expenses = await prisma.accountabilityExpense.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } });
    const expenseIds = expenses.map((entry) => entry.id);
    const [storedOrders, users, employees, assignments, team, days, submissions, escorts, audits, accounts, funding, approvals, objectState] = await Promise.all([
      prisma.oneTimeOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: 'asc' } }),
      identities(),
      prisma.employee.findMany({ where: { id: { in: [employee.id, spare.id] } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } }),
      prisma.$queryRaw<WorkforceRow[]>`SELECT * FROM "one_time_order_employee_assignments" WHERE "oneTimeOrderId" IN (${Prisma.join(orderIds)}) ORDER BY "id"`,
      prisma.$queryRaw<DayRow[]>`SELECT * FROM "one_time_order_timesheet_day_entries" WHERE "oneTimeOrderId" IN (${Prisma.join(orderIds)}) ORDER BY "id"`,
      prisma.$queryRaw<Submission[]>`SELECT * FROM "one_time_order_attendance_submissions" WHERE "oneTimeOrderId" IN (${Prisma.join(orderIds)}) ORDER BY "id"`,
      prisma.oneTimeOrderEscortList.findMany({ where: { oneTimeOrderId: { in: orderIds } }, include: { employees: { orderBy: [{ listId: 'asc' }, { employeeId: 'asc' }] } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { OR: [{ entityId: { in: [...orderIds, ...expenseIds] } }, { actorUserId: { in: userIds } }] }, orderBy: { id: 'asc' } }),
      prisma.accountabilityAccount.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ where: { OR: [{ oneTimeOrderId: { in: orderIds } }, { accountabilityAccount: { userId: { in: userIds } } }] }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ where: { OR: [{ createdByUserId: { in: userIds } }, { sourceEntityId: { in: [...orderIds, ...expenseIds] } }] }, orderBy: { id: 'asc' } }),
      prisma.object.findUniqueOrThrow({ where: { id: object.id } }),
    ]);
    return { orders: storedOrders, users, employees, assignments, team, days, submissions, escorts, audits, accounts, funding, approvals, objectState, expenses };
  };
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const rejected = async (path: string, method = 'GET', body?: unknown, status = 403, session = cookie) => {
    const before = await snapshot();
    const subjectId = session === delegateCookie ? delegate.id : session === foreignCookie ? foreign.id : session === founderCookie ? founder.id : manager.id;
    const activeRules = await prisma.userAccessRule.findMany({ where: { userId: subjectId },
      select: { actionCode: true, effect: true, scope: true, selectedIds: true }, orderBy: { actionCode: 'asc' } });
    const response = await request(path, method, body, session);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: no mutation/audit/money effect on rejection; expected=${status}, subject=${subjectId}, rules=${JSON.stringify(activeRules)} (${response.status}: ${text})`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
  };
  const unchanged = (before: Snapshot, after: Snapshot, except: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) if (!except.includes(key)) assert.deepEqual(after[key], before[key], key);
  };
  const audit = async (before: Snapshot, id: string, action: string, userId: string) => {
    const added = (await snapshot()).audits.filter((entry) => !before.audits.some((old) => old.id === entry.id));
    assert.equal(added.length, 1, action);
    assert.equal(added[0]!.entityId, id);
    assert.equal(added[0]!.action, action);
    assert.equal(added[0]!.actorUserId, userId);
    return added[0]!;
  };
  const sheet = (id: string, session = cookie) => request(sheetPath(id), 'GET', undefined, session).then((response) => json<OneTimeOrderTimesheetResponse>(response));
  const restoreWorkforce = async () => {
    // Restore only these synthetic fixtures through the authorized HTTP path,
    // even when an earlier assertion failed. Never hide that original failure;
    // keep it from changing what later payout/escort tests are actually testing.
    for (const order of orders) {
      const state = await snapshot();
      if (state.team.some((row) => row.oneTimeOrderId === order.id && row.employeeId === spare.id && row.isActive)) {
        await json(await request(`${workforce(order.id)}/employees/${spare.id}`, 'DELETE', undefined, founderCookie));
      }
      if (!state.days.find((row) => row.oneTimeOrderId === order.id && row.employeeId === employee.id)?.attendancePresent) {
        await json(await request(`${workforce(order.id)}/attendance/today`, 'POST', {
          operationDate: date, employeeIds: [employee.id], correctionReason: 'Restore synthetic fixture after bounded scenario',
        }, founderCookie), 201);
      }
    }
  };

  for (const leaf of ['employees.read', 'attendance.read', 'timesheet.read', 'timesheet.export'] as const) {
    await t.test(`${leaf}: selected/all deny and additive allow respect read/root parents without writes`, async () => {
      try {
        const paths = (id: string) => leaf === 'employees.read' ? [`${workforce(id)}/employees`, `${root(id)}/escorts?date=${date}`]
          : leaf === 'attendance.read' ? [`${workforce(id)}/attendance/today?date=${date}`, `${workforce(id)}/attendance/coverage`]
          : leaf === 'timesheet.read' ? [sheetPath(id)] : [`${workforce(id)}/timesheet/export.xlsx?month=${month}&workCycle=1`];
        const readable = async (id: string) => {
          const before = await snapshot();
          for (const path of paths(id)) {
            const response = await request(path);
            if (leaf === 'timesheet.export') {
              assert.equal(response.status, 200, await response.clone().text());
              assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/);
              const buffer = Buffer.from(await response.arrayBuffer());
              const xml = worksheet(buffer, 'xl/worksheets/sheet1.xml');
              assert.ok(xml.includes(employee.fullName));
              assert.ok(xml.includes(date));
              assert.ok(xml.includes('<v>700</v>'));
              assert.ok(worksheet(buffer, 'xl/worksheets/sheet2.xml').includes(employee.fullName));
            } else if (leaf === 'employees.read') {
              if (path.includes('/escorts')) await json(response);
              else assert.deepEqual((await json<OneTimeOrderWorkforceEmployee[]>(response)).filter((row) => row.isActive).map((row) => row.employeeId), [employee.id]);
            } else if (leaf === 'attendance.read') {
              if (path.includes('/coverage')) assert.equal((await json<OneTimeOrderAttendanceCoverageResponse>(response)).workCycle, 1);
              else {
                const body = await json<OneTimeOrderAttendanceResponse>(response);
                assert.equal(body.operationDate, date);
                assert.equal(body.employees.find((row) => row.employeeId === employee.id)?.present, true);
              }
            } else {
              const body = await json<OneTimeOrderTimesheetResponse>(response);
              assert.equal(body.oneTimeOrderId, id);
              assert.equal(body.rows.find((row) => row.employeeId === employee.id)?.total, 700);
            }
          }
          assert.deepEqual(await snapshot(), before);
        };
        await readable(a.id);
        await rule(leaf, 'allow', 'selected', [a.id]);
        await readable(a.id);
        await readable(b.id); // Selected allow adds to existing assignment access.
        await rule(leaf, 'deny', 'selected', [a.id]);
        for (const path of paths(a.id)) await rejected(path);
        await readable(b.id);
        await revoke(leaf);
        await readable(a.id);
        await rule(leaf, 'deny', 'all');
        for (const order of orders) for (const path of paths(order.id)) await rejected(path);
        await rule(leaf, 'allow', 'all');
        for (const parent of ['read', 'access']) {
          await rule(parent, 'deny', 'selected', [a.id]);
          for (const path of paths(a.id)) await rejected(path);
          await readable(b.id);
          await revoke(parent);
        }
        await readable(a.id);
        if (leaf === 'timesheet.export') {
          await rule('timesheet.read', 'deny', 'selected', [a.id]);
          for (const path of paths(a.id)) await rejected(path);
        }
      } finally { await reset(); }
    });
  }

  for (const leaf of ['employees.manage', 'employees.payment.edit', 'attendance.edit'] as const) {
    await t.test(`${leaf}: real selected grant adds writes without role/object access; revoke and parent denies precede persistence`, async () => {
      try {
        await rule('read', 'allow', 'all', [], delegate.id);
        const attempt = async (id: string, allowed: boolean, session = delegateCookie) => {
          const before = await snapshot();
          const previous = before.team.find((row) => row.oneTimeOrderId === id && row.employeeId === spare.id);
          const present = before.days.find((row) => row.oneTimeOrderId === id && row.employeeId === employee.id)!.attendancePresent;
          const remove = leaf === 'employees.manage' && previous?.isActive;
          const amount = Number(before.team.find((row) => row.oneTimeOrderId === id && row.employeeId === employee.id)!.orderPayment ?? 0) + 13;
          const path = leaf === 'employees.manage' ? `${workforce(id)}/employees${remove ? `/${spare.id}` : ''}`
            : leaf === 'employees.payment.edit' ? `${workforce(id)}/employees/${employee.id}/payment` : `${workforce(id)}/attendance/today`;
          const method = leaf === 'employees.payment.edit' ? 'PATCH' : remove ? 'DELETE' : 'POST';
          const body = leaf === 'employees.manage' ? remove ? undefined : { employeeId: spare.id }
            : leaf === 'employees.payment.edit' ? { amount } : { operationDate: date, employeeIds: present ? [] : [employee.id], correctionReason: 'Synthetic audited correction' };
          if (!allowed) { await rejected(path, method, body, 403, session); return; }
          const response = await request(path, method, body, session);
          await json(response, method === 'POST' ? 201 : 200);
          const after = await snapshot();
          const action = leaf === 'employees.manage' ? `one_time_order.workforce.employee_${remove ? 'removed' : 'added'}`
            : leaf === 'employees.payment.edit' ? 'one_time_order.workforce.payment_changed' : 'one_time_order.attendance.corrected';
          const actorId = session === cookie ? manager.id : delegate.id;
          const event = await audit(before, id, action, actorId);
          if (leaf === 'attendance.edit') {
            const row = after.days.find((entry) => entry.oneTimeOrderId === id && entry.employeeId === employee.id)!;
            assert.equal(row.attendancePresent, !present);
            assert.equal(Number(row.rateSnapshot), 700);
            assert.equal(Number(row.finalValue), present ? 0 : 700);
            assert.equal(row.updatedByUserId, actorId);
            assert.equal(row.manualOverride, false);
            assert.equal(after.submissions.find((entry) => entry.oneTimeOrderId === id)!.submittedByUserId, actorId);
            assert.equal((event.newValues as { reason: string }).reason, 'Synthetic audited correction');
            assert.deepEqual(after.days.filter((entry) => entry.oneTimeOrderId !== id), before.days.filter((entry) => entry.oneTimeOrderId !== id));
            assert.deepEqual(after.submissions.filter((entry) => entry.oneTimeOrderId !== id), before.submissions.filter((entry) => entry.oneTimeOrderId !== id));
            unchanged(before, after, ['days', 'submissions', 'audits']);
          } else {
            const row = after.team.find((entry) => entry.oneTimeOrderId === id && entry.employeeId === (leaf === 'employees.manage' ? spare.id : employee.id))!;
            if (leaf === 'employees.payment.edit') {
              assert.equal(Number(row.orderPayment), amount);
              assert.equal((event.newValues as { amount: number }).amount, amount);
            } else {
              assert.equal(row.isActive, !remove);
              assert.equal(row.removedByUserId, remove ? actorId : null);
              assert.equal(row.removedAt !== null, Boolean(remove));
              assert.equal(row.createdByUserId, previous?.createdByUserId ?? actorId);
            }
            assert.deepEqual(after.team.filter((entry) => entry.id !== row.id), before.team.filter((entry) => entry.id !== row.id));
            unchanged(before, after, ['team', 'audits']);
          }
        };
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'selected', [a.id], delegate.id);
        await attempt(a.id, true);
        await attempt(b.id, false);
        await rule(leaf, 'deny', 'selected', [a.id], delegate.id);
        await attempt(a.id, false);
        await revoke(leaf, delegate.id);
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'all', [], delegate.id);
        await attempt(b.id, true);
        for (const parent of ['read', 'access']) {
          // For read-deny subtraction, B needs genuine assignment inheritance.
          // Upserting deny on the unassigned delegate would replace its only
          // positive read grant, so B would correctly become unreadable too.
          const userId = parent === 'read' ? manager.id : delegate.id;
          const session = parent === 'read' ? cookie : delegateCookie;
          if (parent === 'read') await rule(leaf, 'allow', 'all', [], manager.id);
          await rule(parent, 'deny', 'selected', [a.id], userId);
          await attempt(a.id, false, session);
          await attempt(b.id, true, session);
          await revoke(parent, userId);
          if (parent === 'read') await revoke(leaf, manager.id);
        }
        await rule(leaf, 'deny', 'all', [], delegate.id);
        await attempt(a.id, false);
        await attempt(b.id, false);
        await rejected(`/objects/${object.id}`, 'GET', undefined, 404, delegateCookie);
      } finally {
        await reset();
        await restoreWorkforce();
      }
    });
  }

  await t.test('attendance reason, membership and financial snapshot invariants remain mandatory under an all grant', async () => {
    try {
      await restoreWorkforce();
      await rule('attendance.edit', 'allow', 'all');
      await rejected(`${workforce(a.id)}/attendance/today`, 'POST', { operationDate: date, employeeIds: [] }, 400);
      // A removed employee may legitimately still belong to this historical
      // date. Use a never-assigned ID to test membership, not today's removal.
      await rejected(`${workforce(a.id)}/attendance/today`, 'POST', { operationDate: date, employeeIds: [randomUUID()], correctionReason: 'Outside team' }, 400);
      const before = await snapshot();
      const body = await json<OneTimeOrderAttendanceResponse>(await request(`${workforce(a.id)}/attendance/today`, 'POST', { operationDate: date, employeeIds: [employee.id] }), 201);
      assert.equal(body.employees.find((row) => row.employeeId === employee.id)?.finalValue, 700);
      const after = await snapshot();
      assert.equal(after.days.filter((row) => row.oneTimeOrderId === a.id && row.employeeId === employee.id).length, 1);
      assert.equal(after.submissions.filter((row) => row.oneTimeOrderId === a.id).length, 1);
      assert.equal(Number(after.days.find((row) => row.oneTimeOrderId === a.id && row.employeeId === employee.id)!.rateSnapshot), 700);
      unchanged(before, after, ['days', 'submissions']); // Same attendance adds no new audit, payout, funding or approval.
    } finally { await reset(); await restoreWorkforce(); }
  });

  await t.test('escorts.manage: selected/all grant, old-cookie revoke, versions, nonempty current-team and parent checks', async () => {
    try {
      const attempt = async (id: string, allowed: boolean) => {
        const before = await snapshot();
        const previous = before.escorts.find((row) => row.oneTimeOrderId === id && row.escortUserId === manager.id);
        const body = { operationDate: date, expectedVersion: previous?.version ?? 0, employeeIds: [employee.id] };
        const path = `${root(id)}/escorts`;
        if (!allowed) { await rejected(path, 'PUT', body); return; }
        const saved = await json<Escort>(await request(path, 'PUT', body));
        assert.equal(saved.escortUserId, manager.id);
        assert.equal(saved.version, (previous?.version ?? 0) + 1);
        assert.deepEqual(saved.employees.map((row) => row.employeeId), [employee.id]);
        const after = await snapshot();
        assert.equal(after.escorts.find((row) => row.id === saved.id)!.version, saved.version);
        assert.deepEqual(after.escorts.filter((row) => row.id !== saved.id), before.escorts.filter((row) => row.id !== saved.id));
        unchanged(before, after, ['escorts', 'audits']);
        await audit(before, id, 'one_time_order.escorts_saved', manager.id);
        await rejected(path, 'PUT', body, 409);
        await rejected(path, 'PUT', { ...body, expectedVersion: saved.version, employeeIds: [] }, 400);
        // Never use the reusable spare employee as an invalid member: it may
        // have been legitimately added by the preceding workforce scenario.
        await rejected(path, 'PUT', { ...body, expectedVersion: saved.version, employeeIds: [randomUUID()] }, 400);
      };
      await attempt(a.id, false);
      await rule('escorts.manage', 'allow', 'selected', [a.id]);
      await attempt(a.id, true);
      await attempt(b.id, false);
      await rule('escorts.manage', 'deny', 'selected', [a.id]);
      await attempt(a.id, false);
      await revoke('escorts.manage');
      await attempt(a.id, false);
      await rule('escorts.manage', 'allow', 'all');
      await attempt(b.id, true);
      for (const parent of ['read', 'access', 'employees.read']) {
        await rule(parent, 'deny', 'selected', [a.id]);
        await attempt(a.id, false);
        await attempt(b.id, true);
        await revoke(parent);
      }
      await rule('escorts.manage', 'deny', 'all');
      await attempt(a.id, false);
      await attempt(b.id, false);
    } finally { await reset(); }
  });

  await t.test('payouts.read filters actual pending/approved expenses, never grants foreign ledgers or approval and never double counts', async () => {
    try {
      const baseline = await snapshot();
      for (const order of orders) {
        const day = baseline.days.find((entry) => entry.oneTimeOrderId === order.id && entry.employeeId === employee.id)!;
        assert.equal(day.attendancePresent, true, 'Payout fixture requires the restored attendance fact');
        assert.equal(Number(day.finalValue), 700, 'A prior failed mutation must not change the payout-test accrual baseline');
      }
      const payoutIds: string[] = [];
      for (const [order, session, amount] of [[a, cookie, 31], [b, cookie, 47], [a, foreignCookie, 101]] as const) {
        const expense = await json<{ id: string; status: string }>(await request('/accountability/me/expenses', 'POST', {
          amount, description: `${marker} local payout`, oneTimeOrderId: order.id, oneTimeOrderWorkCycle: 1,
          employeeId: employee.id, expenseCategory: 'employee_payout', expenseDate: date,
        }, session), 201);
        assert.equal(expense.status, 'draft');
        payoutIds.push(expense.id);
        await json(await request(`/accountability/me/expenses/${expense.id}/submit`, 'POST', {}, session));
      }
      const check = async (id: string, paid: number | null, pending: number | null, session = cookie) => {
        const before = await snapshot();
        for (let repeat = 0; repeat < 2; repeat++) {
          const view = await sheet(id, session);
          const row = view.rows.find((entry) => entry.employeeId === employee.id)!;
          assert.ok(row);
          assert.equal(row.total, 700, 'Contract sums and payouts do not replace attendance accrual');
          assert.equal(row.paidTotal, paid);
          assert.equal(row.pendingPayoutTotal, pending);
        }
        assert.deepEqual(await snapshot(), before);
      };
      await check(a.id, 0, 31); // Foreign account's 101 is never included.
      await check(b.id, 0, 47);
      await rule('payouts.read', 'allow', 'selected', [a.id]);
      await check(a.id, 0, 31);
      await check(b.id, 0, 47);
      await rule('payouts.read', 'deny', 'selected', [a.id]);
      await check(a.id, null, null);
      await check(b.id, 0, 47);
      await revoke('payouts.read');
      await check(a.id, 0, 31);
      await rule('payouts.read', 'deny', 'all');
      await check(a.id, null, null);
      await check(b.id, null, null);
      await rule('payouts.read', 'allow', 'all');
      await rejected(`/accountability/expenses/${payoutIds[0]}/approve`, 'POST', {});
      await rejected(`/accountability/accounts/${foreign.id}`);
      await rule('read', 'allow', 'all', [], delegate.id);
      await rule('payouts.read', 'allow', 'all', [], delegate.id);
      await check(a.id, 0, 0, delegateCookie);
      await rejected(`/accountability/accounts/${manager.id}`, 'GET', undefined, 403, delegateCookie);
      await rejected(`/accountability/expenses/${payoutIds[0]}/approve`, 'POST', {}, 403, delegateCookie);
      const beforeApprove = await snapshot();
      const approved = await json<{ status: string }>(await request(`/accountability/expenses/${payoutIds[0]}/approve`, 'POST', {}, founderCookie));
      assert.equal(approved.status, 'approved');
      const afterApprove = await snapshot();
      const stored = afterApprove.expenses.find((entry) => entry.id === payoutIds[0])!;
      assert.equal(stored.approvedByUserId, founder.id);
      assert.notEqual(stored.approvedByUserId, stored.createdByUserId);
      assert.ok(stored.approvedAt);
      assert.equal(afterApprove.expenses.length, beforeApprove.expenses.length);
      assert.deepEqual(afterApprove.expenses.filter((entry) => entry.id !== stored.id), beforeApprove.expenses.filter((entry) => entry.id !== stored.id));
      unchanged(beforeApprove, afterApprove, ['expenses', 'audits']);
      await audit(beforeApprove, stored.id, 'accountability_expense_approved', founder.id);
      await check(a.id, 31, 0);
      await check(b.id, 0, 47);
      await rejected(`/accountability/expenses/${payoutIds[0]}/approve`, 'POST', {}, 409, founderCookie);
      for (const parent of ['read', 'access']) {
        await rule(parent, 'deny', 'selected', [a.id]);
        await rejected(sheetPath(a.id));
        await check(b.id, 0, 47);
        await revoke(parent);
      }
      await rule('finance.read', 'deny', 'selected', [a.id]);
      const hidden = (await sheet(a.id)).rows.find((entry) => entry.employeeId === employee.id)!;
      assert.equal(hidden.total, null);
      assert.equal(hidden.paidTotal, null);
      assert.equal(hidden.pendingPayoutTotal, null);
      await revoke('finance.read');
      await rule('read', 'deny', 'selected', [manager.id], manager.id, 'accountability');
      await check(a.id, 0, 0);
      await check(b.id, 0, 0);
    } finally { await reset(); }
  });

  assert.deepEqual(await identities(), originalIdentities, 'No new User roles/permissions, Employee login, object access or global payroll authority');
  // Runner disposes only its isolated schema; no fixture cleanup touches seed data.
});
