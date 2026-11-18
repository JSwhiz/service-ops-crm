import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';

import { TimesheetsService } from '../src/modules/timesheets/timesheets.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Actor = { id: string; cookie: string };

async function pauseAfterAuthorization(
  t: TestContext,
  service: object,
  method: string,
  write: () => Promise<Response>,
  revoke: () => Promise<void>,
) {
  const methods = service as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = methods[method].bind(service);
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const hook = t.mock.method(methods, method, async (...args: unknown[]) => {
    if (method === 'correctionObjectIds' && args[4] !== 'timesheet.exceptions.create') return original(...args);
    const result = await original(...args);
    entered();
    await released;
    return result;
  });
  const pending = write();
  try {
    await Promise.race([waiting, pending.then(async response => assert.fail(
      `Request completed before the write barrier: ${response.status} ${await response.clone().text()}`,
    ))]);
    await revoke();
  } finally {
    release();
    await pending.catch(() => undefined);
    hook.mock.restore();
  }
  return pending;
}

async function holdAccountLockWhileRevoking(
  db: PrismaClient,
  accountId: string,
  write: () => Promise<Response>,
  revoke: () => Promise<void>,
) {
  let pending: Promise<Response> | undefined;
  try {
    await db.$transaction(async (tx) => {
      const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM accountability_accounts WHERE id = ${accountId} FOR UPDATE
      `;
      assert.deepEqual(rows, [{ id: accountId }]);
      pending = write();
      void pending.catch(() => undefined);
      const blocked = () => db.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%accountability_accounts%'
          AND query ILIKE '%FOR UPDATE%'
          AND ${holder.pid}::integer = ANY(pg_blocking_pids(pid))
      `;
      const deadline = Date.now() + 3_000;
      let waiter: { pid: number } | undefined;
      while (!waiter && Date.now() < deadline) {
        [waiter] = await blocked();
        if (!waiter) await delay(25);
      }
      assert.ok(waiter, 'The financial request never waited on the account row lock');
      await revoke();
      assert.ok((await blocked()).some(({ pid }) => pid === waiter.pid),
        'The same write must still be blocked when the deny commits');
    }, { timeout: 10_000 });
  } catch (error) {
    await pending?.then(response => response.body?.cancel()).catch(() => undefined);
    throw error;
  }
  assert.ok(pending);
  return pending;
}

