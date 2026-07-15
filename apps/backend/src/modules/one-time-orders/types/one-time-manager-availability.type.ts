export const ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES = [
  'day_off',
  'vacation',
  'sick_leave',
] as const;

export type OneTimeManagerAvailabilityEntryType =
  (typeof ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES)[number];

export const ONE_TIME_MANAGER_AVAILABILITY_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type OneTimeManagerAvailabilityStatus =
  (typeof ONE_TIME_MANAGER_AVAILABILITY_STATUSES)[number];
