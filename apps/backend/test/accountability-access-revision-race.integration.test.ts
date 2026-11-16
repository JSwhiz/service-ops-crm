import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('expense create, update and submit refuse a revocation committed while waiting for the account lock', async (t) => {
  assert(usesIsolatedIntegrationDatabase());
  const database = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  t.after(() => db.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const founder = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const template = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const request = (cookie: string, path: string, method: string, body: unknown) => fetch(`${baseUrl}/api/v1/${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const json = async (response: Response, status: number) => {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body);
  };
  const saveRules = async (userId: string, changes: unknown[]) => {
    const { accessVersion } = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const payload = { expectedVersion: accessVersion, reason: 'Isolated expense revocation regression', changes };
    const path = `users-access/admin/users/${userId}`;
    const preview = await json(await request(founder, `${path}/preview`, 'POST', payload), 201);
    await json(await request(founder, `${path}/save`, 'POST', {
      ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash,
    }), 201);
  };
  const rule = (actionCode: string, effect = 'allow') => ({ actionCode, effect, scope: 'all', selectedIds: [] });

  for (const roleCode of ['manager', 'director']) for (const operation of ['create', 'update', 'submit']) {
    await t.test(`${roleCode}: ${operation}`, async () => {
      const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
      const actor = await db.user.create({ data: {
        login: `expense-revoke-${randomUUID()}`, fullName: 'Изолированная проверка отзыва права',
        passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId: role.id } },
      } });
      const account = await db.accountabilityAccount.create({ data: { userId: actor.id, status: 'active' } });
      await saveRules(actor.id, ['accountability.access', 'accountability.read', 'accountability.expenses.create',
        'accountability.expenses.update', 'accountability.expenses.submit'].map(code => rule(code)));
      const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
      let expense: { id: string } | undefined;
      if (operation !== 'create') expense = await json(await request(cookie, 'accountability/me/expenses', 'POST', {
        amount: 17.25, description: 'Existing isolated draft',
      }), 201);
      const snapshot = async () => ({
        account: await db.accountabilityAccount.findUniqueOrThrow({ where: { id: account.id } }),
        expenses: await db.accountabilityExpense.findMany({ where: { accountabilityAccountId: account.id }, orderBy: { id: 'asc' } }),
        audit: await db.auditEvent.findMany({ where: { actorUserId: actor.id, entityType: 'accountability_expense' }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot();
      let release!: () => void;
      let locked!: () => void;
      let blockerPid = 0;
      const ready = new Promise<void>(resolve => { locked = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.$transaction(async tx => {
        blockerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
        await tx.$queryRaw`SELECT "id" FROM "accountability_accounts" WHERE "id" = ${account.id} FOR UPDATE`;
        locked();
        await gate;
      }, { timeout: 20_000, maxWait: 5_000 });
      let pending: Promise<Response> | undefined;
      try {
        await Promise.race([ready, blocker]);
        const path = 'accountability/me/expenses' + (expense ? `/${expense.id}` : '') + (operation === 'submit' ? '/submit' : '');
        pending = request(cookie, path, operation === 'update' ? 'PATCH' : 'POST', operation === 'submit' ? {} : {
          amount: 25.75, description: 'Must not persist after access was revoked',
        });
        const deadline = Date.now() + 5_000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<Array<{ pid: number }>>`
            SELECT pid FROM pg_stat_activity
            WHERE ${blockerPid} = ANY(pg_blocking_pids(pid)) AND datname = current_database()
          `;
          if (rows.length) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waiting, 'The actual expense request must reach the account lock before revocation');
        await saveRules(actor.id, [rule(`accountability.expenses.${operation}`, 'deny')]);
        release();
        await blocker;
        const response = await pending;
        assert.equal(response.status, 403, await response.text());
        assert.deepEqual(await snapshot(), before, 'No expense, account or domain audit effect is allowed');
      } finally {
        release();
        await blocker.catch(() => undefined);
        await pending?.catch(() => undefined);
      }
    });
  }
});
