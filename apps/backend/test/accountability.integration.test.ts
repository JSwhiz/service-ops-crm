import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

async function cleanupAccountabilityForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const account = await prisma.accountabilityAccount.findUnique({
    where: {
      userId,
    },
    include: {
      fundings: {
        select: {
          id: true,
        },
      },
      expenses: {
        select: {
          id: true,
        },
      },
      closures: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!account) {
    return;
  }

  const fundingIds = account.fundings.map((item) => item.id);
  const expenseIds = account.expenses.map((item) => item.id);
  const closureIds = account.closures.map((item) => item.id);

  if (expenseIds.length > 0) {
    const fileIds = (
      await prisma.fileAttachment.findMany({
        where: {
          entityType: 'accountability_expense',
          entityId: {
            in: expenseIds,
          },
        },
        select: {
          fileId: true,
        },
      })
    ).map((item) => item.fileId);

    await prisma.fileAttachment.deleteMany({
      where: {
        entityType: 'accountability_expense',
        entityId: {
          in: expenseIds,
        },
      },
    });

    if (fileIds.length > 0) {
      await prisma.file.deleteMany({
        where: {
          id: {
            in: fileIds,
          },
        },
      });
    }
  }

  const auditFilters = [];

  if (fundingIds.length > 0) {
    auditFilters.push({
      entityType: 'accountability_funding',
      entityId: {
        in: fundingIds,
      },
    });
  }

  if (expenseIds.length > 0) {
    auditFilters.push({
      entityType: 'accountability_expense',
      entityId: {
        in: expenseIds,
      },
    });
  }

  if (closureIds.length > 0) {
    auditFilters.push({
      entityType: 'accountability_closure',
      entityId: {
        in: closureIds,
      },
    });
  }

  if (auditFilters.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        OR: auditFilters,
      },
    });
  }

  await prisma.accountabilityAccount.delete({
    where: {
      id: account.id,
    },
  });
}

