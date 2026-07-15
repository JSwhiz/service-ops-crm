import { OneTimeOrderResponseDto } from './one-time-order-response.dto';

export class OneTimeOrderListItemResponseDto {
  id!: string;
  title!: string;
  executionStartDate!: string | null;
  executionEndDate!: string | null;
  durationDays!: number | null;
  status!: string;
  executionAddress!: string;
  linkedObject!: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  managers!: Array<{
    userId: string;
    login: string;
    fullName: string;
    roleCode: string;
  }>;
  contact!: {
    name: string;
    phone: string | null;
  };
  reviewRating!: number | null;
  reviewPreview!: string | null;
  specificationProgress!: {
    completed: number;
    total: number;
  };
  accessibleTaskCount!: number;
  capabilities!: OneTimeOrderResponseDto['capabilities'];
  createdAt!: string;
  updatedAt!: string;
}

export class OneTimeOrderListResponseDto {
  items!: OneTimeOrderListItemResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
