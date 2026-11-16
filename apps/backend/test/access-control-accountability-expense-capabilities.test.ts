import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AccountabilityService } from '../src/modules/accountability/accountability.service';
import { buildAccountabilityExpenseCapabilities } from '../src/modules/accountability/utils/accountability-capabilities.util';
import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const createRule: AccessRule = {
  actionCode: 'accountability.expenses.create', effect: 'allow', scope: 'own', selectedIds: [],
};
const director: AccessSubject = {
  id: ownerId, roleCodes: ['director'], isActive: true, accessRules: [createRule],
};
const base = {
  subject: director,
  ownerUserId: ownerId,
  isOwnExpense: true,
  legacyOwnExpenseAllowed: false,
  accountStatus: 'active',
  status: 'draft',
  roleCodes: ['director'],
};
const ownFlags = (params: Parameters<typeof buildAccountabilityExpenseCapabilities>[0]) => {
  const result = buildAccountabilityExpenseCapabilities(params);
  return [result.canEdit, result.canSubmit];
};

test('create-only director has no implied draft update or submit authority', () => {
  assert.deepEqual(ownFlags(base), [false, false]);
  assert.deepEqual(ownFlags({ ...base, subject: undefined }), [false, false],
    'The supplied legacy eligibility also governs callers without personal rules');
});

test('update and submit grants independently extend a false legacy baseline and reset separately', () => {
  const update: AccessRule = {
    actionCode: 'accountability.expenses.update', effect: 'allow', scope: 'selected', selectedIds: [ownerId],
  };
  const submit: AccessRule = {
    actionCode: 'accountability.expenses.submit', effect: 'allow', scope: 'own', selectedIds: [],
  };
  const flags = (accessRules: AccessRule[]) => ownFlags({ ...base, subject: { ...director, accessRules } });
  assert.deepEqual(flags([createRule, update]), [true, false]);
  assert.deepEqual(flags([createRule, submit]), [false, true]);
  assert.deepEqual(flags([createRule, update, submit]), [true, true]);
  assert.deepEqual(flags([createRule]), [false, false]);
  assert.deepEqual(flags([{ ...update, selectedIds: [otherId] }]), [false, false]);
});

test('legacy eligibility remains additive while explicit action and parent denies retain priority', () => {
  const eligible = { ...base, legacyOwnExpenseAllowed: true };
  assert.deepEqual(ownFlags(eligible), [true, true]);
  for (const [actionCode, expected] of [
    ['accountability.expenses.update', [false, true]],
    ['accountability.expenses.submit', [true, false]],
    ['accountability.read', [false, false]],
    ['accountability.access', [false, false]],
  ] as const) {
    const denied: AccessRule = { actionCode, effect: 'deny', scope: 'selected', selectedIds: [ownerId] };
    assert.deepEqual(ownFlags({ ...eligible, subject: { ...director, accessRules: [denied] } }), expected);
    assert.deepEqual(ownFlags({ ...eligible, subject: {
      ...director, accessRules: [{ ...denied, selectedIds: [otherId] }],
    } }), [true, true], 'An unrelated selected denial keeps the control owner eligible');
  }
});

test('read denial defeats both positive leaf grants even with no legacy eligibility', () => {
  const accessRules: AccessRule[] = ['accountability.expenses.update', 'accountability.expenses.submit']
    .map(actionCode => ({ actionCode, effect: 'allow', scope: 'all', selectedIds: [] }));
  accessRules.push({ actionCode: 'accountability.read', effect: 'deny', scope: 'own', selectedIds: [] });
  assert.deepEqual(ownFlags({ ...base, subject: { ...director, accessRules } }), [false, false]);
});

test('ownership, draft lifecycle, active account and active subject still bound positive leaf grants', () => {
  const accessRules: AccessRule[] = ['accountability.expenses.update', 'accountability.expenses.submit']
    .map(actionCode => ({ actionCode, effect: 'allow', scope: 'all', selectedIds: [] }));
  const allowed = { ...base, subject: { ...director, accessRules } };
  assert.deepEqual(ownFlags(allowed), [true, true]);
  assert.deepEqual(ownFlags({ ...allowed, isOwnExpense: false, ownerUserId: otherId }), [false, false]);
  assert.deepEqual(ownFlags({ ...allowed, subject: { ...allowed.subject, isActive: false } }), [false, false]);
  for (const status of ['submitted', 'approved', 'rejected', 'reconciled']) {
    assert.deepEqual(ownFlags({ ...allowed, status }), [false, false]);
  }
  for (const accountStatus of ['closing_requested', 'closed']) {
    assert.deepEqual(ownFlags({ ...allowed, accountStatus }), [false, false]);
  }
});

