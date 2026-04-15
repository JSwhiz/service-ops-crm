import { fetcher } from '@/shared/api/fetcher';

import type { SystemUserOption } from '../model/user.types';

export type { SystemUserOption } from '../model/user.types';

export type SystemUserListPurpose =
  | 'object_manager'
  | 'object_responsible'
  | 'task_assignee';

interface ListSystemUsersParams {
  purpose: SystemUserListPurpose;
  objectId?: string;
}

function buildUsersAccessQuery(params: ListSystemUsersParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('purpose', params.purpose);

  if (params.objectId) {
    searchParams.set('objectId', params.objectId);
  }

  return `?${searchParams.toString()}`;
}

export async function listSystemUsers(
  params: ListSystemUsersParams,
): Promise<SystemUserOption[]> {
  return fetcher<SystemUserOption[]>(
    `/users-access/users${buildUsersAccessQuery(params)}`,
    {
      method: 'GET',
    },
  );
}

export async function listObjectManagerCandidates(
  objectId?: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'object_manager',
    ...(objectId ? { objectId } : {}),
  });
}

export async function listObjectResponsibleCandidates(
  objectId?: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'object_responsible',
    ...(objectId ? { objectId } : {}),
  });
}

export async function listTaskAssigneeCandidates(
  objectId: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'task_assignee',
    objectId,
  });
}
