import type { SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { fetcher, postCommittedWrite, committedWrite } from '@/shared/api/fetcher';

import type {
  AccountabilityAccountListItem,
  AccountabilityAccountView,
  AccountabilityClosureItem,
  AccountabilityExpenseItem,
  AccountabilityFundingEntry,
  AccountabilityUserSummary,
  CreateAccountabilityFundingPayload,
  OneTimeOrderAccountabilityView,
  SaveAccountabilityExpensePayload,
} from '../model/accountability.types';

export async function getMyAccountability(): Promise<AccountabilityAccountView> {
  return fetcher<AccountabilityAccountView>('/accountability/me', {
    method: 'GET',
  });
}

export async function getOneTimeOrderAccountability(
  orderId: string,
): Promise<OneTimeOrderAccountabilityView> {
  return fetcher<OneTimeOrderAccountabilityView>(
    `/accountability/orders/${orderId}`,
    { method: 'GET' },
  );
}

export async function listAccountabilityAccounts(): Promise<
  AccountabilityAccountListItem[]
> {
  return fetcher<AccountabilityAccountListItem[]>('/accountability/accounts', {
    method: 'GET',
  });
}

export async function getAccountabilityAccountByUserId(
  userId: string,
): Promise<AccountabilityAccountView> {
  return fetcher<AccountabilityAccountView>(`/accountability/accounts/${userId}`, {
    method: 'GET',
  });
}

export async function listAccountabilityUsers(): Promise<
  AccountabilityUserSummary[]
> {
  return fetcher<AccountabilityUserSummary[]>('/accountability/reference/users', {
    method: 'GET',
  });
}

export async function issueAccountabilityFunding(
  userId: string,
  payload: CreateAccountabilityFundingPayload,
): Promise<AccountabilityFundingEntry | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityFundingEntry>(
    `/accountability/accounts/${userId}/fundings`,
    {
      body: JSON.stringify(payload),
    },
  );
}

export async function recordExternalAccountabilityReceipt(payload: {
  amount: number;
  source: string;
  comment: string;
}): Promise<AccountabilityFundingEntry | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityFundingEntry>('/accountability/me/fundings/external', {
    body: JSON.stringify(payload),
  });
}

export async function reverseExternalAccountabilityReceipt(
  fundingId: string,
  reason: string,
): Promise<AccountabilityFundingEntry | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityFundingEntry>(`/accountability/fundings/${fundingId}/reverse`, {
    body: JSON.stringify({ reason }),
  });
}

export async function createAccountabilityExpense(
  payload: SaveAccountabilityExpensePayload,
): Promise<AccountabilityExpenseItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityExpenseItem>('/accountability/me/expenses', {
    body: JSON.stringify(payload),
  });
}

export async function updateAccountabilityExpense(
  expenseId: string,
  payload: SaveAccountabilityExpensePayload,
): Promise<AccountabilityExpenseItem | SavedWithoutAccess> {
  return committedWrite<AccountabilityExpenseItem>(
    `/accountability/me/expenses/${expenseId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export async function submitAccountabilityExpense(
  expenseId: string,
): Promise<AccountabilityExpenseItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityExpenseItem>(
    `/accountability/me/expenses/${expenseId}/submit`,
    {
    },
  );
}

export async function approveAccountabilityExpense(
  expenseId: string,
): Promise<AccountabilityExpenseItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityExpenseItem>(
    `/accountability/expenses/${expenseId}/approve`,
    {
    },
  );
}

export async function rejectAccountabilityExpense(
  expenseId: string,
  comment: string,
): Promise<AccountabilityExpenseItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityExpenseItem>(
    `/accountability/expenses/${expenseId}/reject`,
    {
      body: JSON.stringify({ comment }),
    },
  );
}

export async function requestAccountabilityClosure(): Promise<AccountabilityClosureItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityClosureItem>('/accountability/me/closures/request', {});
}

export async function approveAccountabilityClosure(
  closureId: string,
): Promise<AccountabilityClosureItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityClosureItem>(
    `/accountability/closures/${closureId}/approve`,
    {
    },
  );
}

export async function rejectAccountabilityClosure(
  closureId: string,
  comment: string,
): Promise<AccountabilityClosureItem | SavedWithoutAccess> {
  return postCommittedWrite<AccountabilityClosureItem>(
    `/accountability/closures/${closureId}/reject`,
    {
      body: JSON.stringify({ comment }),
    },
  );
}
