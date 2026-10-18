import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMonthlySalaryDailyRate,
  calculateTimesheetAutoValues,
  getPlannedWorkingDays,
  parseRatePolicySnapshot,
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

  assert.equal(january.workingDays, 15);
  assert.equal(january.dailyRate, 7_333);
  assert.equal(february.workingDays, 19);
  assert.equal(february.dailyRate, 5_789);
  assert.notEqual(january.dailyRate, february.dailyRate);
});

test('planned workdays respect the configured weekly schedule', () => {
  assert.equal(getPlannedWorkingDays(2026, 2, '5/2').length, 19);
  assert.equal(getPlannedWorkingDays(2026, 2, '6/1', [], '2000-01-03').length, 24);
  assert.equal(getPlannedWorkingDays(2026, 2, '7/0', [], '2000-01-03').length, 28);
});

test('custom weekdays count the actual dates in the selected month', () => {
  assert.deepEqual(
    getPlannedWorkingDays(2026, 2, '5/2', ['mon']),
    [2, 9, 16, 23],
  );
  assert.equal(getPlannedWorkingDays(2026, 2, '5/2', ['mon', 'wed']).length, 8);
  assert.equal(
    calculateMonthlySalaryDailyRate({
      monthlySalary: 80_000,
      year: 2026,
      month: 2,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    }).dailyRate,
    10_000,
  );
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
    26_316,
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

test('legacy snapshots keep their previous weekday interpretation; new calculations pin the calendar version', () => {
  const legacy = parseRatePolicySnapshot({
    ratePolicyType: 'monthly_fixed',
    baseAmount: 100_000,
    scheduleCode: '5/2',
    scheduleWeekdays: [],
    roundingMode: 'none',
    roundingStep: null,
    standardShiftHours: 8,
    workingDaysInMonth: null,
    excludedHolidayDays: null,
    notes: null,
  });
  assert.equal(legacy?.productionCalendarVersion, 'legacy-weekdays');
  assert.equal(
    getPlannedWorkingDays(
      2026,
      2,
      legacy?.scheduleCode ?? null,
      legacy?.scheduleWeekdays ?? [],
      legacy?.scheduleCycleStartDate,
      legacy?.productionCalendarVersion ?? null,
    ).length,
    20,
  );

  const calculated = calculateTimesheetAutoValues({
    year: 2026,
    month: 2,
    daysInMonth: 28,
    policy: {
      ratePolicyType: 'monthly_fixed',
      baseAmount: 100_000,
      scheduleCode: '5/2',
      scheduleWeekdays: [],
      roundingMode: 'none',
      roundingStep: null,
      standardShiftHours: 8,
      workingDaysInMonth: null,
      excludedHolidayDays: null,
      notes: null,
    },
    facts: [{
      dayOfMonth: 2,
      dailyRateSnapshot: 0,
      workedHours: null,
      ratePolicySnapshot: null,
    }],
  });
  assert.equal([...calculated.values()][0]?.ratePolicySnapshot.productionCalendarVersion, 'ru-production-2026-v1');
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
