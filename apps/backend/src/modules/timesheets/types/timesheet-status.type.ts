export const TIMESHEET_MONTH_STATUSES = ['open', 'locked'] as const;
export type TimesheetMonthStatus = (typeof TIMESHEET_MONTH_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'sick',
  'vacation',
  'day_off',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
