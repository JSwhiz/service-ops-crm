import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRussianProductionCalendarVersion,
  getRussianProductionWorkingDays,
  getScheduleConfigurationError,
  isRussianProductionWorkingDay,
} from '../src/modules/timesheets/utils/russian-production-calendar.util';
import { getPlannedWorkingDays } from '../src/modules/timesheets/utils/timesheet-rate-policy.util';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

test('5/2 uses the versioned Russian production calendar, including transfers', () => {
  assert.equal(getRussianProductionCalendarVersion(2026), 'ru-production-2026-v1');
  assert.equal(getRussianProductionWorkingDays(2026, 1).length, 15);
  assert.equal(getRussianProductionWorkingDays(2026, 2).length, 19);
  assert.equal(getRussianProductionWorkingDays(2026, 5).length, 19);
  assert.equal(isRussianProductionWorkingDay(utc('2026-01-09')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2026-02-23')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2026-05-11')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2026-12-31')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2026-05-12')), true);
});

test('2027 production calendar includes the approved working Saturday and transferred days off', () => {
  assert.equal(getRussianProductionCalendarVersion(2027), 'ru-production-2027-v1');
  assert.equal(isRussianProductionWorkingDay(utc('2027-02-20')), true);
  assert.equal(isRussianProductionWorkingDay(utc('2027-02-22')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2027-05-03')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2027-05-10')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2027-06-14')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2027-11-05')), false);
  assert.equal(isRussianProductionWorkingDay(utc('2027-12-31')), false);
});

test('unsupported production-calendar years fail explicitly instead of reverting to weekdays', () => {
  assert.throws(() => getRussianProductionWorkingDays(2028, 1), /2028/);
});

test('cyclic schedules repeat from the declared first workday across month and year boundaries', () => {
  assert.deepEqual(
    getPlannedWorkingDays(2026, 2, '2/5', [], '2026-01-30'),
    [6, 7, 13, 14, 20, 21, 27, 28],
  );
  assert.deepEqual(
    getPlannedWorkingDays(2027, 1, '1/6', [], '2026-12-31'),
    [7, 14, 21, 28],
  );
  assert.deepEqual(
    getPlannedWorkingDays(2026, 1, '3/4', [], '2026-01-12').slice(0, 12),
    [12, 13, 14, 19, 20, 21, 26, 27, 28],
  );
});

test('cycle templates require a start date, while weekday picks remain literal and separate', () => {
  assert.throws(
    () => getPlannedWorkingDays(2026, 2, '6/1'),
    /укажите дату начала цикла/i,
  );
  assert.deepEqual(
    getPlannedWorkingDays(2026, 2, null, ['mon'], '2026-02-01'),
    [2, 9, 16, 23],
  );
  assert.match(
    getScheduleConfigurationError({
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon'],
      scheduleCycleStartDate: null,
    }) ?? '',
    /нельзя/i,
  );
  assert.equal(
    getScheduleConfigurationError({
      scheduleCode: null,
      scheduleWeekdays: ['wed'],
      scheduleCycleStartDate: null,
    }),
    null,
  );
});
