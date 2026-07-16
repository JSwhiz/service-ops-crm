export type OneTimeOrderScheduleConflictType =
  | 'existing_order'
  | 'day_off'
  | 'vacation'
  | 'sick_leave'
  | 'pending_availability_request';

export interface OneTimeOrderScheduleConflictDto {
  date: string;
  user: { id: string; login: string; fullName: string };
  type: OneTimeOrderScheduleConflictType;
  relatedOrder: {
    id: string;
    title: string;
    status: string;
    executionStartDate: string;
    executionEndDate: string;
  } | null;
  detailsRestricted: boolean;
}

export class OneTimeOrderConflictResponseDto {
  hasConflicts!: boolean;
  conflictFingerprint!: string;
  conflicts!: OneTimeOrderScheduleConflictDto[];
}
