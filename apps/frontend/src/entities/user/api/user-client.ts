import { fetcher } from '@/shared/api/fetcher';

import type { SystemUserOption } from '../model/user.types';

export type { SystemUserOption } from '../model/user.types';

export type SystemUserListPurpose =
  | 'object_manager'
  | 'object_responsible'
  | 'task_assignee'
  | 'task_visibility'
  | 'one_time_order_manager'
  | 'one_time_order_task_assignee'
  | 'one_time_order_payment_recipient'
  | 'chat_participant';

interface ListSystemUsersParams {
  purpose: SystemUserListPurpose;
  objectId?: string;
  oneTimeOrderId?: string;
  q?: string;
  selectedId?: string;
  limit?: number;
}

function buildUsersAccessQuery(params: ListSystemUsersParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('purpose', params.purpose);

  if (params.objectId) {
    searchParams.set('objectId', params.objectId);
  }

  if (params.oneTimeOrderId) {
    searchParams.set('oneTimeOrderId', params.oneTimeOrderId);
  }

  if (params.q) {
    searchParams.set('q', params.q);
  }

  if (params.selectedId) {
    searchParams.set('selectedId', params.selectedId);
  }

  if (params.limit) {
    searchParams.set('limit', String(params.limit));
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

export async function listOneTimeOrderManagerCandidates(
  oneTimeOrderId?: string,
  q?: string,
  selectedId?: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'one_time_order_manager',
    ...(oneTimeOrderId ? { oneTimeOrderId } : {}),
    ...(q ? { q } : {}),
    ...(selectedId ? { selectedId } : {}),
    limit: 20,
  });
}

export async function listOneTimeOrderTaskAssigneeCandidates(
  oneTimeOrderId: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'one_time_order_task_assignee',
    oneTimeOrderId,
  });
}

export async function listChatParticipantCandidates(): Promise<
  SystemUserOption[]
> {
  return listSystemUsers({
    purpose: 'chat_participant',
  });
}


export async function listOneTimeOrderPaymentRecipientCandidates(
  oneTimeOrderId: string,
  q?: string,
  selectedId?: string,
): Promise<SystemUserOption[]> {
  return listSystemUsers({
    purpose: 'one_time_order_payment_recipient',
    oneTimeOrderId,
    ...(q ? { q } : {}),
    ...(selectedId ? { selectedId } : {}),
    limit: 20,
  });
}
