import { fetcher } from '@/shared/api/fetcher';

import type {
  EmployeeDetail,
  EmployeeListQuery,
  EmployeeListResponse,
  EmployeeMutationPayload,
  EmployeeObjectReference,
  EmployeeObjectOption,
  EmployeePositionReference,
} from '../model/employee.types';

export async function listEmployees(
  query: EmployeeListQuery = {},
): Promise<EmployeeListResponse> {
  const params = new URLSearchParams();

  if (query.search) {
    params.set('search', query.search);
  }

  if (query.objectId) {
    params.set('objectId', query.objectId);
  }

  if (query.position) {
    params.set('position', query.position);
  }

  if (query.employmentStatus) {
    params.set('employmentStatus', query.employmentStatus);
  }

  if (query.employeeType) {
    params.set('employeeType', query.employeeType);
  }

  if (query.workScheduleCode) {
    params.set('workScheduleCode', query.workScheduleCode);
  }

  if (query.workTimeSearch) {
    params.set('workTimeSearch', query.workTimeSearch);
  }

  if (query.archiveState) {
    params.set('archiveState', query.archiveState);
  }

  if (query.birthMonth) {
    params.set('birthMonth', String(query.birthMonth));
  }

  if (query.hasActiveObjectAssignment !== undefined) {
    params.set(
      'hasActiveObjectAssignment',
      String(query.hasActiveObjectAssignment),
    );
  }

  if (query.sortBy) {
    params.set('sortBy', query.sortBy);
  }

  if (query.sortOrder) {
    params.set('sortOrder', query.sortOrder);
  }

  if (query.page) {
    params.set('page', String(query.page));
  }

  if (query.limit) {
    params.set('limit', String(query.limit));
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return fetcher<EmployeeListResponse>(`/employees${suffix}`, {
    method: 'GET',
  });
}

export async function listEmployeeObjectCandidates(): Promise<EmployeeObjectOption[]> {
  return fetcher<EmployeeObjectOption[]>('/employees/object-candidates', {
    method: 'GET',
  });
}

export async function listEmployeePositionReferences(
  search?: string,
): Promise<EmployeePositionReference[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetcher<EmployeePositionReference[]>(
    `/employees/references/positions${suffix}`,
    { method: 'GET' },
  );
}

export async function listEmployeeObjectReferences(
  search?: string,
): Promise<EmployeeObjectReference[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetcher<EmployeeObjectReference[]>(
    `/employees/references/objects${suffix}`,
    { method: 'GET' },
  );
}

export async function getEmployeeById(id: string): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}`, {
    method: 'GET',
  });
}

export async function createEmployee(
  payload: EmployeeMutationPayload & { fullName: string },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>('/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEmployee(
  id: string,
  payload: EmployeeMutationPayload & { expectedVersion: number },
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function changeEmployeeStatus(
  id: string,
  employmentStatus: string,
  expectedVersion: number,
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ employmentStatus, expectedVersion }),
  });
}

export async function archiveEmployee(
  id: string,
  expectedVersion: number,
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function restoreEmployee(
  id: string,
  expectedVersion: number,
): Promise<EmployeeDetail> {
  return fetcher<EmployeeDetail>(`/employees/${id}/restore`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function addEmployeeAvailability(
  id: string,
  payload: {
    startDate: string;
    endDate?: string;
    availabilityMode: string;
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
