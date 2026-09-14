import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMonthlySalaryDailyRate,
  getPlannedWorkingDays,
} from '../src/modules/timesheets/utils/timesheet-rate-policy.util';

test('object monthly salary produces a month-specific day rate for 5/2', () => {
  const january = calculateMonthlySalaryDailyRate({
    monthlySalary: 110_000,
    year: 2026,
    month: 1,
    scheduleCode: '5/2',
  });
  const february = calculateMonthlySalaryDailyRate({
    monthlySalary: 110_000,
    year: 2026,
    month: 2,
    scheduleCode: '5/2',
  });

  assert.equal(january.workingDays, 22);
  assert.equal(january.dailyRate, 5_000);
  assert.equal(february.workingDays, 20);
  assert.equal(february.dailyRate, 5_500);
  assert.notEqual(january.dailyRate, february.dailyRate);
});

test('planned workdays respect the configured weekly schedule', () => {
  assert.equal(getPlannedWorkingDays(2026, 2, '5/2').length, 20);
  assert.equal(getPlannedWorkingDays(2026, 2, '6/1').length, 24);
  assert.equal(getPlannedWorkingDays(2026, 2, '7/0').length, 28);
});

test('zero monthly salary never produces an invalid day rate', () => {
  assert.deepEqual(
    calculateMonthlySalaryDailyRate({
      monthlySalary: 0,
      year: 2026,
      month: 2,
    }),
    {
      dailyRate: 0,
      workingDays: 20,
    },
  );
});
