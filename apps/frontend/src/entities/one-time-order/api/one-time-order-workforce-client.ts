import { fetcher } from '@/shared/api/fetcher';

export interface OneTimeWorkforceEmployee {
  employeeId: string;
  fullName: string;
  position: string | null;
  baseDailyRate: number | null;
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

export function removeOneTimeWorkforceEmployee(
  orderId: string,
  employeeId: string,
): Promise<OneTimeWorkforceEmployee[]> {
  return fetcher(`/one-time-orders/${orderId}/workforce/employees/${employeeId}`, {
    method: 'DELETE',
  });
}

export function getTodayOneTimeAttendance(orderId: string): Promise<OneTimeAttendance> {
  return fetcher(`/one-time-orders/${orderId}/workforce/attendance/today`, { method: 'GET' });
}

export function submitTodayOneTimeAttendance(
  orderId: string,
  employeeIds: string[],
): Promise<OneTimeAttendance> {
  return fetcher(`/one-time-orders/${orderId}/workforce/attendance/today`, {
    method: 'POST',
    body: JSON.stringify({ employeeIds }),
  });
}

export function getOneTimeTimesheet(orderId: string, month: string): Promise<OneTimeTimesheet> {
  return fetcher(`/one-time-orders/${orderId}/workforce/timesheet?month=${encodeURIComponent(month)}`, { method: 'GET' });
}
