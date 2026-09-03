import { fetcher } from '@/shared/api/fetcher';

import type {
  UserAbsenceItem,
  UserAbsenceListResponse,
  UserAbsenceType,
  UserAbsenceUserOption,
} from '../model/user-absence.types';

export async function listUserAbsences(params: {
  from?: string;
  to?: string;
  userId?: string;
  absenceType?: UserAbsenceType;
} = {}): Promise<UserAbsenceListResponse> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.userId) query.set('userId', params.userId);
  if (params.absenceType) query.set('absenceType', params.absenceType);
  const suffix = query.toString();
  return fetcher<UserAbsenceListResponse>(`/user-absences${suffix ? `?${suffix}` : ''}`, { method: 'GET' });
}

export async function listUserAbsenceUsers(): Promise<UserAbsenceUserOption[]> {
  return fetcher<UserAbsenceUserOption[]>('/user-absences/users', { method: 'GET' });
}

export async function createUserAbsence(payload: {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment?: string | null;
}): Promise<UserAbsenceItem> {
  return fetcher<UserAbsenceItem>('/user-absences', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUserAbsence(id: string, payload: {
  absenceType?: UserAbsenceType;
  startDate?: string;
  endDate?: string;
  comment?: string | null;
}): Promise<UserAbsenceItem> {
  return fetcher<UserAbsenceItem>(`/user-absences/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteUserAbsence(id: string): Promise<void> {
  await fetcher(`/user-absences/${id}`, { method: 'DELETE' });
}
