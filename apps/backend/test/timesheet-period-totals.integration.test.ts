import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateTimesheetPeriodTotals } from '../src/modules/timesheets/utils/timesheet-totals.util';

test('timesheet period totals use final values and calendar half-month boundaries', () => {
  assert.deepEqual(calculateTimesheetPeriodTotals([]), {
    advanceTotal: 0,
    salaryTotal: 0,
    monthTotal: 0,
  });

  const totals = calculateTimesheetPeriodTotals([
    { dayOfMonth: 1, finalValue: 100 },
    { dayOfMonth: 12, finalValue: 350 },
    { dayOfMonth: 15, finalValue: 150 },
    { dayOfMonth: 16, finalValue: 160 },
    { dayOfMonth: 22, finalValue: 420 },
    { dayOfMonth: 28, finalValue: 280 },
    { dayOfMonth: 29, finalValue: 290 },
    { dayOfMonth: 31, finalValue: 310 },
  ]);

  assert.equal(totals.advanceTotal, 600);
  assert.equal(totals.salaryTotal, 1460);
  assert.equal(totals.monthTotal, 2060);
  assert.equal(totals.advanceTotal + totals.salaryTotal, totals.monthTotal);
});
