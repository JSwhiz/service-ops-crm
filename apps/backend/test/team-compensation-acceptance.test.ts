import assert from 'node:assert/strict';
import test from 'node:test';

import { positionNormDays, salaryHalf, salaryNormDays } from '../src/modules/object-scheduling/compensation-calculation';
import type { ScheduleRevisionView } from '../src/modules/object-scheduling/scheduling.types';
import type { TimesheetRatePolicySnapshot } from '../src/modules/timesheets/types/timesheet-rate-policy.type';
import { parseRatePolicySnapshot } from '../src/modules/timesheets/utils/timesheet-rate-policy.util';

// Independent monetary oracles: approved contract 2026-11-03, GP-PAY-001.
// These are literal business examples, not values calculated with a second
// copy of the production algorithm. March 2026 has 10/12 Mon–Fri dates.
const cases = [
  { name: 'approved partial month', monthly: 20_000, norms: [10, 12], paid: [5, 12], expected: [5_000, 10_000] },
  { name: 'full month with different norms', monthly: 20_000, norms: [10, 12], paid: [10, 12], expected: [10_000, 10_000] },
  { name: 'odd full salary keeps its last ruble', monthly: 20_001, norms: [10, 12], paid: [10, 12], expected: [10_001, 10_000] },
  { name: 'one ruble is conserved', monthly: 1, norms: [2, 3], paid: [2, 3], expected: [1, 0] },
  { name: 'round only the final proportion', monthly: 20_000, norms: [3, 7], paid: [2, 5], expected: [6_667, 7_143] },
  { name: 'no paid days creates no redistributed salary', monthly: 20_000, norms: [10, 12], paid: [0, 0], expected: [0, 0] },
] as const;

for (const example of cases) {
  test(`contract money: ${example.name}`, () => {
    const first = salaryHalf(example.monthly, 1, example.norms[0], example.paid[0]);
    const second = salaryHalf(example.monthly, 2, example.norms[1], example.paid[1]);
    assert.deepEqual([first.amount, second.amount], example.expected);
    assert.equal(first.unavailableReason, null);
    assert.equal(second.unavailableReason, null);
    if (example.paid[0] === example.norms[0] && example.paid[1] === example.norms[1]) {
      assert.equal(first.amount! + second.amount!, example.monthly);
    }
  });
}

test('missing or zero required norm is unavailable, including when attendance is empty', () => {
  for (const norm of [null, 0]) for (const paid of [0, 1]) {
    const result = salaryHalf(20_000, 1, norm, paid);
    assert.equal(result.amount, null, `norm=${norm}, paid=${paid}: must not present a false zero`);
    assert.ok(result.unavailableReason?.trim());
  }
});

function monthlyPolicy(): TimesheetRatePolicySnapshot {
  return {
    ratePolicyType: 'monthly_fixed', baseAmount: 20_000,
    scheduleCode: null, scheduleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    roundingMode: 'none', roundingStep: null, standardShiftHours: 8,
    workingDaysInMonth: null, excludedHolidayDays: null, notes: null,
  };
}

test('a missing salary schedule is reported instead of guessing a weekday calendar', () => {
  const result = salaryNormDays({ ...monthlyPolicy(), scheduleWeekdays: [] }, 2026, 3);
  assert.deepEqual(result.days, []);
  assert.ok(result.reason?.trim());
});

function revision(): ScheduleRevisionView {
  return {
    id: 'revision', version: 1, name: 'Position', headcount: 3,
    requiredPerShift: 1, archived: false, effectiveFrom: '2026-03-09',
    createdAt: '2026-03-09T00:00:00.000Z', createdByUserId: 'author',
    template: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] },
    groups: [{ key: 'A', name: 'Day', offsetDays: 0,
      assignments: [{ employeeId: 'hired-mid-period', from: '2026-03-09' }],
      timeRanges: [{ key: 'day', start: '08:00', end: '16:00', endDayOffset: 0, contourId: 'salary' }],
    }],
  };
}

test('hire/assignment on March 9 does not shorten the full-half 10/12 norm', () => {
  const result = positionNormDays(revision(), 'salary', 2026, 3);
  assert.equal(result.reason, null);
  assert.deepEqual(result.days.filter(day => day <= 15), [2, 3, 4, 5, 6, 9, 10, 11, 12, 13]);
  assert.deepEqual(result.days.filter(day => day > 15), [16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30, 31]);
  assert.equal(salaryHalf(20_000, 1, result.days.filter(day => day <= 15).length, 5).amount, 5_000);
});

test('rotation groups and roster headcount do not multiply the monthly position pool', () => {
  const one = revision();
  const many = revision();
  many.headcount = 50;
  many.groups.push({ ...many.groups[0], key: 'B', name: 'Second rotation',
    assignments: [{ employeeId: 'other-employee', from: '2026-03-01' }],
  });
  assert.deepEqual(positionNormDays(many, 'salary', 2026, 3), positionNormDays(one, 'salary', 2026, 3));
});

test('two time ranges in one employee/day/contour do not double the salary norm', () => {
  const split = revision();
  split.groups[0].assignments = [{ employeeId: 'same-worker-all-month', from: '2026-03-01' }];
  split.groups[0].timeRanges = [
    { key: 'morning', start: '08:00', end: '12:00', endDayOffset: 0, contourId: 'salary' },
    { key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: 'salary' },
  ];
  const days = positionNormDays(split, 'salary', 2026, 3);
  assert.equal(days.reason, null);
  assert.equal(days.days.filter(day => day <= 15).length, 10);
  assert.equal(days.days.filter(day => day > 15).length, 12);
  assert.deepEqual([
    salaryHalf(20_000, 1, days.days.filter(day => day <= 15).length, 10).amount,
    salaryHalf(20_000, 2, days.days.filter(day => day > 15).length, 12).amount,
  ], [10_000, 10_000]);
});

