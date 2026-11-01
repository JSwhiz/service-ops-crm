import type { UserAbsenceType } from '@/entities/user-absence/model/user-absence.types';

export interface UserAbsenceCreateValues {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string;
}

export function toCreateUserAbsencePayload(
  value: UserAbsenceCreateValues,
  access: { canManageAll: boolean; canViewPrivateReasons: boolean; currentUserId?: string },
): {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string | null;
} {
  const mayIncludeComment = value.userId === access.currentUserId || access.canViewPrivateReasons;
  return {
    userId: access.canManageAll ? value.userId : access.currentUserId ?? value.userId,
    absenceType: value.absenceType,
    startDate: value.startDate,
    endDate: value.endDate,
    comment: mayIncludeComment ? value.comment || null : null,
  };
}
