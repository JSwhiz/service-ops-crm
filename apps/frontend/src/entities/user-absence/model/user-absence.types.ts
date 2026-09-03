export type UserAbsenceType = 'vacation' | 'sick_leave' | 'day_off';

export interface UserAbsenceItem {
  id: string;
  userId: string;
  user: { id: string; login: string; fullName: string };
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAbsenceListResponse {
  items: UserAbsenceItem[];
  capabilities: { canViewAll: boolean; canManage: boolean };
}

export interface UserAbsenceUserOption {
  id: string;
  login: string;
  fullName: string;
}