test('accountability ledger supports funding, own expenses, attachments, closure review and visibility rules', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  const manager = await prisma.user.findUniqueOrThrow({
    where: {
      login: 'manager1',
    },
    select: {
      id: true,
    },
  });

  await cleanupAccountabilityForUser(prisma, manager.id);

  t.after(async () => {
    await cleanupAccountabilityForUser(prisma, manager.id);
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'hr1',
      password: 'hr123',
    }),
  ]);

  const hrReviewResponse = await fetch(`${baseUrl}/api/v1/accountability/accounts`, {
    headers: {
      Cookie: hrCookie,
    },
  });

  assert.equal(hrReviewResponse.status, 403);

  const initialOwnResponse = await fetch(`${baseUrl}/api/v1/accountability/me`, {
    headers: {
      Cookie: managerCookie,
    },
  });

  assert.equal(initialOwnResponse.status, 200);

  const initialOwn = (await initialOwnResponse.json()) as {
    account: {
      id: string | null;
      status: string | null;
    };
  };

  assert.equal(initialOwn.account.id, null);
  assert.equal(initialOwn.account.status, null);

  const fundingResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${manager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 5000,
        comment: 'Аванс на хозяйственные расходы',
      }),
    },
  );

  assert.equal(fundingResponse.status, 201);

  const issuedFunding = (await fundingResponse.json()) as {
    amount: number;
  };
  assert.equal(issuedFunding.amount, 5000);

  const managerFundingDeniedResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${manager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 100,
      }),
    },
  );

  assert.equal(managerFundingDeniedResponse.status, 403);

  const ownAfterFundingResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(ownAfterFundingResponse.status, 200);

  const ownAfterFunding = (await ownAfterFundingResponse.json()) as {
    account: {
      id: string;
      status: string;
    };
    summary: {
      totalFunding: number;
      currentBalance: number;
    };
    fundings: Array<{
      amount: number;
      comment: string | null;
    }>;
    capabilities: {
      canCreateExpense: boolean;
    };
  };

  assert.equal(ownAfterFunding.account.status, 'active');
  assert.equal(ownAfterFunding.summary.totalFunding, 5000);
  assert.equal(ownAfterFunding.summary.currentBalance, 5000);
  assert.equal(ownAfterFunding.fundings.length, 1);
  assert.equal(ownAfterFunding.fundings[0]?.comment, 'Аванс на хозяйственные расходы');
  assert.equal(ownAfterFunding.capabilities.canCreateExpense, true);

  const createExpenseResponse = await fetch(`${baseUrl}/api/v1/accountability/me/expenses`, {
    method: 'POST',
    headers: {
      Cookie: managerCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: 1200,
      description: 'Покупка хозяйственных материалов',
    }),
  });

  assert.equal(createExpenseResponse.status, 201);

  const createdExpense = (await createExpenseResponse.json()) as {
    id: string;
    status: string;
    capabilities: {
      canEdit: boolean;
      canSubmit: boolean;
    };
  };

  assert.equal(createdExpense.status, 'draft');
  assert.equal(createdExpense.capabilities.canEdit, true);
  assert.equal(createdExpense.capabilities.canSubmit, true);

  const uploadForm = new FormData();
  uploadForm.set('entityType', 'accountability_expense');
  uploadForm.set('entityId', createdExpense.id);
  uploadForm.set(
    'file',
    new Blob(['expense receipt'], { type: 'text/plain' }),
    'expense-receipt.txt',
  );

  const uploadAttachmentResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: managerCookie,
    },
    body: uploadForm,
  });

  assert.equal(uploadAttachmentResponse.status, 201);

  const ownWithDraftResponse = await fetch(`${baseUrl}/api/v1/accountability/me`, {
    headers: {
      Cookie: managerCookie,
    },
  });

  assert.equal(ownWithDraftResponse.status, 200);

  const ownWithDraft = (await ownWithDraftResponse.json()) as {
    expenses: Array<{
      id: string;
      attachments: Array<{
        originalName: string;
      }>;
    }>;
  };

  const draftExpense = ownWithDraft.expenses.find(
    (expense) => expense.id === createdExpense.id,
  );
  assert.ok(draftExpense);
  assert.equal(draftExpense.attachments.length, 1);
  assert.equal(draftExpense.attachments[0]?.originalName, 'expense-receipt.txt');

  const submitExpenseResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/expenses/${createdExpense.id}/submit`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(submitExpenseResponse.status, 200);

  const requestClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/closures/request`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(requestClosureResponse.status, 201);

  const requestedClosure = (await requestClosureResponse.json()) as {
    id: string;
    status: string;
  };
  assert.equal(requestedClosure.status, 'requested');

  const newExpenseWhileClosingResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 100,
        description: 'Попытка нового расхода во время сверки',
      }),
    },
  );

  assert.equal(newExpenseWhileClosingResponse.status, 409);

  const fundingWhileClosingResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${manager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 500,
      }),
    },
  );

  assert.equal(fundingWhileClosingResponse.status, 409);

  const approveClosureTooEarlyResponse = await fetch(
    `${baseUrl}/api/v1/accountability/closures/${requestedClosure.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(approveClosureTooEarlyResponse.status, 409);

  const rejectClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/closures/${requestedClosure.id}/reject`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'Сначала закройте submitted расход.',
      }),
    },
  );

  assert.equal(rejectClosureResponse.status, 200);

  const ownAfterRejectedClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(ownAfterRejectedClosureResponse.status, 200);

  const ownAfterRejectedClosure = (await ownAfterRejectedClosureResponse.json()) as {
    account: {
      status: string;
    };
    closures: Array<{
      status: string;
      comment: string | null;
    }>;
  };

  assert.equal(ownAfterRejectedClosure.account.status, 'active');
  assert.equal(ownAfterRejectedClosure.closures[0]?.status, 'rejected');
  assert.equal(
    ownAfterRejectedClosure.closures[0]?.comment,
    'Сначала закройте submitted расход.',
  );

  const approveExpenseResponse = await fetch(
    `${baseUrl}/api/v1/accountability/expenses/${createdExpense.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(approveExpenseResponse.status, 200);

  const secondClosureRequestResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/closures/request`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(secondClosureRequestResponse.status, 201);

  const secondClosure = (await secondClosureRequestResponse.json()) as {
    id: string;
    status: string;
  };
  assert.equal(secondClosure.status, 'requested');

  const approveClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/closures/${secondClosure.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(approveClosureResponse.status, 200);

  const finalOwnResponse = await fetch(`${baseUrl}/api/v1/accountability/me`, {
    headers: {
      Cookie: managerCookie,
    },
  });

  assert.equal(finalOwnResponse.status, 200);

  const finalOwn = (await finalOwnResponse.json()) as {
    account: {
      status: string;
    };
    summary: {
      totalFunding: number;
      currentBalance: number;
      totalReconciledExpenses: number;
    };
    expenses: Array<{
      id: string;
      status: string;
      reconciledAt: string | null;
      attachments: Array<{
        originalName: string;
      }>;
    }>;
  };

  assert.equal(finalOwn.account.status, 'active');
  assert.equal(finalOwn.summary.totalFunding, 5000);
  assert.equal(finalOwn.summary.currentBalance, 3800);
  assert.equal(finalOwn.summary.totalReconciledExpenses, 1200);

  const finalExpense = finalOwn.expenses.find(
    (expense) => expense.id === createdExpense.id,
  );
  assert.ok(finalExpense);
  assert.equal(finalExpense.status, 'reconciled');
  assert.notEqual(finalExpense.reconciledAt, null);
  assert.equal(finalExpense.attachments[0]?.originalName, 'expense-receipt.txt');

  const newExpenseAfterApprovedClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 250,
        description: 'Новый расход после подтвержденной сверки',
      }),
    },
  );

  assert.equal(newExpenseAfterApprovedClosureResponse.status, 201);

  const fundingAfterApprovedClosureResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${manager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 700,
        comment: 'Дополнительное пополнение после сверки',
      }),
    },
  );

  assert.equal(fundingAfterApprovedClosureResponse.status, 201);
});
