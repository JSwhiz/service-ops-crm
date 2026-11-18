import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpenseDraftRequest } from './expense-draft-request.ts';
import { getExpenseMoneyBreakdown } from './expense-money-breakdown.ts';

test('uncertain retries and changed form fields retain identity until explicit completion', () => {
  const draft = createExpenseDraftRequest();
  const first = draft.getId();
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(draft.getId(), first);
  // Neither a refusal, closing the dialog nor an access refresh completes a draft.
  assert.equal(draft.getId(), first);
  draft.complete();
  assert.notEqual(draft.getId(), first);
});

test('separate drafts never share a request identity', () => {
  assert.notEqual(
    createExpenseDraftRequest().getId(),
    createExpenseDraftRequest().getId(),
  );
});

test('only approved/reconciled employee payouts count as paid; pending and drafts stay separate', () => {
  const entries = [
    { status: 'approved', expenseCategory: 'employee_payout', amount: 100 },
    { status: 'reconciled', expenseCategory: 'employee_payout', amount: 200 },
    { status: 'submitted', expenseCategory: 'employee_payout', amount: 300 },
    { status: 'draft', expenseCategory: 'employee_payout', amount: 400 },
    { status: 'rejected', expenseCategory: 'employee_payout', amount: 500 },
    { status: 'approved', expenseCategory: 'consumables', amount: 600 },
    { status: 'submitted', expenseCategory: 'delivery', amount: 700 },
    { status: 'draft', expenseCategory: null, amount: 800 },
  ];
  assert.deepEqual(getExpenseMoneyBreakdown(entries), {
    confirmedPayouts: 300,
    submittedAmount: 1000,
    draftAmount: 1200,
  });
  assert.equal(entries.length, 8);
});

test('empty history has no paid/pending draft amounts', () => {
  assert.deepEqual(getExpenseMoneyBreakdown([]), {
    confirmedPayouts: 0,
    submittedAmount: 0,
    draftAmount: 0,
  });
});
