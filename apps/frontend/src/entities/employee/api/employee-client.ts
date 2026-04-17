import { fetcher } from '@/shared/api/fetcher';

import type {
  EmployeeDetail,
  EmployeeListItem,
  EmployeeObjectOption,
} from '../model/employee.types';

export async function listEmployees(query?: {
  search?: string;
  employmentStatus?: string;
}): Promise<EmployeeListItem[]> {
  const params = new URLSearchParams();

  if (query?.search) {
    params.set('search', query.search);
  }

  if (query?.employmentStatus) {
    params.set('employmentStatus', query.employmentStatus);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return fetcher<EmployeeListItem[]>(`/employees${suffix}`, {
    method: 'GET',
  });
}

export async function listEmployeeObjectCandidates(): Promise<EmployeeObjectOption[]> {
  return fetcher<EmployeeObjectOption[]>('/employees/object-candidates', {
    method: 'GET',
  });
}

export async function getEmployeeById(id: string): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}`, {
    method: 'GET',
  });
}

export async function createEmployee(payload: {
  fullName: string;
  phone?: string;
  residenceAddress?: string;
  shiftPreferences?: string;
  baseDailyRate?: number;
  notes?: string;
  employmentStatus?: string;
}): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>('/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEmployee(
  id: string,
  payload: {
    fullName?: string;
    phone?: string;
    residenceAddress?: string;
    shiftPreferences?: string;
    baseDailyRate?: number;
    notes?: string;
  },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function changeEmployeeStatus(
  id: string,
  employmentStatus: string,
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ employmentStatus }),
  });
}

export async function addEmployeeAvailability(
  id: string,
  payload: {
    startDate: string;
    endDate?: string;
    availabilityStatus: string;
    comment?: string;
  },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/availability`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addEmployeeSubstitution(
  id: string,
  payload: {
    substituteEmployeeId: string;
    objectId?: string;
    startDate: string;
    endDate?: string;
    reason: string;
    comment?: string;
    status?: string;
  },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/substitutions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function assignEmployeeToObject(
  id: string,
  payload: {
    objectId: string;
    startDate?: string;
  },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/object-assignments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function removeEmployeeFromObject(
  id: string,
  objectId: string,
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/object-assignments/${objectId}`, {
    method: 'DELETE',
  });
}
