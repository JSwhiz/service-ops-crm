import assert from 'node:assert/strict';
import test from 'node:test';
import { createPayloadForAccess, projectCreatePositions } from './object-create-access.ts';
import { setupDraft, setupPayload } from '../../object-setup/model/setup-draft.ts';

const position = (key, contourId, employeeIds) => ({ key, groups: [{ key: 'g', intervals: [{ contourId }], assignments: employeeIds.map(employeeId => ({ employeeId })) }] });

test('preserves authorized positions and removes only denied employee assignments without mutating drafts', () => {
  const draft = [position('a', null, ['allow', 'deny'])];
  const before = structuredClone(draft);
  const result = projectCreatePositions(draft, { schedule: true, contours: false, selectPayConditions: false, employees: { allow: true, deny: false } });
  assert.deepEqual(result.positions[0].groups[0].assignments, [{ employeeId: 'allow' }]);
  assert.equal(result.omittedAssignments, 1);
  assert.equal(result.omittedPositions, 0);
  assert.deepEqual(draft, before);
});

test('never emits dangling contour references and preserves unrelated positions', () => {
  const draft = [position('plain', null, []), position('bound', 'draft:night', [])];
  for (const access of [
    { schedule: true, contours: false, selectPayConditions: true, employees: {} },
    { schedule: true, contours: true, selectPayConditions: false, employees: {} },
  ]) {
    const result = projectCreatePositions(draft, access);
    assert.deepEqual(result.positions.map((row) => row.key), ['plain']);
    assert.equal(result.omittedPositions, 1);
  }
  assert.equal(projectCreatePositions(draft, { schedule: false, contours: true, selectPayConditions: true, employees: {} }).omittedPositions, 2);
});

test('base-only creation omits every unauthorized group without evaluating it', () => {
  const never = () => { throw new Error('unauthorized group evaluated'); };
  const base = { name: 'Test', address: 'Test address', status: 'active' };
  const payload = createPayloadForAccess(base,
    { rates: false, materials: false, setup: false, contours: false, positions: false, counterparty: false },
    { rates: never, materials: never, setup: never, contours: never, positions: never, counterparty: never });
  assert.deepEqual(payload, base);
  assert.equal(JSON.stringify(payload).includes('dailyRate'), false);
});

test('independent allowed groups retain explicit zero, null and empty values', () => {
  const base = { name: 'Test', address: 'Test address', status: 'active' };
  const groups = { rates: () => ({ dailyRate: 0, seasonMode: null }), materials: () => ({ instructionSteps: [] }),
    setup: () => ({ setup: { budgets: [] } }), contours: () => ({ payContours: [] }),
    positions: () => ({ staffingPositions: [] }), counterparty: () => ({ counterpartyId: 'id' }) };
  const payload = createPayloadForAccess(base,
    { rates: true, materials: true, setup: false, contours: false, positions: false, counterparty: false }, groups);
  assert.deepEqual(payload, { ...base, dailyRate: 0, seasonMode: null, instructionSteps: [] });
});

test('denied setup fields are omitted while private budget draft remains unchanged for regrant', () => {
  const draft = setupDraft();
  draft.budgets.push({ category: 'taxi', amount: '42', period: 'monthly', monthlyAllocation: null, plannedOccurrences: '', notes: '', targetMonth: '', label: '' });
  const access = { canEditCore: true, canViewContractAmount: false, canEditContractAmount: false, canViewBudgets: false, canEditBudgets: false, canViewCoefficient: false, canEditCoefficient: false };
  const withoutBudget = setupPayload(draft, access);
  assert.equal('budgets' in withoutBudget, false);
  assert.equal('coefficient' in withoutBudget, false);
  assert.equal('contractMonthlyAmount' in withoutBudget, false);
  assert.equal(draft.budgets[0].amount, '42');
  assert.equal(setupPayload(draft, { ...access, canEditBudgets: true }).budgets[0].amount, 42);
});
