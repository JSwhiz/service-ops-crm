import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import type { AccountabilityAccountViewDto, OneTimeOrderAccountabilityViewDto } from '../src/modules/accountability/dto/accountability-response.dto';

test('customer expenses: own creation, retry deduplication and one employee payout in both ledgers', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Requires disposable local schema');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await db.$disconnect(); });
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await db.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const hrRole = await db.role.findUniqueOrThrow({ where: { code: 'hr' } });
  const hr = await db.user.create({ data: {
    login: `expense-${randomUUID()}`, fullName: 'Получатель собственного расхода',
    passwordHash: manager.passwordHash, isActive: true,
    roles: { create: { roleId: hrRole.id } },
  } });
  const hrAccount = await db.accountabilityAccount.create({ data: { userId: hr.id } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: hr.login, password: 'manager123' });
  const post = (path: string, body: unknown, auth = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST', headers: { Cookie: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = { amount: 150, description: 'Собственный расход', clientRequestId: randomUUID() };
  const responses = await Promise.all([post('/accountability/me/expenses', payload), post('/accountability/me/expenses', payload)]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  const [first, second] = await Promise.all(responses.map(async r => await r.json() as { id: string }));
  assert.equal(first.id, second.id);
  assert.equal(await db.accountabilityExpense.count({ where: { accountabilityAccountId: hrAccount.id } }), 1);
  assert.equal(await db.auditEvent.count({ where: { entityId: first.id, action: 'accountability_expense_created' } }), 1);
  assert.equal((await post('/accountability/me/expenses', { ...payload, amount: 151 })).status, 409);
  const foreign = await fetch(`${baseUrl}/api/v1/accountability/accounts/${manager.id}`, { headers: { Cookie: cookie } });
  assert.equal(foreign.status, 403);
  assert.equal((await post(`/accountability/expenses/${first.id}/approve`, {})).status, 403);

  const managerCookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const adminCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const account = await db.accountabilityAccount.upsert({ where: { userId: manager.id }, create: { userId: manager.id }, update: {} });
  const order = await db.oneTimeOrder.create({ data: {
    title: 'Приёмка выплаты', executionAddress: 'Локальная проверка', contactName: 'Тест', status: 'in_progress',
    createdByUserId: founder.id, assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  const employee = await db.employee.create({ data: { fullName: 'Сотрудник выплаты', employmentStatus: 'active' } });
  await db.$executeRaw`INSERT INTO "one_time_order_employee_assignments" ("id","oneTimeOrderId","workCycle","employeeId","createdByUserId") VALUES (${randomUUID()},${order.id},1,${employee.id},${founder.id})`;
  await db.accountabilityFunding.create({ data: { accountabilityAccountId: account.id, amount: 20000, issuedByUserId: founder.id, oneTimeOrderId: order.id } });
  const expenseResponse = await post('/accountability/me/expenses', {
    amount: 5000, description: 'Фактическая выплата', expenseCategory: 'employee_payout',
    expenseDate: '2026-11-17', employeeId: employee.id, oneTimeOrderId: order.id,
    oneTimeOrderWorkCycle: 1, clientRequestId: randomUUID(),
  }, managerCookie);
  assert.equal(expenseResponse.status, 201, await expenseResponse.clone().text());
  const expense = await expenseResponse.json() as { id: string };
  assert.equal((await post(`/accountability/me/expenses/${expense.id}/submit`, {}, managerCookie)).status, 200);
  const read = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: managerCookie } });
    assert.equal(r.status, 200, await r.clone().text()); return await r.json() as T;
  };
  const before = await read<AccountabilityAccountViewDto>('/accountability/me');
  assert.equal(before.summary.currentBalance, 20000);
  assert.equal(before.summary.forecastBalance, 15000);
  assert.equal((await post(`/accountability/expenses/${expense.id}/approve`, {}, adminCookie)).status, 200);
  const after = await read<AccountabilityAccountViewDto>('/accountability/me');
  assert.equal(after.summary.currentBalance, 15000);
  assert.equal(after.summary.forecastBalance, 15000);
  const orderLedger = await read<OneTimeOrderAccountabilityViewDto>(`/accountability/orders/${order.id}`);
  const own = orderLedger.accounts.find((a: { user: { id: string } }) => a.user.id === manager.id);
  assert.ok(own, 'Own order ledger must be included');
  assert.equal(own.summary.currentBalance, 15000);
  assert.equal(own.expenses.filter((e: { id: string }) => e.id === expense.id).length, 1);
});
