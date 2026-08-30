import { fetcher } from '@/shared/api/fetcher';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import { appConfig } from '@/shared/config/app-config';

import type {
  TimesheetCorrectionItem,
  TimesheetMonth,
  TimesheetOverview,
  TimesheetOverviewReference,
} from '../model/timesheet.types';

function buildOverviewQuery(params: {
  year: number;
  month: number;
  objectId?: string;
  employeeId?: string;
}): URLSearchParams {
  const query = new URLSearchParams({
    year: String(params.year),
    month: String(params.month),
  });
  if (params.objectId) query.set('objectId', params.objectId);
  if (params.employeeId) query.set('employeeId', params.employeeId);
  return query;
}

export async function getTimesheetOverview(params: {
  year: number;
  month: number;
  objectId?: string;
  employeeId?: string;
}): Promise<TimesheetOverview> {
  return fetcher<TimesheetOverview>(
    `/timesheets/overview?${buildOverviewQuery(params).toString()}`,
    { method: 'GET' },
  );
}

export async function listTimesheetOverviewObjects(params: {
  q?: string;
  selectedId?: string;
}): Promise<TimesheetOverviewReference[]> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.selectedId) query.set('selectedId', params.selectedId);
  return fetcher<TimesheetOverviewReference[]>(
    `/timesheets/overview/references/objects?${query.toString()}`,
    { method: 'GET' },
  );
}

export async function listTimesheetOverviewEmployees(params: {
  year: number;
  month: number;
  objectId?: string;
  q?: string;
  selectedId?: string;
}): Promise<TimesheetOverviewReference[]> {
  const query = buildOverviewQuery(params);
  if (params.q) query.set('q', params.q);
  if (params.selectedId) query.set('selectedId', params.selectedId);
  return fetcher<TimesheetOverviewReference[]>(
    `/timesheets/overview/references/employees?${query.toString()}`,
    { method: 'GET' },
  );
}

export async function downloadTimesheetOverviewExcel(params: {
  year: number;
  month: number;
  objectId?: string;
  employeeId?: string;
}): Promise<Blob> {
  const response = await fetch(
    `${appConfig.apiUrl}/timesheets/overview/export?${buildOverviewQuery(params).toString()}`,
    { method: 'GET', credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error(
      `GET /timesheets/overview/export failed with status ${response.status}`,
    );
  }
  return response.blob();
}

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
    body: JSON.stringify(payload),
  });
}

export async function requestTimesheetManualException(payload: {
  objectId: string;
  year: number;
  month: number;
  employeeId: string;
  dayOfMonth: number;
  dayValue: number;
  comment: string;
}): Promise<ApprovalRequestItem> {
  return fetcher<ApprovalRequestItem>('/timesheets/exceptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function downloadTimesheetExcel(params: {
  objectId: string;
  year: number;
  month: number;
}): Promise<Blob> {
  const query = new URLSearchParams({
    objectId: params.objectId,
    year: String(params.year),
    month: String(params.month),
  });
  const response = await fetch(
    `${appConfig.apiUrl}/timesheets/export?${query.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
    },
  );

  if (!response.ok) {
    throw new Error(`GET /timesheets/export failed with status ${response.status}`);
  }

  return response.blob();
}
