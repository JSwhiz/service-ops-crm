export const EMPLOYEE_EMPLOYMENT_STATUSES = [
  'active',
  'inactive',
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
export type EmployeeAvailabilityStatus =
  (typeof EMPLOYEE_AVAILABILITY_STATUSES)[number];
export type EmployeeAvailabilityMode =
  (typeof EMPLOYEE_AVAILABILITY_MODES)[number];
export type EmployeeSubstitutionStatus =
  (typeof EMPLOYEE_SUBSTITUTION_STATUSES)[number];
