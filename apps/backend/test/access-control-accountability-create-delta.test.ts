import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';

import { AccountabilityService } from '../src/modules/accountability/accountability.service';
import { SaveAccountabilityExpenseDto } from '../src/modules/accountability/dto/save-accountability-expense.dto';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

// Delta regressions only: in-memory database collaborators, real DTO/service/policy.
// No server, PrismaClient, environment loading or external resources are started.
const ownerId = '00000000-0000-4000-8000-000000000011';
const otherId = '00000000-0000-4000-8000-000000000012';
const orderId = '00000000-0000-4000-8000-000000000013';
const expenseId = '00000000-0000-4000-8000-000000000014';
const fileId = '00000000-0000-4000-8000-000000000015';
const now = new Date('2026-11-17T09:00:00Z');
const deny = (actionCode: string): AccessRule => ({
  actionCode,
  effect: 'deny',
  scope: 'own',
  selectedIds: [],
});

function actor(
  roleCode = 'hr',
  accessRules: AccessRule[] = [],
  permissionCodes: string[] = [],
) {
  return {
    id: ownerId,
    login: 'finance-delta',
    fullName: 'Finance delta fixture',
    roleCode,
    roleCodes: [roleCode],
    permissionCodes,
    accessRules,
    isActive: true,
  };
}

