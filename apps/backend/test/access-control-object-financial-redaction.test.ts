import assert from 'node:assert/strict';
import test from 'node:test';

import { redactObjectFinancialPayload } from '../src/modules/objects/utils/object-financial-redaction.util';

const payload = {
  note: 'Nonfinancial note', employeeId: 'employee',
  before: { terms: { baseAmount: 73103 }, dailyRate: 73104, monthlyBudget: 84203,
    monthlyAmount: 84204, allocations: [{ employeeId: 'employee', amount: 84205 }],
    amount: 95303, contractAmount: 96403, comment: 'before-comment' },
  after: [{ ratePolicySnapshot: { baseAmount: 73105 }, teamFunds: [{ monthlyAmount: 84206 }],
    difference: 95304, contractMonthlyAmount: 96404, comment: 'after-comment' }],
  changes: [{ nested: { policySnapshot: { baseAmount: 73106 }, budgets: [{ actualAmount: 84207 }],
    amount: 95305, contractAmount: 96405, reason: 'unchanged reason' } }],
};
type Payload = typeof payload;
const clone = () => structuredClone(payload);
const redact = (flags: { rates: boolean; budget: boolean; contract: boolean }) => redactObjectFinancialPayload(clone(), flags) as Payload;

test('financial redaction returns a deep copy and preserves original nested arrays/snapshots', () => {
  const original = clone();
  const before = structuredClone(original);
  const result = redactObjectFinancialPayload(original, { rates: true, budget: true, contract: true }) as Payload;
  assert.deepEqual(result, before);
  assert.notEqual(result, original);
  assert.notEqual(result.before, original.before);
  assert.notEqual(result.after, original.after);
  assert.notEqual(result.changes[0].nested, original.changes[0].nested);
  result.before.terms.baseAmount = 1;
  result.after[0].comment = 'local mutation';
  assert.deepEqual(original, before);
});

test('rates deny omits nested rate-policy/generic money but keeps independently readable budgets/contracts', () => {
  const result = redact({ rates: false, budget: true, contract: true });
  assert.deepEqual(result.before, { monthlyBudget: 84203, monthlyAmount: 84204,
    allocations: [{ employeeId: 'employee' }], contractAmount: 96403, comment: 'before-comment' });
  assert.deepEqual(result.after, [{ teamFunds: [{ monthlyAmount: 84206 }], contractMonthlyAmount: 96404, comment: 'after-comment' }]);
  assert.deepEqual(result.changes, [{ nested: { budgets: [{ actualAmount: 84207 }], contractAmount: 96405, reason: 'unchanged reason' } }]);
  assert.equal(JSON.stringify(result).includes('7310'), false);
  assert.equal(JSON.stringify(result).includes('9530'), false);
});

test('budget deny omits nested team allocations/generic money but keeps independently readable rates/contracts', () => {
  const result = redact({ rates: true, budget: false, contract: true });
  assert.deepEqual(result.before, { terms: { baseAmount: 73103 }, dailyRate: 73104, contractAmount: 96403, comment: 'before-comment' });
  assert.deepEqual(result.after, [{ ratePolicySnapshot: { baseAmount: 73105 }, contractMonthlyAmount: 96404, comment: 'after-comment' }]);
  assert.deepEqual(result.changes, [{ nested: { policySnapshot: { baseAmount: 73106 }, contractAmount: 96405, reason: 'unchanged reason' } }]);
  assert.equal(JSON.stringify(result).includes('8420'), false);
  assert.equal(JSON.stringify(result).includes('9530'), false);
});

test('contract deny is independent: keep allowed rate/budget/amount values at every depth', () => {
  const result = redact({ rates: true, budget: true, contract: false });
  assert.equal(JSON.stringify(result).includes('9640'), false);
  assert.deepEqual(result.before.terms, payload.before.terms);
  assert.deepEqual(result.before.allocations, payload.before.allocations);
  assert.equal(result.before.amount, 95303);
  assert.equal(result.after[0].difference, 95304);
  assert.equal(result.changes[0].nested.amount, 95305);
});

test('all financial denies omit values rather than manufacturing zero; preserve plain domain data', () => {
  const original = clone();
  const result = redactObjectFinancialPayload(original, { rates: false, budget: false, contract: false });
  assert.deepEqual(result, { note: payload.note, employeeId: 'employee', before: { comment: 'before-comment' },
    after: [{ comment: 'after-comment' }], changes: [{ nested: { reason: 'unchanged reason' } }] });
  assert.deepEqual(original, payload);
  assert.equal(redactObjectFinancialPayload(null, { rates: false, budget: false, contract: false }), null);
  assert.equal(redactObjectFinancialPayload('plain', { rates: false, budget: false, contract: false }), 'plain');
});

test('base rounding difference is financial even inside generic nested before/after history', () => {
  const original = { before: [{ baseRoundingDifference: 97831, note: 'keep' }], after: { nested: { baseRoundingDifference: -97832 } } };
  assert.deepEqual(redactObjectFinancialPayload(original, { rates: true, budget: true, contract: true }), original);
  for (const visibility of [
    { rates: false, budget: true, contract: true },
    { rates: true, budget: false, contract: true },
  ]) assert.deepEqual(redactObjectFinancialPayload(original, visibility), {
    before: [{ note: 'keep' }], after: { nested: {} },
  });
  assert.equal(original.before[0].baseRoundingDifference, 97831);
});