test('revocation during in-flight timesheet and accountability writes is atomic', { timeout: 75_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const founderRow = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const founder = { id: founderRow.id, cookie: await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }) };
  const template = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const actor = async (roleCode: string) => {
    const login = 'acl-finance-'+randomUUID();
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const { id } = await db.user.create({ data: {
      login, fullName: login, passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
    } });
    return { id, cookie: await loginAndGetCookieHeader({ baseUrl, login, password: 'manager123' }) };
  };
  const request = (path: string, user: Actor, body: object) => fetch(baseUrl+'/api/v1'+path, {
    method: 'POST', headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const apply = async (user: Actor, actionCode: string, effect: 'deny' | 'default', target: string) => {
    const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const url = '/users-access/admin/users/'+user.id;
    const payload = { expectedVersion: record.accessVersion, reason: 'Local write race',
      changes: [{ actionCode, effect, scope: effect === 'deny' ? 'selected' : 'all', selectedIds: effect === 'deny' ? [target] : [] }] };
    const preview = await request(url+'/preview', founder, payload);
    assert.equal(preview.status, 201, await preview.clone().text());
    const { previewToken, previewHash } = await preview.json() as { previewToken: string; previewHash: string };
    const saved = await request(url+'/save', founder, { ...payload, previewToken, previewHash });
    assert.equal(saved.status, 201, await saved.text());
  };
  const grant = (user: Actor, actionCode: string) => db.userAccessRule.create({ data: {
    userId: user.id, actionCode, effect: 'allow', scope: 'all',
  } });
  const snapshot = async (user: Actor) => ({
    months: await db.timesheetMonth.findMany({ orderBy: { id: 'asc' } }),
    rows: await db.timesheetEmployeeRow.findMany({ orderBy: { id: 'asc' } }),
    entries: await db.timesheetDayEntry.findMany({ orderBy: { id: 'asc' } }),
    exceptions: await db.timesheetManualException.findMany({ orderBy: { id: 'asc' } }),
    approvals: await db.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    accounts: await db.accountabilityAccount.findMany({ orderBy: { id: 'asc' } }),
    funding: await db.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
    expenses: await db.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
    audits: await db.auditEvent.findMany({ where: { actorUserId: user.id }, orderBy: { id: 'asc' } }),
  });

  for (const operation of ['amount', 'exception', 'period'] as const) {
    await t.test(`timesheet ${operation}: losing write authority while paused leaves the workbook unchanged`, async (sub) => {
      const user = await actor('deputy_director');
      const object = await db.object.create({ data: {
        name: randomUUID(), address: 'Local ACL fixture', status: 'active', createdByUserId: founder.id, paymentType: 'daily', dailyRate: 0,
      } });
      const employee = await db.employee.create({ data: { fullName: 'Local ACL employee', employmentStatus: 'active' } });
      const date = new Date(Date.now() + 3 * 3600_000);
      const year = date.getUTCFullYear(), month = date.getUTCMonth()+1, dayOfMonth = date.getUTCDate();
      await db.objectEmployeeAssignment.create({ data: {
        objectId: object.id, employeeId: employee.id, isActive: true, startDate: new Date(Date.UTC(year, month-1, 1)),
      } });
      const container = operation === 'period' ? await db.timesheetMonth.create({ data: {
        objectId: object.id, year, month, createdByUserId: founder.id,
      } }) : undefined;
      const code = operation === 'exception' ? 'timesheet.exceptions.create' : 'timesheet.amount.edit';
      await grant(user, code);
      const path = operation === 'exception' ? '/timesheets/exceptions' : '/timesheets/entries';
      const payload = { objectId: object.id, employeeId: employee.id, year, month, dayOfMonth, dayValue: 713, comment: 'Local ACL correction' };
      let expected = await snapshot(user);
      const response = await pauseAfterAuthorization(sub, app.get(TimesheetsService),
        operation === 'exception' ? 'correctionObjectIds' : 'assertManualCorrectionAccess',
        () => request(path, user, payload), async () => {
          if (container) {
            await db.timesheetMonth.update({ where: { id: container.id }, data: { status: 'closed' } });
            expected = await snapshot(user);
          } else await apply(user, code, 'deny', object.id);
        });
      assert.ok(container ? [403,409].includes(response.status) : response.status === 403, await response.text());
      assert.deepEqual(await snapshot(user), expected);
      if (container) await db.timesheetMonth.update({ where: { id: container.id }, data: { status: 'open' } });
      else {
        await apply(user, code, 'default', object.id);
        await grant(user, code);
      }
      const restored = await request(path, user, payload);
      assert.equal(restored.status, 201, await restored.clone().text());
      if (operation === 'exception') {
        assert.equal(await db.timesheetManualException.count({ where: { objectId: object.id } }), 1);
      } else {
        assert.equal(await db.timesheetDayEntry.count({ where: { row: { timesheetMonth: { objectId: object.id } }, dayValue: 713 } }), 1);
      }
    });
  }

  for (const operation of ['external_receipt','correct_receipt','expenses.approve','expenses.reject'] as const) {
    await t.test(`accountability ${operation}: access changes while waiting for the account write`, async () => {
      const owner = await actor('manager');
      const account = await db.accountabilityAccount.create({ data: { userId: owner.id, status: 'active' } });
      const funding = await db.accountabilityFunding.create({ data: {
        accountabilityAccountId: account.id, amount: 29, issuedByUserId: owner.id, recordedByUserId: owner.id,
        fundingType: 'external_receipt', entryDirection: 'credit', source: 'Local test', comment: 'Local receipt fixture',
      } });
      const expense = await db.accountabilityExpense.create({ data: {
        accountabilityAccountId: account.id, amount: 11, description: 'Local fixture',
        createdByUserId: owner.id, status: 'submitted', submittedAt: new Date(),
      } });
      const user = operation === 'external_receipt' ? owner : await actor(operation === 'correct_receipt' ? 'manager' : 'founder');
      const code = operation.startsWith('expenses.') ? 'accountability.access' : 'accountability.'+operation;
      if (operation === 'correct_receipt') await grant(user, code);
      const path = operation === 'external_receipt' ? '/accountability/me/fundings/external'
        : operation === 'correct_receipt' ? '/accountability/fundings/'+funding.id+'/reverse'
          : '/accountability/expenses/'+expense.id+'/'+operation.split('.')[1];
      const payload = operation === 'external_receipt' ? { amount: 19, source: 'Local test', comment: 'Local test' }
        : operation === 'correct_receipt' ? { reason: 'Local reversal' } : { comment: 'Local review' };
      const before = await snapshot(user);
      const response = await holdAccountLockWhileRevoking(db, account.id,
        () => request(path, user, payload), () => apply(user, code, 'deny', owner.id));
      assert.equal(response.status, 403, await response.text());
      assert.deepEqual(await snapshot(user), before);
      await apply(user, code, 'default', owner.id);
      if (operation === 'correct_receipt') await grant(user, code);
      const restored = await request(path, user, payload);
      assert.equal(restored.status, operation.startsWith('expenses.') ? 200 : 201, await restored.clone().text());
      const after = await snapshot(user);
      assert.equal(after.audits.length, before.audits.length+1);
      assert.equal(after.funding.length, before.funding.length+(operation.startsWith('expenses.') ? 0 : 1));
      assert.equal((await db.accountabilityExpense.findUniqueOrThrow({where:{id:expense.id}})).status,
        operation === 'expenses.approve' ? 'approved' : operation === 'expenses.reject' ? 'rejected' : 'submitted');
    });
  }
});