test('distinct employees cover two nonoverlapping ranges at requiredPerShift one: two payable units per date', () => {
  const split = revision();
  split.groups = [
    { key: 'morning', name: 'Morning', offsetDays: 0, assignments: [{ employeeId: 'first', from: '2026-03-01' }],
      timeRanges: [{ key: 'morning', start: '08:00', end: '12:00', endDayOffset: 0, contourId: 'salary' }] },
    { key: 'afternoon', name: 'Afternoon', offsetDays: 0, assignments: [{ employeeId: 'second', from: '2026-03-01' }],
      timeRanges: [{ key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: 'salary' }] },
  ];
  const distinct = positionNormDays(split, 'salary', 2026, 3);
  assert.equal(distinct.reason, null);
  assert.equal(distinct.days.filter(day => day === 2).length, 2);
  assert.equal(distinct.days.filter(day => day <= 15).length, 20);
  assert.equal(distinct.days.filter(day => day > 15).length, 24);
  split.groups[1].assignments = [{ employeeId: 'first', from: '2026-03-01' }];
  const same = positionNormDays(split, 'salary', 2026, 3);
  assert.equal(same.days.filter(day => day === 2).length, 1);
  assert.equal(same.days.filter(day => day <= 15).length, 10);
  assert.equal(same.days.filter(day => day > 15).length, 12);
});

test('dated morning/afternoon handoffs remain unambiguous with two payable units throughout both full halves', () => {
  const plan = revision();
  plan.requiredPerShift = 1;
  plan.template = { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  plan.groups = [
    { key: 'morning', name: 'Morning handoff', offsetDays: 0, assignments: [
      { employeeId: 'A', from: '2026-03-01', to: '2026-03-15' },
      { employeeId: 'B', from: '2026-03-16', to: '2026-03-31' },
    ], timeRanges: [{ key: 'morning', start: '08:00', end: '12:00', endDayOffset: 0, contourId: 'salary' }] },
    { key: 'afternoon', name: 'Afternoon handoff', offsetDays: 0, assignments: [
      { employeeId: 'C', from: '2026-03-01', to: '2026-03-15' },
      { employeeId: 'A', from: '2026-03-16', to: '2026-03-31' },
    ], timeRanges: [{ key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: 'salary' }] },
  ];
  const norm = positionNormDays(plan, 'salary', 2026, 3);
  assert.equal(norm.reason, null, 'A moves between ranges on March 16; A is never an ambiguous simultaneous candidate');
  for (let day = 1; day <= 31; day++) assert.equal(norm.days.filter(item => item === day).length, 2, `March ${day}: two distinct paid workers`);
  // The saved revision starts March 9, but the denominator remains the full
  // half rather than shrinking to the revision or an individual hire period.
  assert.deepEqual([norm.days.filter(day => day <= 15).length, norm.days.filter(day => day > 15).length], [30, 32]);
});

test('ambiguous bench across ranges is unavailable regardless of lexical employee UUID or roster order', () => {
  // Each interval needs one person. Its two-person bench does not identify who
  // covers it. B could cover both ranges (one paid unit), or A/C could cover
  // separate ranges (two). UUID ordering cannot choose between those outcomes.
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const third = '33333333-3333-4333-8333-333333333333';
  for (const [a, b, c] of [[first, second, third], [third, first, second]]) {
    for (const reverse of [false, true]) {
      const plan = revision();
      plan.requiredPerShift = 1;
      plan.groups = [
        { key: 'morning', name: 'Morning bench', offsetDays: 0,
          assignments: [a, b].map(employeeId => ({ employeeId, from: '2026-03-01' })),
          timeRanges: [{ key: 'morning', start: '08:00', end: '12:00', endDayOffset: 0, contourId: 'salary' }] },
        { key: 'afternoon', name: 'Afternoon bench', offsetDays: 0,
          assignments: [b, c].map(employeeId => ({ employeeId, from: '2026-03-01' })),
          timeRanges: [{ key: 'afternoon', start: '12:00', end: '16:00', endDayOffset: 0, contourId: 'salary' }] },
      ];
      if (reverse) {
        plan.groups.reverse();
        for (const group of plan.groups) group.assignments.reverse();
      }
      const result = positionNormDays(plan, 'salary', 2026, 3);
      assert.ok(result.reason?.trim(), 'ambiguous financial ownership requires an explicit unavailable reason');
      assert.deepEqual(result.days, [], 'do not expose a guessed denominator derived from employee IDs');
    }
  }
});

test('a legacy snapshot is not promoted into the new compensation policy on read', () => {
  const stored = { ...monthlyPolicy(), scheduleCode: '5/2', scheduleWeekdays: [] };
  const before = JSON.stringify(stored);
  const parsed = parseRatePolicySnapshot(stored);
  assert.ok(parsed);
  assert.equal(parsed.calculationVersion, undefined);
  assert.equal(parsed.compensationVersionId, undefined);
  assert.equal(parsed.productionCalendarVersion, 'legacy-weekdays');
  assert.equal(JSON.stringify(stored), before);
});
