import { fetcher } from '@/shared/api/fetcher';

import type { ObjectEmployeeOption } from '../model/object.types';
import type {
  ObjectArrivalPhoto,
  ObjectComment,
  ObjectDailyReport,
  ObjectFeedItem,
  LinkedOneTimeOrderProjection,
} from '../model/object-operations.types';

export interface CreateObjectCommentPayload {
  content: string;
  commentType?: string;
}

export interface UpsertArrivalPhotoPayload {
  photoUrl?: string;
  photoType?: string;
  comment?: string;
}

export interface UpsertDailyReportPayload {
  content: string;
}

export interface ObjectAttendanceToday {
  operationDate: string;
  employeeIds: string[];
  employees: ObjectEmployeeOption[];
}

export interface UpsertObjectAttendancePayload {
  operationDate: string;
  employeeIds: string[];
}

export async function getTodayArrivalPhoto(
  objectId: string,
): Promise<ObjectArrivalPhoto | null> {
  return fetcher<ObjectArrivalPhoto | null>(
    `/objects/${objectId}/arrival-photo/today`,
    {
      method: 'GET',
    },
  );
}

export async function upsertTodayArrivalPhoto(
  objectId: string,
  payload: UpsertArrivalPhotoPayload,
): Promise<ObjectArrivalPhoto> {
  return fetcher<ObjectArrivalPhoto>(`/objects/${objectId}/arrival-photo`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTodayDailyReport(
  objectId: string,
): Promise<ObjectDailyReport | null> {
  return fetcher<ObjectDailyReport | null>(
    `/objects/${objectId}/daily-report/today`,
    {
      method: 'GET',
    },
  );
}

export async function upsertTodayDailyReport(
  objectId: string,
  payload: UpsertDailyReportPayload,
): Promise<ObjectDailyReport> {
  return fetcher<ObjectDailyReport>(`/objects/${objectId}/daily-report/today`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listObjectComments(
  objectId: string,
): Promise<ObjectComment[]> {
  return fetcher<ObjectComment[]>(`/objects/${objectId}/comments`, {
    method: 'GET',
  });
}

export async function createObjectComment(
  objectId: string,
  payload: CreateObjectCommentPayload,
): Promise<ObjectComment> {
  return fetcher<ObjectComment>(`/objects/${objectId}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getObjectFeed(
  objectId: string,
): Promise<ObjectFeedItem[]> {
  return fetcher<ObjectFeedItem[]>(`/objects/${objectId}/feed`, {
    method: 'GET',
  });
}

export async function listLinkedOneTimeOrders(
  objectId: string,
): Promise<LinkedOneTimeOrderProjection[]> {
  return fetcher<LinkedOneTimeOrderProjection[]>(
    `/objects/${objectId}/linked-one-time-orders`,
    {
      method: 'GET',
    },
  );
}

export async function listObjectEmployees(
  objectId: string,
): Promise<ObjectEmployeeOption[]> {
  return fetcher<ObjectEmployeeOption[]>(`/objects/${objectId}/employees`, {
    method: 'GET',
  });
}

export async function searchEmployeeDirectory(
  objectId: string,
  search: string,
): Promise<ObjectEmployeeOption[]> {
  const query = search.trim()
    ? `?search=${encodeURIComponent(search.trim())}`
    : '';

  return fetcher<ObjectEmployeeOption[]>(
    `/objects/${objectId}/employee-directory${query}`,
    {
      method: 'GET',
    },
  );
}

export async function addEmployeeToObject(
  objectId: string,
  employeeId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/employees`, {
    method: 'POST',
    body: JSON.stringify({ employeeId }),
  });
}

export async function removeEmployeeFromObject(
  objectId: string,
  employeeId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(
    `/objects/${objectId}/employees/${employeeId}`,
    {
      method: 'DELETE',
    },
  );
}

export async function getTodayObjectAttendance(
  objectId: string,
): Promise<ObjectAttendanceToday> {
  return fetcher<ObjectAttendanceToday>(`/objects/${objectId}/attendance/today`, {
    method: 'GET',
  });
}

export async function upsertObjectAttendance(
  objectId: string,
  payload: UpsertObjectAttendancePayload,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/attendance`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