function fixtureExpense(
  status = 'draft',
  createdByUserId = ownerId,
  linkedOrderId: string | null = null,
) {
  const user = {
    id: createdByUserId,
    login: 'expense-author',
    fullName: 'Expense author',
    roles: [{ role: { code: 'hr' } }],
  };
  return {
    id: expenseId,
    accountabilityAccountId: 'own-account',
    accountabilityAccount: {
      id: 'own-account',
      userId: ownerId,
      status: 'active',
    },
    createdByUserId,
    createdBy: user,
    approvedBy: null,
    rejectedBy: null,
    oneTimeOrderId: linkedOrderId,
    oneTimeOrderCompletionId: null,
    oneTimeOrderWorkCycle: null,
    employeeId: null,
    employee: null,
    expenseCategory: linkedOrderId ? 'other' : null,
    expenseDate: null,
    amount: new Prisma.Decimal('10.01'),
    description: 'Own expense evidence',
    status,
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionComment: null,
    reconciledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

test('create DTO accepts cent precision and rejects fractional cents before persistence', () => {
  const base = {
    description: 'Precision regression',
    clientRequestId: '00000000-0000-4000-8000-000000000016',
  };
  for (const amount of [0.01, 1, 10.01, '10.01']) {
    const dto = plainToInstance(SaveAccountabilityExpenseDto, {
      ...base,
      amount,
    });
    assert.deepEqual(validateSync(dto), [], `Accepted cent amount: ${amount}`);
    assert.equal(typeof dto.amount, 'number');
  }
  for (const amount of [10.005, 0.019, '10.005']) {
    const dto = plainToInstance(SaveAccountabilityExpenseDto, {
      ...base,
      amount,
    });
    assert.ok(
      validateSync(dto).some(
        (error) => error.property === 'amount' && error.constraints?.isNumber,
      ),
      `Fractional cent must fail DTO precision validation: ${amount}`,
    );
  }
});

function ownEvidenceFixture(
  options: {
    status?: string;
    createdByUserId?: string;
    accessRules?: AccessRule[];
    linkedOrderId?: string;
  } = {},
) {
  const currentUser = actor('hr', options.accessRules);
  const expense = fixtureExpense(
    options.status,
    options.createdByUserId,
    options.linkedOrderId,
  );
  const user = { ...currentUser, roles: [{ role: { code: 'hr' } }] };
  const file = {
    id: fileId,
    uploadedByUserId: ownerId,
    originalName: 'receipt.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    createdAt: now,
  };
  const draftLookups: unknown[] = [];
  const db = {
    user: { findFirst: async () => user },
    accountabilityAccount: {
      findUnique: async () => ({
        id: 'own-account',
        userId: ownerId,
        status: 'active',
        user,
        createdAt: now,
        updatedAt: now,
        fundings: [],
        expenses: [expense],
        closures: [],
      }),
    },
    accountabilityExpense: {
      findUnique: async () => ({
        oneTimeOrderId: expense.oneTimeOrderId,
        accountabilityAccount: { userId: ownerId },
      }),
      findFirst: async (query: {
        where: {
          id: string;
          createdByUserId: string;
          status: string;
          accountabilityAccount: { userId: string };
        };
      }) => {
        draftLookups.push(query);
        const { where } = query;
        return where.id === expense.id &&
          where.createdByUserId === expense.createdByUserId &&
          where.status === expense.status &&
          where.accountabilityAccount.userId === ownerId
          ? { id: expense.id }
          : null;
      },
    },
    fileAttachment: {
      findMany: async (query: { where: { entityType: string } }) =>
        query.where.entityType === 'accountability_expense'
          ? [{ entityId: expense.id, file }]
          : [],
    },
    oneTimeOrderAssignment: { findFirst: async () => null },
    accountabilityFunding: { findFirst: async () => null },
    oneTimeOrder: {
      findUnique: async () => ({
        id: orderId,
        createdByUserId: otherId,
        assignments: [],
      }),
    },
  };
  return {
    service: new AccountabilityService(db as never, {} as never),
    currentUser,
    draftLookups,
  };
}

test('HR own-created draft exposes actual file metadata without manager eligibility or a read grant', async () => {
  const { service, currentUser, draftLookups } = ownEvidenceFixture();
  const view = await service.getMyAccount(currentUser);
  assert.equal(view.capabilities.canCreateExpense, true);
  assert.equal(view.capabilities.canSubmitExpense, false);
  assert.equal(view.expenses[0].capabilities.canEdit, false);
  assert.deepEqual(view.expenses[0].attachments, [
    {
      id: fileId,
      originalName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 128,
      createdAt: now.toISOString(),
      viewUrl: `/api/v1/files/${fileId}/view`,
      downloadUrl: `/api/v1/files/${fileId}/content?download=1`,
    },
  ]);
  assert.deepEqual(draftLookups, [
    {
      where: {
        id: expenseId,
        createdByUserId: ownerId,
        status: 'draft',
        accountabilityAccount: { userId: ownerId },
      },
      select: { id: true },
    },
  ]);
});

test('own-draft metadata extension does not cover another author or a submitted expense', async () => {
  for (const options of [
    { createdByUserId: otherId },
    { status: 'submitted' },
  ]) {
    const { service, currentUser } = ownEvidenceFixture(options);
    const view = await service.getMyAccount(currentUser);
    assert.deepEqual(view.expenses[0].attachments, [], JSON.stringify(options));
  }
});

test('create, file and linked-order denies still suppress HR own-draft metadata', async () => {
  const scenarios = [
    { accessRules: [deny('accountability.expenses.create')] },
    { accessRules: [deny('files.read')] },
    {
      linkedOrderId: orderId,
      accessRules: [
        {
          actionCode: 'one_time_orders.read',
          effect: 'deny',
          scope: 'selected',
          selectedIds: [orderId],
        } as AccessRule,
      ],
    },
  ];
  for (const options of scenarios) {
    const { service, currentUser } = ownEvidenceFixture(options);
    const view = await service.getMyAccount(currentUser);
    assert.deepEqual(view.expenses[0].attachments, [], JSON.stringify(options));
  }
});

function orderReviewFixture(
  options: {
    accessRules?: AccessRule[];
    ownAccount?: boolean;
    accountStatus?: string;
  } = {},
) {
  // A reviewer without manager role, assignment or historical order receipt.
  const currentUser = actor('director', options.accessRules, [
    'accountability.review',
  ]);
  const expense = fixtureExpense('draft', ownerId, orderId);
  const account = {
    id: 'own-account',
    userId: ownerId,
    status: options.accountStatus ?? 'active',
    user: { ...currentUser, roles: [{ role: { code: 'director' } }] },
    fundings: [],
    expenses: [expense],
  };
  const order = {
    id: orderId,
    title: 'Order review fixture',
    createdByUserId: otherId,
    assignments: [],
    completionPayments: [],
    accountabilityFundings: [],
  };
  const db = {
    oneTimeOrder: {
      findFirst: async () => order,
      findUnique: async () => order,
    },
    oneTimeOrderAssignment: { findFirst: async () => null },
    accountabilityFunding: { findFirst: async () => null },
    accountabilityAccount: {
      findMany: async () => (options.ownAccount === false ? [] : [account]),
    },
    fileAttachment: { findMany: async () => [] },
  };
  return {
    service: new AccountabilityService(db as never, {} as never),
    currentUser,
  };
}

test('order reviewer with active own account can create without gaining submit or payout authority', async () => {
  const { service, currentUser } = orderReviewFixture();
  const view = await service.getOneTimeOrderAccountability(
    currentUser,
    orderId,
  );
  assert.equal(view.capabilities.canCreateExpense, true);
  assert.equal(view.capabilities.canSubmitExpense, false);
  assert.equal(view.capabilities.canCreateEmployeePayout, false);
  assert.equal(view.accounts[0].expenses[0].capabilities.canEdit, false);
});

test('order create capability keeps own-account, active-account and explicit create-deny restrictions', async () => {
  for (const options of [
    { ownAccount: false },
    { accountStatus: 'closing_requested' },
    { accountStatus: 'closed' },
    { accessRules: [deny('accountability.expenses.create')] },
  ]) {
    const { service, currentUser } = orderReviewFixture(options);
    const view = await service.getOneTimeOrderAccountability(
      currentUser,
      orderId,
    );
    assert.equal(
      view.capabilities.canCreateExpense,
      false,
      JSON.stringify(options),
    );
    assert.equal(view.capabilities.canSubmitExpense, false);
  }
});
