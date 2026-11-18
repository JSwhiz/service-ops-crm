import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type {
  AccountabilityAccountViewDto, AccountabilityClosureResponseDto,
  AccountabilityExpenseResponseDto, AccountabilityFundingResponseDto,
  OneTimeOrderAccountabilityViewDto,
} from '../src/modules/accountability/dto/accountability-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'selected' | 'all';
const suffixes = [
  'access', 'read', 'review', 'issue_cash', 'external_receipt', 'correct_receipt',
  'expenses.create', 'expenses.update', 'expenses.submit', 'expenses.approve', 'expenses.reject',
  'closure.request', 'closure.approve', 'closure.reject', 'order_summary.read',
] as const;

// Bounded real-route acceptance. OQ-144 is open: no contractual-pay/cash-balance
// formula is invented, and no attendance/accrual is treated as an actual payout.
test('15 accountability actions enforce live personal rules and preserve money/approval boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definitions = ACCESS_ACTION_CATALOG.filter((action) => action.module === 'accountability');
  assert.deepEqual(definitions.map((action) => action.code).sort(), suffixes.map((suffix) => `accountability.${suffix}`).sort());
  assert.ok(definitions.every((action) => action.resourceType === 'user'));

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => {
    try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-accountability-${randomUUID()}`;
  const fixtureUserIds: string[] = [];
  let sequence = 0;
  const newUser = async (label: string, roleCode = 'manager') => {
    const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: {
      login: `${marker}-${label}-${++sequence}`, fullName: `${marker} ${label}`,
      passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId: role.id } },
    } });
    fixtureUserIds.push(user.id);
    // One cookie per fixture user; policy changes never trigger another login.
    const cookie = await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' });
    const account = await prisma.accountabilityAccount.create({ data: { userId: user.id, status: 'active' } });
    await prisma.accountabilityFunding.create({ data: {
      accountabilityAccountId: account.id, amount: 1000, fundingType: 'manual_issue',
      entryDirection: 'credit', issuedByUserId: user.id, recordedByUserId: user.id, comment: 'Isolated initial ledger fixture',
    } });
    return { ...user, cookie, account };
  };
  type Actor = Awaited<ReturnType<typeof newUser>>;
  const reviewer = await newUser('reviewer', 'founder');
  const grantReviewer = await newUser('personal-reviewer');
  const issuer = await newUser('issuer', 'deputy_founder');
  const rule = (user: Actor, suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], module = 'accountability') => {
    const actionCode = `${module}.${suffix}`;
    const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode);
    assert.ok(definition);
    assert.ok(definition.allowedScopes.includes(scope));
    if (effect === 'allow') assert.equal(definition.manageable, true, 'Do not fabricate new authority for a constrained action');
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: user.id, actionCode } },
      create: { userId: user.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (user: Actor, suffix: string, module = 'accountability') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: user.id, actionCode: `${module}.${suffix}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: fixtureUserIds } } });
  const request = (user: Actor, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  // Full relevant tables include unknown rows from denied creation attempts.
  // Background delivery timestamps are excluded; durable outbox content is not.
  const snapshot = async () => ({
    accounts: await prisma.accountabilityAccount.findMany({ orderBy: { id: 'asc' } }),
    fundings: await prisma.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
    closures: await prisma.accountabilityClosure.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    completions: await prisma.oneTimeOrderCompletion.findMany({ orderBy: { id: 'asc' } }),
    users: await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true } }),
    employees: await prisma.employee.findMany({ orderBy: { id: 'asc' } }),
    workforce: await prisma.$queryRaw<unknown[]>`SELECT * FROM "one_time_order_employee_assignments" ORDER BY "id"`,
    timesheet: await prisma.$queryRaw<unknown[]>`SELECT * FROM "one_time_order_timesheet_day_entries" ORDER BY "id"`,
    attendance: await prisma.$queryRaw<unknown[]>`SELECT * FROM "one_time_order_attendance_submissions" ORDER BY "id"`,
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const denied = async (user: Actor, path: string, method = 'GET', body?: unknown, status = 403) => {
    const before = await snapshot();
    const response = await request(user, path, method, body);
    const text = await response.text();
    const after = await snapshot();
    assert.deepEqual(after, before, `${method} ${path} (${response.status}) must have no business, ledger, approval or audit effect`);
    assert.equal(response.status, status, text);
    return text;
  };
  const onlyChanges = (before: Snapshot, after: Snapshot, allowed: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) {
      if (key !== 'audits' && !allowed.includes(key)) assert.deepEqual(after[key], before[key], key);
    }
    assert.deepEqual(after.audits.filter((row) => before.audits.some((old) => old.id === row.id)), before.audits);
  };
  const audit = (before: Snapshot, after: Snapshot, user: Actor, entityId: string, action: string) => {
    const added = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id));
    const matches = added.filter((row) => row.entityId === entityId && row.action === action);
    assert.equal(matches.length, 1, action);
    assert.equal(matches[0].actorUserId, user.id);
    return matches[0];
  };
  const ownView = (user: Actor) => request(user, '/accountability/me').then((response) => json<AccountabilityAccountViewDto>(response, 200));
  const balance = async (user: Actor) => (await ownView(user)).summary.currentBalance;
  const expenseInput = () => ({ amount: 25, description: `${marker}-expense-${++sequence}` });
  const draft = async (user: Actor, extra: Record<string, unknown> = {}) => {
    const input = { ...expenseInput(), ...extra };
    const before = await snapshot();
    const result = await json<AccountabilityExpenseResponseDto>(await request(user, '/accountability/me/expenses', 'POST', input), 201);
    const after = await snapshot();
    onlyChanges(before, after, ['expenses']);
    assert.equal(after.expenses.length, before.expenses.length + 1);
    const row = after.expenses.find((entry) => entry.id === result.id)!;
    assert.equal(row.accountabilityAccountId, user.account.id);
    assert.equal(row.createdByUserId, user.id);
    assert.equal(row.status, 'draft');
    assert.equal(Number(row.amount), input.amount);
    assert.equal(row.description, input.description);
    assert.deepEqual(after.expenses.filter((entry) => entry.id !== result.id), before.expenses);
    audit(before, after, user, result.id, 'accountability_expense_created');
    return result;
  };
  const submit = async (user: Actor, id: string) => {
    const before = await snapshot();
    const result = await json<AccountabilityExpenseResponseDto>(await request(user, `/accountability/me/expenses/${id}/submit`, 'POST'), 200);
    const after = await snapshot();
    onlyChanges(before, after, ['expenses']);
    const old = before.expenses.find((entry) => entry.id === id)!;
    const row = after.expenses.find((entry) => entry.id === id)!;
    assert.deepEqual(row, { ...old, status: 'submitted', submittedAt: row.submittedAt, updatedAt: row.updatedAt });
    assert.ok(row.submittedAt);
    assert.equal(result.status, 'submitted');
    assert.deepEqual(after.expenses.filter((entry) => entry.id !== id), before.expenses.filter((entry) => entry.id !== id));
    audit(before, after, user, id, 'accountability_expense_submitted');
    return result;
  };
  const resolveExpense = async (user: Actor, owner: Actor, id: string, decision: 'approve' | 'reject') => {
    const beforeBalance = await balance(owner);
    const before = await snapshot();
    const result = await json<AccountabilityExpenseResponseDto>(await request(user, `/accountability/expenses/${id}/${decision}`, 'POST', { comment: 'Isolated independent decision' }), 200);
    const after = await snapshot();
    onlyChanges(before, after, ['expenses']);
    const old = before.expenses.find((entry) => entry.id === id)!;
    const row = after.expenses.find((entry) => entry.id === id)!;
    assert.equal(result.status, decision === 'approve' ? 'approved' : 'rejected');
    assert.equal(row.status, result.status);
    assert.equal(decision === 'approve' ? row.approvedByUserId : row.rejectedByUserId, user.id);
    assert.equal(row.createdByUserId, old.createdByUserId);
    assert.equal(row.accountabilityAccountId, old.accountabilityAccountId);
    assert.equal(Number(row.amount), Number(old.amount));
    assert.deepEqual(after.expenses.filter((entry) => entry.id !== id), before.expenses.filter((entry) => entry.id !== id));
    audit(before, after, user, id, `accountability_expense_${result.status}`);
    assert.equal(await balance(owner), beforeBalance - (decision === 'approve' ? Number(old.amount) : 0));
    return result;
  };
  const closure = async (owner: Actor) => {
    const before = await snapshot();
    const result = await json<AccountabilityClosureResponseDto>(await request(owner, '/accountability/me/closures/request', 'POST'), 201);
    const after = await snapshot();
    onlyChanges(before, after, ['accounts', 'closures', 'approvals']);
    assert.equal(result.status, 'requested');
    const account = after.accounts.find((row) => row.id === owner.account.id)!;
    const oldAccount = before.accounts.find((row) => row.id === owner.account.id)!;
    assert.deepEqual(account, { ...oldAccount, status: 'closing_requested', updatedAt: account.updatedAt });
    assert.deepEqual(after.accounts.filter((row) => row.id !== account.id), before.accounts.filter((row) => row.id !== account.id));
    const requests = after.approvals.filter((row) => !before.approvals.some((old) => old.id === row.id));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].approvalType, 'accountability_closure_confirmation');
    assert.equal(requests[0].sourceEntityType, 'accountability_closure');
    assert.equal(requests[0].sourceEntityId, result.id);
    assert.equal(requests[0].status, 'pending');
    assert.equal(requests[0].createdByUserId, owner.id);
    assert.equal(requests[0].resolvedByUserId, null);
    audit(before, after, owner, result.id, 'accountability_closure_requested');
    audit(before, after, owner, requests[0].id, 'approval.request.created');
    return result;
  };
  const resolveClosure = async (user: Actor, owner: Actor, id: string, decision: 'approve' | 'reject') => {
    const beforeBalance = await balance(owner);
    const before = await snapshot();
    const result = await json<AccountabilityClosureResponseDto>(await request(user, `/accountability/closures/${id}/${decision}`, 'POST', { comment: 'Independent reconciliation' }), 200);
    const after = await snapshot();
    onlyChanges(before, after, ['accounts', 'expenses', 'closures', 'approvals']);
    assert.equal(result.status, decision === 'approve' ? 'approved' : 'rejected');
    assert.equal(after.accounts.find((row) => row.id === owner.account.id)?.status, 'active');
    assert.deepEqual(after.accounts.filter((row) => row.id !== owner.account.id), before.accounts.filter((row) => row.id !== owner.account.id));
    for (const old of before.expenses) {
      const row = after.expenses.find((entry) => entry.id === old.id)!;
      if (decision === 'approve' && old.accountabilityAccountId === owner.account.id && old.status === 'approved') {
        assert.deepEqual(row, { ...old, status: 'reconciled', reconciledAt: row.reconciledAt, updatedAt: row.updatedAt });
        assert.ok(row.reconciledAt);
        audit(before, after, user, row.id, 'accountability_expense_reconciled');
      } else assert.deepEqual(row, old);
    }
    const approval = after.approvals.find((row) => row.sourceEntityType === 'accountability_closure' && row.sourceEntityId === id)!;
    assert.equal(approval.status, result.status);
    assert.equal(approval.resolvedByUserId, user.id);
    assert.ok(approval.resolvedAt);
    audit(before, after, user, id, `accountability_closure_${result.status}`);
    audit(before, after, user, approval.id, `approval.request.${result.status}`);
    assert.equal(await balance(owner), beforeBalance, 'Reconciliation cannot debit an approved payout a second time');
  };

  await t.test('read/review/access use selected User A, preserve control B and revoke on old cookies', async () => {
    await reset();
    const a = await newUser('read-A');
    const b = await newUser('read-B');
    const before = await snapshot();
    await ownView(a);
    await denied(a, `/accountability/accounts/${b.id}`);
    await denied(grantReviewer, '/accountability/accounts');
    await rule(grantReviewer, 'access', 'allow', 'all');
    await denied(grantReviewer, '/accountability/accounts');
    await rule(grantReviewer, 'review', 'allow', 'selected', [a.id]);
    await rule(grantReviewer, 'read', 'allow', 'all');
    const check = async (ids: string[]) => {
      const rows = await json<Array<{ user: { id: string } }>>(await request(grantReviewer, '/accountability/accounts'), 200);
      assert.deepEqual(rows.map((row) => row.user.id).sort(), [...ids].sort());
    };
    await check([a.id]);
    const view = await json<AccountabilityAccountViewDto>(await request(grantReviewer, `/accountability/accounts/${a.id}`), 200);
    assert.equal(view.account.id, a.account.id);
    assert.equal(view.summary.currentBalance, 1000);
    await denied(grantReviewer, `/accountability/accounts/${b.id}`);
    await rule(grantReviewer, 'review', 'deny', 'selected', [a.id]);
    await denied(grantReviewer, `/accountability/accounts/${a.id}`);
    await revoke(grantReviewer, 'review');
    await denied(grantReviewer, `/accountability/accounts/${a.id}`);
    await rule(grantReviewer, 'review', 'allow', 'all');
    await rule(grantReviewer, 'read', 'deny', 'selected', [a.id]);
    await denied(grantReviewer, `/accountability/accounts/${a.id}`);
    assert.equal((await json<AccountabilityAccountViewDto>(await request(grantReviewer, `/accountability/accounts/${b.id}`), 200)).account.id, b.account.id);
    const filtered = await json<Array<{ user: { id: string } }>>(await request(grantReviewer, '/accountability/accounts'), 200);
    assert.ok(!filtered.some((row) => row.user.id === a.id));
    assert.ok(filtered.some((row) => row.user.id === b.id));
    await rule(a, 'read', 'deny', 'own');
    await denied(a, '/accountability/me');
    await ownView(b);
    await revoke(a, 'read');
    await ownView(a);
    await rule(grantReviewer, 'access', 'deny', 'selected', [a.id]);
    await denied(grantReviewer, `/accountability/accounts/${a.id}`);
    await rule(a, 'access', 'deny', 'all');
    await denied(a, '/accountability/me');
    assert.deepEqual(await snapshot(), before, 'Reading never materializes money or audit');
    await reset();
  });

  await t.test('issue_cash selected/all grants preserve issuance actor, recipient and control account', async () => {
    await reset();
    const a = await newUser('issue-A');
    const b = await newUser('issue-B');
    const path = (user: Actor) => `/accountability/accounts/${user.id}/fundings`;
    const issue = async (owner: Actor) => {
      const initial = await balance(owner);
      const before = await snapshot();
      const result = await json<AccountabilityFundingResponseDto>(await request(issuer, path(owner), 'POST', { amount: 17, comment: 'Explicit grant fixture' }), 201);
      const after = await snapshot();
      onlyChanges(before, after, ['fundings']);
      assert.equal(after.fundings.length, before.fundings.length + 1);
      const row = after.fundings.find((entry) => entry.id === result.id)!;
      assert.equal(row.accountabilityAccountId, owner.account.id);
      assert.equal(row.issuedByUserId, issuer.id);
      assert.equal(row.recordedByUserId, issuer.id);
      assert.equal(row.fundingType, 'manual_issue');
      assert.equal(row.entryDirection, 'credit');
      assert.equal(Number(row.amount), 17);
      assert.deepEqual(after.fundings.filter((entry) => entry.id !== result.id), before.fundings);
      audit(before, after, issuer, result.id, 'accountability_funding_issued');
      assert.equal(await balance(owner), initial + 17);
    };
    await denied(issuer, path(a), 'POST', { amount: 17 });
    await rule(issuer, 'access', 'allow', 'all');
    await denied(issuer, path(a), 'POST', { amount: 17 });
    await rule(issuer, 'issue_cash', 'allow', 'selected', [a.id]);
    await issue(a);
    await denied(issuer, path(b), 'POST', { amount: 17 });
    await rule(issuer, 'issue_cash', 'deny', 'selected', [a.id]);
    await denied(issuer, path(a), 'POST', { amount: 17 });
    await revoke(issuer, 'issue_cash');
    await denied(issuer, path(a), 'POST', { amount: 17 });
    await rule(issuer, 'issue_cash', 'allow', 'all');
    await issue(b);
    await rule(issuer, 'access', 'deny', 'selected', [a.id]);
    await denied(issuer, path(a), 'POST', { amount: 17 });
    await issue(b);
    await reset();
  });

  await t.test('external_receipt and correct_receipt preserve immutable credit, one reversal and separate manual issuance', async () => {
    await reset();
    const a = await newUser('receipt-A');
    const b = await newUser('receipt-B');
    const input = { amount: 12.5, source: 'External fixture', comment: 'Actual external receipt' };
    const receive = async (owner: Actor) => {
      const initial = await balance(owner);
      const before = await snapshot();
      const result = await json<AccountabilityFundingResponseDto>(await request(owner, '/accountability/me/fundings/external', 'POST', input), 201);
      const after = await snapshot();
      onlyChanges(before, after, ['fundings']);
      assert.equal(after.fundings.length, before.fundings.length + 1);
      assert.equal(result.fundingType, 'external_receipt');
      assert.equal(result.entryDirection, 'credit');
      assert.equal(result.recordedBy?.id, owner.id);
      assert.equal(result.oneTimeOrderPaymentId, null);
      assert.deepEqual(after.fundings.filter((row) => row.id !== result.id), before.fundings);
      audit(before, after, owner, result.id, 'accountability_funding_external_receipt_recorded');
      assert.equal(await balance(owner), initial + input.amount);
      return result;
    };
    await denied(a, '/accountability/me/fundings/external', 'POST', { ...input, source: ' ' }, 400);
    await denied(a, '/accountability/me/fundings/external', 'POST', { ...input, comment: ' ' }, 400);
    await rule(a, 'external_receipt', 'deny', 'selected', [a.id]);
    await denied(a, '/accountability/me/fundings/external', 'POST', input);
    const receiptB = await receive(b);
    await revoke(a, 'external_receipt');
    const receiptA = await receive(a);
    await rule(a, 'external_receipt', 'allow', 'own');
    await receive(a);
    await rule(a, 'access', 'deny', 'all');
    await denied(a, '/accountability/me/fundings/external', 'POST', input);
    await revoke(a, 'access');
    const reversePath = (id: string) => `/accountability/fundings/${id}/reverse`;
    await denied(grantReviewer, reversePath(receiptA.id), 'POST', { reason: 'Correction' });
    await rule(grantReviewer, 'correct_receipt', 'allow', 'selected', [a.id]);
    await denied(grantReviewer, reversePath(receiptB.id), 'POST', { reason: 'Wrong user scope' });
    await rule(grantReviewer, 'correct_receipt', 'deny', 'selected', [a.id]);
    await denied(grantReviewer, reversePath(receiptA.id), 'POST', { reason: 'Denied' });
    await revoke(grantReviewer, 'correct_receipt');
    await denied(grantReviewer, reversePath(receiptA.id), 'POST', { reason: 'Reverted default' });
    await rule(grantReviewer, 'correct_receipt', 'allow', 'selected', [a.id]);
    const initial = await balance(a);
    const before = await snapshot();
    const reversal = await json<AccountabilityFundingResponseDto>(await request(grantReviewer, reversePath(receiptA.id), 'POST', { reason: 'Isolated correction' }), 201);
    const after = await snapshot();
    onlyChanges(before, after, ['fundings']);
    assert.equal(after.fundings.length, before.fundings.length + 1);
    assert.equal(reversal.reversalOfFundingId, receiptA.id);
    assert.equal(reversal.fundingType, 'external_receipt_reversal');
    assert.equal(reversal.entryDirection, 'debit');
    const original = before.fundings.find((row) => row.id === receiptA.id)!;
    assert.deepEqual(after.fundings.find((row) => row.id === receiptA.id), { ...original, reversedByFundingId: reversal.id });
    assert.deepEqual(after.fundings.filter((row) => ![receiptA.id, reversal.id].includes(row.id)), before.fundings.filter((row) => row.id !== receiptA.id));
    audit(before, after, grantReviewer, reversal.id, 'accountability_funding_external_receipt_reversed');
    assert.equal(await balance(a), initial - input.amount);
    await denied(grantReviewer, reversePath(receiptA.id), 'POST', { reason: 'Duplicate reversal' }, 409);
    await rule(grantReviewer, 'correct_receipt', 'allow', 'all');
    await rule(grantReviewer, 'access', 'deny', 'selected', [b.id]);
    await denied(grantReviewer, reversePath(receiptB.id), 'POST', { reason: 'Root denial' });
    await revoke(grantReviewer, 'access');
    const beforeB = await snapshot();
    const reversedB = await json<AccountabilityFundingResponseDto>(await request(grantReviewer, reversePath(receiptB.id), 'POST', { reason: 'All-scope correction B' }), 201);
    const afterB = await snapshot();
    onlyChanges(beforeB, afterB, ['fundings']);
    assert.equal(reversedB.reversalOfFundingId, receiptB.id);
    assert.equal(reversedB.amount, input.amount);
    assert.equal(await balance(b), 1000);
    audit(beforeB, afterB, grantReviewer, reversedB.id, 'accountability_funding_external_receipt_reversed');
    const manual = after.fundings.find((row) => row.accountabilityAccountId === b.account.id && row.fundingType === 'manual_issue')!;
    await denied(grantReviewer, reversePath(manual.id), 'POST', { reason: 'Not an external receipt' }, 400);
    await reset();
  });

  for (const leaf of ['expenses.create', 'expenses.update', 'expenses.submit'] as const) {
    await t.test(`${leaf} selected own User denial and revoke preserve control B and hard expense ownership`, async () => {
      await reset();
      const a = await newUser(`${leaf}-A`);
      const b = await newUser(`${leaf}-B`);
      const targetA = leaf === 'expenses.create' ? null : await draft(a);
      const targetB = leaf === 'expenses.create' ? null : await draft(b);
      const path = (id: string | undefined) => `/accountability/me/expenses${leaf === 'expenses.create' ? '' : `/${id}${leaf === 'expenses.submit' ? '/submit' : ''}`}`;
      const method = leaf === 'expenses.update' ? 'PATCH' : 'POST';
      const body = leaf === 'expenses.submit' ? undefined : expenseInput();
      await rule(a, leaf, 'deny', 'selected', [a.id]);
      await denied(a, path(targetA?.id), method, body);
      if (leaf === 'expenses.create') await draft(b);
      else if (leaf === 'expenses.submit') await submit(b, targetB!.id);
      else {
        const before = await snapshot();
        const result = await json<AccountabilityExpenseResponseDto>(await request(b, path(targetB!.id), method, body), 200);
        const after = await snapshot();
        onlyChanges(before, after, ['expenses']);
        assert.equal(result.amount, body!.amount);
        assert.equal(result.description, body!.description);
        assert.deepEqual(after.expenses.filter((row) => row.id !== result.id), before.expenses.filter((row) => row.id !== result.id));
        audit(before, after, b, result.id, 'accountability_expense_updated');
      }
      await revoke(a, leaf);
      await rule(a, leaf, 'allow', 'all');
      if (targetB) await denied(a, path(targetB.id), method, body);
      await rule(a, 'access', 'deny', 'selected', [a.id]);
      await denied(a, path(targetA?.id), method, body);
      await revoke(a, 'access');
      await rule(a, 'read', 'deny', 'all');
      await denied(a, path(targetA?.id), method, body);
      await revoke(a, 'read');
      await revoke(a, leaf);
      const initial = await balance(a);
      if (leaf === 'expenses.create') await draft(a);
      else if (leaf === 'expenses.submit') {
        await submit(a, targetA!.id);
        await denied(a, path(targetA!.id), method, body, 409);
      } else {
        const before = await snapshot();
        const result = await json<AccountabilityExpenseResponseDto>(await request(a, path(targetA!.id), method, body), 200);
        const after = await snapshot();
        onlyChanges(before, after, ['expenses']);
        const old = before.expenses.find((row) => row.id === result.id)!;
        const row = after.expenses.find((entry) => entry.id === result.id)!;
        assert.deepEqual(row, { ...old, amount: row.amount, description: body!.description, updatedAt: row.updatedAt });
        assert.equal(Number(row.amount), body!.amount);
        audit(before, after, a, result.id, 'accountability_expense_updated');
      }
      assert.equal(await balance(a), initial, 'Draft/update/submit cannot debit the official balance');
      await reset();
    });
  }

  for (const decision of ['approve', 'reject'] as const) {
    await t.test(`expenses.${decision} denial overrides reviewer defaults; selected A cannot block independent control B`, async () => {
      await reset();
      const a = await newUser(`expense-${decision}-A`);
      const b = await newUser(`expense-${decision}-B`);
      const ea = await draft(a);
      const eb = await draft(b);
      await submit(a, ea.id);
      await submit(b, eb.id);
      const path = (id: string) => `/accountability/expenses/${id}/${decision}`;
      await rule(reviewer, `expenses.${decision}`, 'deny', 'selected', [a.id]);
      await denied(reviewer, path(ea.id), 'POST', { comment: 'Denied A' });
      await resolveExpense(reviewer, b, eb.id, decision);
      await revoke(reviewer, `expenses.${decision}`);
      await rule(reviewer, 'access', 'deny', 'selected', [a.id]);
      await denied(reviewer, path(ea.id), 'POST', { comment: 'Root denied A' });
      await revoke(reviewer, 'access');
      await resolveExpense(reviewer, a, ea.id, decision);
      await denied(reviewer, path(ea.id), 'POST', { comment: 'Replay' }, 409);
      await denied(a, `/accountability/me/expenses/${ea.id}`, 'PATCH', expenseInput(), 409);
      await reset();
    });
  }

  await t.test('closure.request remains pending, locks money writes, and grant never permits self approval', async () => {
    await reset();
    const a = await newUser('request-A');
    const b = await newUser('request-B');
    await rule(a, 'closure.request', 'deny', 'selected', [a.id]);
    await denied(a, '/accountability/me/closures/request', 'POST');
    const cb = await closure(b);
    await revoke(a, 'closure.request');
    await rule(a, 'access', 'deny', 'selected', [a.id]);
    await denied(a, '/accountability/me/closures/request', 'POST');
    await revoke(a, 'access');
    const ca = await closure(a);
    await denied(a, '/accountability/me/closures/request', 'POST', undefined, 409);
    await denied(a, '/accountability/me/expenses', 'POST', expenseInput(), 409);
    await denied(a, '/accountability/me/fundings/external', 'POST', { amount: 1, source: 'Locked', comment: 'Locked' }, 409);
    await denied(reviewer, `/accountability/accounts/${a.id}/fundings`, 'POST', { amount: 1 }, 409);
    await denied(a, `/accountability/closures/${ca.id}/approve`, 'POST');
    // Reviewer also owns their own requested closure: this reaches the
    // independent-approval invariant beyond the legacy permission precheck.
    const selfReviewer = await newUser('self-closure-reviewer', 'founder');
    await rule(selfReviewer, 'closure.request', 'allow', 'own');
    const self = await closure(selfReviewer);
    const selfClosureDenial = await denied(selfReviewer, `/accountability/closures/${self.id}/approve`, 'POST');
    assert.ok(selfClosureDenial.includes('Independent accountability closure approval is required'),
      'Permission-bearing founder must reach the independent-approval invariant');
    await resolveClosure(reviewer, a, ca.id, 'reject');
    await resolveClosure(reviewer, b, cb.id, 'reject');
    // Rejecting the reviewer's own request is not tested as a business rule.
    await reset();
  });

  for (const decision of ['approve', 'reject'] as const) {
    await t.test(`closure.${decision} resolves shared approval once, returns active and never pays again`, async () => {
      await reset();
      const a = await newUser(`closure-${decision}-A`);
      const b = await newUser(`closure-${decision}-B`);
      const expense = await draft(a);
      await submit(a, expense.id);
      await resolveExpense(reviewer, a, expense.id, 'approve');
      const ca = await closure(a);
      const cb = await closure(b);
      const path = (id: string) => `/accountability/closures/${id}/${decision}`;
      await rule(reviewer, `closure.${decision}`, 'deny', 'selected', [a.id]);
      await denied(reviewer, path(ca.id), 'POST', { comment: 'Denied A' });
      await resolveClosure(reviewer, b, cb.id, decision);
      await revoke(reviewer, `closure.${decision}`);
      await rule(reviewer, 'access', 'deny', 'selected', [a.id]);
      await denied(reviewer, path(ca.id), 'POST', { comment: 'Root denied A' });
      await revoke(reviewer, 'access');
      await resolveClosure(reviewer, a, ca.id, decision);
      await denied(reviewer, path(ca.id), 'POST', { comment: 'Replay' }, 409);
      await draft(a); // Active same account can accept later work.
      await reset();
    });
  }

  await t.test('employee payout is a single independently approved expense; User is never an Employee or another account', async () => {
    await reset();
    const owner = await newUser('payout-owner');
    const other = await newUser('payout-outsider');
    const employee = await prisma.employee.create({ data: { fullName: `${marker}-Employee`, employmentStatus: 'active' } });
    const order = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-payout`, executionAddress: 'Isolated payout', status: 'in_progress', contactName: 'Fixture',
      createdByUserId: reviewer.id,
      assignments: { create: { userId: owner.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    const assignmentId = randomUUID();
    await prisma.$executeRaw`INSERT INTO "one_time_order_employee_assignments"
      ("id", "oneTimeOrderId", "workCycle", "employeeId", "createdByUserId")
      VALUES (${assignmentId}, ${order.id}, 1, ${employee.id}, ${reviewer.id})`;
    const input = { oneTimeOrderId: order.id, oneTimeOrderWorkCycle: 1, employeeId: employee.id,
      expenseCategory: 'employee_payout', expenseDate: '2026-11-08', amount: 40 };
    await denied(owner, '/accountability/me/expenses', 'POST', { ...expenseInput(), ...input, employeeId: owner.id }, 400);
    await denied(other, '/accountability/me/expenses', 'POST', { ...expenseInput(), ...input });
    const initial = await balance(owner);
    const payout = await draft(owner, input);
    assert.equal(payout.employeeId, employee.id);
    assert.equal(payout.oneTimeOrderWorkCycle, 1);
    await submit(owner, payout.id); // Employee payout does not require a fabricated receipt.
    assert.equal(await balance(owner), initial);
    await denied(owner, `/accountability/expenses/${payout.id}/approve`, 'POST');
    // Reach the same invariant with a genuine permission-bearing author.
    await rule(reviewer, 'expenses.create', 'allow', 'own');
    const reviewerExpense = await draft(reviewer);
    await rule(reviewer, 'expenses.submit', 'allow', 'own');
    await submit(reviewer, reviewerExpense.id);
    const selfExpenseDenial = await denied(reviewer, `/accountability/expenses/${reviewerExpense.id}/approve`, 'POST');
    assert.ok(selfExpenseDenial.includes('Independent expense approval is required'),
      'Permission-bearing founder must reach the independent-approval invariant');
    await resolveExpense(reviewer, owner, payout.id, 'approve');
    await denied(reviewer, `/accountability/expenses/${payout.id}/approve`, 'POST', undefined, 409);
    const reconciliation = await closure(owner);
    await resolveClosure(reviewer, owner, reconciliation.id, 'approve');
    assert.equal(await balance(owner), initial - 40);
    const beforeSummary = await snapshot();
    const summary = await json<OneTimeOrderAccountabilityViewDto>(await request(owner, `/accountability/orders/${order.id}`), 200);
    assert.equal(summary.visibilityScope, 'own');
    assert.deepEqual(summary.accounts.map((account) => account.user.id), [owner.id]);
    assert.deepEqual(summary.accounts[0].expenses.map((expense) => expense.id), [payout.id]);
    assert.equal(summary.accounts[0].summary.totalReconciledExpenses, 40);
    assert.deepEqual(await snapshot(), beforeSummary);
    await rule(owner, 'order_summary.read', 'deny', 'selected', [owner.id]);
    await denied(owner, `/accountability/orders/${order.id}`);
    await revoke(owner, 'order_summary.read');
    await rule(owner, 'order_summary.read', 'allow', 'all');
    await rule(owner, 'read', 'deny', 'all');
    const hidden = await json<OneTimeOrderAccountabilityViewDto>(await request(owner, `/accountability/orders/${order.id}`), 200);
    assert.deepEqual(hidden.accounts, []);
    await revoke(owner, 'read');
    await rule(owner, 'access', 'deny', 'all');
    await denied(owner, `/accountability/orders/${order.id}`);
    await revoke(owner, 'access');
    await rule(owner, 'payouts.read', 'deny', 'selected', [order.id], 'one_time_orders');
    await denied(owner, `/accountability/orders/${order.id}`);
    await reset();
  });

  // Personal expense decisions are founder-manageable. Reuse the existing
  // independent-decision ledger/audit assertions; self-approval is covered above.
  for (const leaf of ['expenses.approve', 'expenses.reject'] as const) {
    await t.test(`${leaf}: founder selected/all grants resolve only authorized sources and retain explicit denies`, async () => {
      await reset();
      const owner = await newUser(`grant-${leaf}-A`);
      const control = await newUser(`grant-${leaf}-B`);
      try {
        const code = `accountability.${leaf}`;
        const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === code)!;
        assert.equal(definition.manageable, true);
        assert.notEqual(definition.constraint, 'policy_decision_required');
        const decision = leaf.endsWith('approve') ? 'approve' : 'reject';
        const target = await draft(owner);
        const other = await draft(control);
        await submit(owner, target.id);
        await submit(control, other.id);
        const path = (id: string) => `/accountability/expenses/${id}/${decision}`;
        await denied(grantReviewer, path(target.id), 'POST', { comment: 'No personal decision authority yet' });

        // The founder issues real personal authority through preview/save;
        // no permission, role, source ownership or manager assignment is added.
        const grant = async (scope: 'selected' | 'all') => {
          const { accessVersion } = await prisma.user.findUniqueOrThrow({
            where: { id: grantReviewer.id }, select: { accessVersion: true },
          });
          const payload = {
            expectedVersion: accessVersion, reason: 'Approved personal expense decision fixture',
            changes: [{ actionCode: code, effect: 'allow', scope,
              selectedIds: scope === 'selected' ? [owner.id] : [] }],
          };
          const route = `/users-access/admin/users/${grantReviewer.id}`;
          const preview = await json<{ previewToken: string; previewHash: string }>(
            await request(reviewer, `${route}/preview`, 'POST', payload), 201,
          );
          const saved = await json<{ accessVersion: number }>(await request(reviewer, `${route}/save`, 'POST', {
            ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash,
          }), 201);
          assert.equal(saved.accessVersion, accessVersion + 1);
          const stored = await prisma.userAccessRule.findUniqueOrThrow({
            where: { userId_actionCode: { userId: grantReviewer.id, actionCode: code } },
          });
          assert.equal(stored.effect, 'allow');
          assert.equal(stored.scope, scope);
          assert.deepEqual(stored.selectedIds, scope === 'selected' ? [owner.id] : []);
        };

        await grant('selected');
        await denied(grantReviewer, path(other.id), 'POST', { comment: 'Outside selected account' });
        await rule(grantReviewer, 'read', 'deny', 'selected', [owner.id]);
        await denied(grantReviewer, path(target.id), 'POST', { comment: 'Source read denial overrides selected grant' });
        await revoke(grantReviewer, 'read');
        await rule(grantReviewer, 'access', 'deny', 'selected', [owner.id]);
        await denied(grantReviewer, path(target.id), 'POST', { comment: 'Root denial overrides selected grant' });
        await revoke(grantReviewer, 'access');
        await resolveExpense(grantReviewer, owner, target.id, decision);
        await denied(grantReviewer, path(target.id), 'POST', { comment: 'Replay' }, 409);

        await grant('all');
        await rule(grantReviewer, 'read', 'deny', 'selected', [control.id]);
        await denied(grantReviewer, path(other.id), 'POST', { comment: 'Source read denial overrides all grant' });
        await revoke(grantReviewer, 'read');
        await resolveExpense(grantReviewer, control, other.id, decision);
        await denied(grantReviewer, path(other.id), 'POST', { comment: 'Replay' }, 409);
        await revoke(grantReviewer, leaf);
        await denied(grantReviewer, path(other.id), 'POST', { comment: 'Revoked personal authority on same cookie' });
      } finally { await reset(); }
    });
  }

  // Closure decisions remain constrained. Personal expense authority does not
  // grant closure approval/rejection or change their independent resolution.
  for (const leaf of ['closure.approve', 'closure.reject'] as const) {
    await t.test(`${leaf}: constrained admin allow is rejected; legacy independent resolution honors personal deny`, async () => {
      await reset();
      const owner = await newUser(`grant-${leaf}`);
      try {
        const code = `accountability.${leaf}`;
        const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === code)!;
        assert.equal(definition.manageable, false);
        assert.equal(definition.constraint, 'policy_decision_required');
        const expenseDecision = leaf.startsWith('expenses.');
        const decision = leaf.endsWith('approve') ? 'approve' : 'reject';
        const target = expenseDecision ? await draft(owner) : await closure(owner);
        if (expenseDecision) await submit(owner, target.id);
        const path = `/accountability/${expenseDecision ? 'expenses' : 'closures'}/${target.id}/${decision}`;
        await denied(grantReviewer, path, 'POST', { comment: 'Default denial' });
        const before = await snapshot();
        const policyBefore = {
          user: await prisma.user.findUniqueOrThrow({ where: { id: grantReviewer.id }, select: { accessVersion: true } }),
          rules: await prisma.userAccessRule.findMany({ where: { userId: grantReviewer.id }, orderBy: { id: 'asc' } }),
          audits: await prisma.userAccessAudit.findMany({ where: { userId: grantReviewer.id }, orderBy: { id: 'asc' } }),
        };
        const response = await request(reviewer, `/users-access/admin/users/${grantReviewer.id}/preview`, 'POST', {
          expectedVersion: policyBefore.user.accessVersion, reason: 'Constrained accountability authority fixture',
          changes: [{ actionCode: code, effect: 'allow', scope: 'selected', selectedIds: [owner.id] }],
        });
        const text = await response.text();
        assert.equal(response.status, 400, text);
        assert.ok(text.includes(`Action is constrained: ${code}`));
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: grantReviewer.id }, select: { accessVersion: true } }), policyBefore.user);
        assert.deepEqual(await prisma.userAccessRule.findMany({ where: { userId: grantReviewer.id }, orderBy: { id: 'asc' } }), policyBefore.rules);
        assert.deepEqual(await prisma.userAccessAudit.findMany({ where: { userId: grantReviewer.id }, orderBy: { id: 'asc' } }), policyBefore.audits);
        await denied(grantReviewer, path, 'POST', { comment: 'Rejected admin request grants nothing' });
        await rule(reviewer, leaf, 'deny', 'selected', [owner.id]);
        await denied(reviewer, path, 'POST', { comment: 'Existing personal denial overrides legacy authority' });
        await revoke(reviewer, leaf);
        if (expenseDecision) await resolveExpense(reviewer, owner, target.id, decision);
        else await resolveClosure(reviewer, owner, target.id, decision);
      } finally { await reset(); }
    });
  }
  await t.test('regression: reference/users excludes read-denied User A while retaining control B', async () => {
    await reset();
    const a = await newUser('reference-A');
    const b = await newUser('reference-B');
    try {
      await rule(grantReviewer, 'review', 'allow', 'selected', [a.id, b.id]);
      const before = await snapshot();
      const initial = await json<Array<{ id: string }>>(await request(grantReviewer, '/accountability/reference/users'), 200);
      assert.deepEqual(initial.map((row) => row.id).sort(), [a.id, b.id].sort());
      await rule(grantReviewer, 'read', 'deny', 'selected', [a.id]);
      const filtered = await json<Array<{ id: string }>>(await request(grantReviewer, '/accountability/reference/users'), 200);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(filtered.map((row) => row.id), [b.id]);
    } finally { await reset(); }
  });
  await t.test('read-denied account cannot receive a manual issue despite an independent issue grant; control and restored target remain usable', async () => {
    await reset();
    const a = await newUser('issue-read-denied-A');
    const b = await newUser('issue-read-control-B');
    try {
      await rule(issuer, 'issue_cash', 'allow', 'selected', [a.id, b.id]);
      await rule(issuer, 'read', 'deny', 'selected', [a.id]);
      await denied(issuer, `/accountability/accounts/${a.id}/fundings`, 'POST', {
        amount: 429.33, comment: 'Must not write into an explicitly hidden account',
      });
      const control = await json<AccountabilityFundingResponseDto>(await request(
        issuer, `/accountability/accounts/${b.id}/fundings`, 'POST',
        { amount: 23.17, comment: 'Independent visible control' },
      ), 201);
      assert.equal(Number(control.amount), 23.17);
      await revoke(issuer, 'read');
      const restored = await json<AccountabilityFundingResponseDto>(await request(
        issuer, `/accountability/accounts/${a.id}/fundings`, 'POST',
        { amount: 429.33, comment: 'Explicit manual submission after restoring access' },
      ), 201);
      assert.equal(Number(restored.amount), 429.33);
      assert.equal(await prisma.accountabilityFunding.count({ where: {
        accountabilityAccountId: a.account.id, amount: 429.33,
      } }), 1);
    } finally { await reset(); }
  });
  // Runner disposes the isolated schema. No shared-data cleanup or approval
  // bypass. Concurrency, audit-failure injection, order-payment sync/retry and
  // OQ-144 cash formulas are outside this bounded suite and remain unverified.
});
