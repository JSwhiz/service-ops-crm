export const EMPLOYEE_EMPLOYMENT_STATUSES = [
  'active',
  'inactive',
] as const;

export const EMPLOYEE_TYPES = ['regular', 'one_time'] as const;

export const EMPLOYEE_WORK_SCHEDULE_CODES = [
  '5_2',
  '2_2',
  '6_1',
  '7_0',
  '3_1',
  'on_demand',
  'custom',
] as const;

export const EMPLOYEE_AVAILABILITY_STATUSES = [
  'available',
  'unavailable',
] as const;

export const EMPLOYEE_AVAILABILITY_MODES = [
  'full_day',
  'timed',
] as const;

export const EMPLOYEE_SUBSTITUTION_STATUSES = [
  'planned',
  'active',
  'completed',
  'cancelled',
] as const;

export type EmployeeEmploymentStatus =
  (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export type EmployeeWorkScheduleCode =
  (typeof EMPLOYEE_WORK_SCHEDULE_CODES)[number];
export type EmployeeAvailabilityStatus =
  (typeof EMPLOYEE_AVAILABILITY_STATUSES)[number];
export type EmployeeAvailabilityMode =
  (typeof EMPLOYEE_AVAILABILITY_MODES)[number];
export type EmployeeSubstitutionStatus =
  (typeof EMPLOYEE_SUBSTITUTION_STATUSES)[number];
