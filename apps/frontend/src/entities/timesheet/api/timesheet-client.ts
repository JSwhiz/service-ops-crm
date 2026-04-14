import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type {
  TimesheetCorrectionItem,
  TimesheetMonth,
} from '../model/timesheet.types';

export async function getTimesheet(params: {
  objectId: string;
  year: number;
  month: number;
}): Promise<TimesheetMonth> {
  const query = new URLSearchParams({
    objectId: params.objectId,
    year: String(params.year),
    month: String(params.month),
  });

  return fetcher<TimesheetMonth>(`/timesheets?${query.toString()}`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function getTimesheetCorrections(params: {
  objectId: string;
  year: number;
  month: number;
}): Promise<TimesheetCorrectionItem[]> {
  const query = new URLSearchParams({
    objectId: params.objectId,
    year: String(params.year),
    month: String(params.month),
  });

  return fetcher<TimesheetCorrectionItem[]>(
    `/timesheets/corrections?${query.toString()}`,
    {
      method: 'GET',
      token: getAccessToken(),
    },
  );
}

export async function upsertTimesheetEntry(payload: {
  objectId: string;
  year: number;
  month: number;
  employeeId: string;
  dayOfMonth: number;
  dayValue: number;
  comment?: string;
}): Promise<TimesheetMonth> {
  return fetcher<TimesheetMonth>('/timesheets/entries', {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}
