export interface OneTimeOrderAttentionItemDto {
  id: string;
  title: string;
  status: string;
  executionStartDate: string | null;
  executionEndDate: string | null;
  executionAddress: string;
  linkedObject: { id: string; name: string } | null;
  managers: Array<{ userId: string; login: string; fullName: string }>;
}

export interface OneTimeOrderAttentionResponseDto {
  items: OneTimeOrderAttentionItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
