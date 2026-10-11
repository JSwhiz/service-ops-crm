import { fetcher } from '@/shared/api/fetcher';
import { refreshSession } from '@/shared/auth/auth-session';
import { appConfig } from '@/shared/config/app-config';

export interface OneTimeWorkforceEmployee {
  employeeId: string;
  fullName: string;
  position: string | null;
  baseDailyRate: number | null;
  orderPayment: number | null;
  isActive: boolean;
  assignedAt: string;
  removedAt: string | null;
}

export interface OneTimeEmployeeDirectoryItem {
  id: string;
  fullName: string;
  position: string | null;
  baseDailyRate: number | null;
}

export interface OneTimeAttendance {
  operationDate: string;
  workCycle: number;
  submittedAt: string | null;
  submittedBy: { id: string; fullName: string } | null;
  employees: Array<OneTimeWorkforceEmployee & {
    present: boolean;
    rateSnapshot: number | null;
    finalValue: number | null;
  }>;
}

export interface OneTimeAttendanceCoverage {
  workCycle: number;
  startDate: string | null;
  endDate: string | null;
  missingDates: string[];
  history: Array<{
    operationDate: string;
    action: string;
    at: string;
    actor: string;
    reason: string | null;
    presentEmployees: string[];
    previousPresentEmployees: string[];
  }>;
  days: Array<{
    operationDate: string;
    hasAttendance: boolean;
    submittedAt: string | null;
    submittedBy: { id: string; fullName: string } | null;
    presentEmployeeCount: number;
    employeeCount: number;
  }>;
}

export interface OneTimeTimesheet {
  oneTimeOrderId: string;
  workCycle: number;
  month: string;
  rows: Array<{
    employeeId: string;
    fullName: string;
    days: Array<{
      operationDate: string;
      present: boolean;
      rateSnapshot: number;
      automaticValue: number;
      finalValue: number;
      manualOverride: boolean;
      manualReason: string | null;
    }>;
    total: number;
  }>;
}

export function listOneTimeWorkforce(orderId: string): Promise<OneTimeWorkforceEmployee[]> {
  return fetcher(`/one-time-orders/${orderId}/workforce/employees`, { method: 'GET' });
}

export function listOneTimeWorkforceDirectory(
  orderId: string,
  search = '',
): Promise<OneTimeEmployeeDirectoryItem[]> {
  const suffix = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return fetcher(`/one-time-orders/${orderId}/workforce/employee-directory${suffix}`, { method: 'GET' });
}

export function addOneTimeWorkforceEmployee(
  orderId: string,
  employeeId: string,
): Promise<OneTimeWorkforceEmployee[]> {
  return fetcher(`/one-time-orders/${orderId}/workforce/employees`, {
    method: 'POST',
    body: JSON.stringify({ employeeId }),
  });
}

export function updateOneTimeWorkforceEmployeePayment(
  orderId: string,
  employeeId: string,
  amount: number | null,
): Promise<OneTimeWorkforceEmployee[]> {
  return fetcher(
    `/one-time-orders/${orderId}/workforce/employees/${employeeId}/payment`,
    {
      method: 'PATCH',
      body: JSON.stringify({ amount }),
    },
  );
}

export function removeOneTimeWorkforceEmployee(
  orderId: string,
  employeeId: string,
): Promise<OneTimeWorkforceEmployee[]> {
  return fetcher(`/one-time-orders/${orderId}/workforce/employees/${employeeId}`, {
    method: 'DELETE',
  });
}

export function getTodayOneTimeAttendance(orderId: string, date?: string): Promise<OneTimeAttendance> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  return fetcher(`/one-time-orders/${orderId}/workforce/attendance/today${suffix}`, { method: 'GET' });
}

export function getOneTimeAttendanceCoverage(orderId: string): Promise<OneTimeAttendanceCoverage> {
  return fetcher(`/one-time-orders/${orderId}/workforce/attendance/coverage`, { method: 'GET' });
}

export function submitTodayOneTimeAttendance(
  orderId: string,
  employeeIds: string[],
  operationDate?: string,
  correctionReason?: string,
): Promise<OneTimeAttendance> {
  return fetcher(`/one-time-orders/${orderId}/workforce/attendance/today`, {
    method: 'POST',
    body: JSON.stringify({ employeeIds, operationDate, correctionReason }),
  });
}

export function getOneTimeTimesheet(orderId: string, month: string): Promise<OneTimeTimesheet> {
  return fetcher(`/one-time-orders/${orderId}/workforce/timesheet?month=${encodeURIComponent(month)}`, { method: 'GET' });
}

export async function downloadOneTimeWorkforceExcel(params: {
  orderId: string;
  month: string;
  employeeId?: string;
}): Promise<Blob> {
  const query = new URLSearchParams({ month: params.month });
  if (params.employeeId) query.set('employeeId', params.employeeId);
  const path = `/one-time-orders/${params.orderId}/workforce/timesheet/export.xlsx?${query.toString()}`;
  const request = (): Promise<Response> => fetch(`${appConfig.apiUrl}${path}`, {
    method: 'GET', credentials: 'include', cache: 'no-store',
  });
  let response = await request();
  if (response.status === 401 && await refreshSession()) response = await request();
  if (!response.ok) throw new Error(`Не удалось скачать табель (${response.status}).`);
  return response.blob();
}
