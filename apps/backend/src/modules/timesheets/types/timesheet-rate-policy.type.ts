export const TIMESHEET_RATE_POLICY_TYPES = [
  'daily_rate',
  'monthly_fixed',
  'monthly_excluding_holidays',
  'shift_2_2_fixed',
  'shift_2_2_by_actual_shifts',
  'per_attendance',
  'partial_shift',
  'agreed_substitution_rate',
] as const;

export type TimesheetRatePolicyType =
  (typeof TIMESHEET_RATE_POLICY_TYPES)[number];

export const TIMESHEET_RATE_SCHEDULE_CODES = [
  '1/6',
  '2/5',
  '3/4',
  '4/3',
  '5/2',
  '6/1',
  '7/0',
] as const;

export type TimesheetRateScheduleCode =
  (typeof TIMESHEET_RATE_SCHEDULE_CODES)[number];

export const TIMESHEET_RATE_ROUNDING_MODES = ['none', 'nearest_step'] as const;

export type TimesheetRateRoundingMode =
  (typeof TIMESHEET_RATE_ROUNDING_MODES)[number];

export interface TimesheetRatePolicySnapshot {
  ratePolicyType: TimesheetRatePolicyType;
  baseAmount: number;
  scheduleCode: TimesheetRateScheduleCode | null;
  roundingMode: TimesheetRateRoundingMode;
  roundingStep: number | null;
  standardShiftHours: number;
  workingDaysInMonth: number | null;
  excludedHolidayDays: number | null;
  notes: string | null;
}