test('own expense eligibility does not redefine independent review authority', () => {
  const result = buildAccountabilityExpenseCapabilities({
    ...base, isOwnExpense: false, ownerUserId: otherId, status: 'submitted',
    permissionCodes: ['expense.approve'],
  });
  assert.deepEqual(result, { canEdit: false, canSubmit: false, canApprove: true, canReject: true });
  assert.equal(buildAccountabilityExpenseCapabilities({
    ...base, status: 'submitted', permissionCodes: ['expense.approve'],
  }).canApprove, false, 'An eligible reviewer still cannot approve their own expense');
});

type EligibilitySource = 'none' | 'manager' | 'assignment' | 'receipt';

function accountFixture(source: EligibilitySource, accountStatus = 'active') {
  const actor = {
    id: ownerId, login: 'expense-capability-fixture', fullName: 'Expense capability fixture',
    roleCode: source === 'manager' ? 'manager' : 'director',
    roleCodes: [source === 'manager' ? 'manager' : 'director'],
    isActive: true, accessRules: [createRule],
  };
  const user = { ...actor, roles: actor.roleCodes.map(code => ({ role: { code } })) };
  const now = new Date('2026-11-15T00:00:00Z');
  const account = { id: 'account', userId: ownerId, status: accountStatus };
  const expenses = ['draft-a', 'draft-b'].map(id => ({
    id, accountabilityAccountId: account.id, accountabilityAccount: account,
    oneTimeOrderId: null, oneTimeOrderCompletionId: null, oneTimeOrderWorkCycle: null,
    employeeId: null, employee: null, expenseCategory: null, expenseDate: null,
    amount: new Prisma.Decimal('19.31'), description: 'Own draft ' + id, status: 'draft',
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectionComment: null, reconciledAt: null,
    createdAt: now, updatedAt: now, createdBy: user, approvedBy: null, rejectedBy: null,
  }));
  const calls = { assignments: 0, receipts: 0 };
  const db = {
    user: { findFirst: async () => user },
    accountabilityAccount: { findUnique: async () => ({
      ...account, createdAt: now, updatedAt: now, fundings: [], expenses, closures: [],
    }) },
    fileAttachment: { findMany: async () => [] },
    oneTimeOrderAssignment: { findFirst: async (query: unknown) => {
      calls.assignments++;
      assert.deepEqual(query, {
        where: { userId: ownerId, assignmentRoleCode: 'one_time_manager', isActive: true }, select: { id: true },
      });
      return source === 'assignment' ? { id: 'active-assignment' } : null;
    } },
    accountabilityFunding: { findFirst: async (query: unknown) => {
      calls.receipts++;
      assert.deepEqual(query, {
        where: { fundingType: 'one_time_order_receipt', accountabilityAccount: { userId: ownerId } },
        select: { id: true },
      });
      return source === 'receipt' ? { id: 'historical-receipt' } : null;
    } },
  };
  // Database collaborators only. No application, HTTP listener or database client is created.
  const service = new AccountabilityService(db as never, {} as never);
  return { service, actor, calls, expenses };
}

test('actual own-account DTO reuses false eligibility for every draft and endpoints retain create-only denial', async () => {
  const { service, actor, calls, expenses } = accountFixture('none');
  const view = await service.getMyAccount(actor);
  assert.equal(view.capabilities.canCreateExpense, true);
  assert.equal(view.capabilities.canSubmitExpense, false);
  assert.deepEqual(view.expenses.map(row => [row.capabilities.canEdit, row.capabilities.canSubmit]),
    [[false, false], [false, false]]);
  assert.deepEqual(calls, { assignments: 1, receipts: 1 }, 'Resolve legacy sources once per response, not per expense');
  const before = JSON.stringify(expenses);
  for (const request of [
    () => service.updateExpense(actor, expenses[0].id, { amount: 20, description: 'Forbidden update' }),
    () => service.submitExpense(actor, expenses[0].id),
  ]) {
    await assert.rejects(request, (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
  }
  assert.equal(JSON.stringify(expenses), before, 'The original draft data remains untouched by the rejected public operations');
});

for (const source of ['manager', 'assignment', 'receipt'] as const) {
  test('actual account DTO preserves ' + source + ' eligibility without per-expense lookups', async () => {
    const { service, actor, calls } = accountFixture(source);
    const view = await service.getMyAccount(actor);
    assert.deepEqual(view.expenses.map(row => [row.capabilities.canEdit, row.capabilities.canSubmit]),
      [[true, true], [true, true]]);
    assert.equal(view.capabilities.canSubmitExpense, true);
    assert.deepEqual(calls, source === 'manager' ? { assignments: 0, receipts: 0 } : { assignments: 1, receipts: 1 });
  });
}

test('actual account DTO propagates locked account status to every draft row', async () => {
  const { service, actor } = accountFixture('assignment', 'closing_requested');
  const view = await service.getMyAccount(actor);
  assert.equal(view.capabilities.canSubmitExpense, false);
  assert.deepEqual(view.expenses.map(row => [row.capabilities.canEdit, row.capabilities.canSubmit]),
    [[false, false], [false, false]]);
});
