import { fetcher } from '@/shared/api/fetcher';

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
): Promise<AccountabilityFundingEntry> {
  return fetcher<AccountabilityFundingEntry>(
    `/accountability/accounts/${userId}/fundings`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function createAccountabilityExpense(
  payload: SaveAccountabilityExpensePayload,
): Promise<AccountabilityExpenseItem> {
  return fetcher<AccountabilityExpenseItem>('/accountability/me/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAccountabilityExpense(
  expenseId: string,
  payload: SaveAccountabilityExpensePayload,
): Promise<AccountabilityExpenseItem> {
  return fetcher<AccountabilityExpenseItem>(
    `/accountability/me/expenses/${expenseId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export async function submitAccountabilityExpense(
  expenseId: string,
): Promise<AccountabilityExpenseItem> {
  return fetcher<AccountabilityExpenseItem>(
    `/accountability/me/expenses/${expenseId}/submit`,
    {
      method: 'POST',
    },
  );
}

export async function approveAccountabilityExpense(
  expenseId: string,
): Promise<AccountabilityExpenseItem> {
  return fetcher<AccountabilityExpenseItem>(
    `/accountability/expenses/${expenseId}/approve`,
    {
      method: 'POST',
    },
  );
}

export async function rejectAccountabilityExpense(
  expenseId: string,
  comment: string,
): Promise<AccountabilityExpenseItem> {
  return fetcher<AccountabilityExpenseItem>(
    `/accountability/expenses/${expenseId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ comment }),
    },
  );
}

export async function requestAccountabilityClosure(): Promise<AccountabilityClosureItem> {
  return fetcher<AccountabilityClosureItem>('/accountability/me/closures/request', {
    method: 'POST',
  });
}

export async function approveAccountabilityClosure(
  closureId: string,
): Promise<AccountabilityClosureItem> {
  return fetcher<AccountabilityClosureItem>(
    `/accountability/closures/${closureId}/approve`,
    {
      method: 'POST',
    },
  );
}

export async function rejectAccountabilityClosure(
  closureId: string,
  comment: string,
): Promise<AccountabilityClosureItem> {
  return fetcher<AccountabilityClosureItem>(
    `/accountability/closures/${closureId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ comment }),
    },
  );
}
