import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMonthlySalaryDailyRate,
  calculateTimesheetAutoValues,
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


test('monthly fixed salary is prorated by actual attendance facts', () => {
  const calculated = calculateTimesheetAutoValues({
    year: 2026,
    month: 2,
    daysInMonth: 28,
    policy: {
      ratePolicyType: 'monthly_fixed',
      baseAmount: 100_000,
      scheduleCode: '5/2',
      roundingMode: 'none',
      roundingStep: null,
      standardShiftHours: 8,
      workingDaysInMonth: null,
      excludedHolidayDays: null,
      notes: null,
    },
    facts: [3, 4, 5, 6, 9].map((dayOfMonth) => ({
      dayOfMonth,
      dailyRateSnapshot: 5_000,
      workedHours: 8,
      ratePolicySnapshot: null,
    })),
  });

  assert.equal(
    [...calculated.values()].reduce((sum, item) => sum + item.autoValue, 0),
    25_000,
  );
  assert.equal(calculated.size, 5);
});

test('monthly fixed salary is zero without attendance facts', () => {
  const calculated = calculateTimesheetAutoValues({
    year: 2026,
    month: 2,
    daysInMonth: 28,
    policy: {
      ratePolicyType: 'monthly_fixed',
      baseAmount: 100_000,
      scheduleCode: '5/2',
      roundingMode: 'none',
      roundingStep: null,
      standardShiftHours: 8,
      workingDaysInMonth: null,
      excludedHolidayDays: null,
      notes: null,
    },
    facts: [],
  });

  assert.equal(calculated.size, 0);
});


test('fixed monthly salary does not exceed the configured monthly amount', () => {
  const facts = Array.from({ length: 28 }, (_unused, index) => ({
    dayOfMonth: index + 1,
    dailyRateSnapshot: 5_000,
    workedHours: 8,
    ratePolicySnapshot: null,
  }));
  const calculated = calculateTimesheetAutoValues({
    year: 2026,
    month: 2,
    daysInMonth: 28,
    policy: {
      ratePolicyType: 'monthly_fixed',
      baseAmount: 100_000,
      scheduleCode: '5/2',
      roundingMode: 'none',
      roundingStep: null,
      standardShiftHours: 8,
      workingDaysInMonth: null,
      excludedHolidayDays: null,
      notes: null,
    },
    facts,
  });

  assert.equal(
    [...calculated.values()].reduce((sum, item) => sum + item.autoValue, 0),
    100_000,
  );
});
