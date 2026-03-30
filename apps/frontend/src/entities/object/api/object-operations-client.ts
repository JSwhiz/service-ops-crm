import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type {
  ObjectArrivalPhoto,
  ObjectComment,
  ObjectDailyReport,
  ObjectFeedItem,
} from '../model/object-operations.types';

export async function getTodayArrivalPhoto(
  objectId: string,
): Promise<ObjectArrivalPhoto | null> {
  return fetcher<ObjectArrivalPhoto | null>(
    `/objects/${objectId}/arrival-photo/today`,
    {
      method: 'GET',
      token: getAccessToken(),
    },
  );
}

export async function upsertTodayArrivalPhoto(
  objectId: string,
  payload: {
    photoUrl: string;
    photoType?: string;
    comment?: string;
  },
): Promise<ObjectArrivalPhoto> {
  return fetcher<ObjectArrivalPhoto>(`/objects/${objectId}/arrival-photo`, {
    method: 'POST',
    token: getAccessToken(),
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
      token: getAccessToken(),
    },
  );
}

export async function upsertTodayDailyReport(
  objectId: string,
  payload: {
    content: string;
  },
): Promise<ObjectDailyReport> {
  return fetcher<ObjectDailyReport>(`/objects/${objectId}/daily-report/today`, {
    method: 'PUT',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}

export async function listObjectComments(
  objectId: string,
): Promise<ObjectComment[]> {
  return fetcher<ObjectComment[]>(`/objects/${objectId}/comments`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function createObjectComment(
  objectId: string,
  payload: {
    content: string;
    commentType?: string;
  },
): Promise<ObjectComment> {
  return fetcher<ObjectComment>(`/objects/${objectId}/comments`, {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}

export async function getObjectFeed(
  objectId: string,
): Promise<ObjectFeedItem[]> {
  return fetcher<ObjectFeedItem[]>(`/objects/${objectId}/feed`, {
    method: 'GET',
    token: getAccessToken(),
  });
}
