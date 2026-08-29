export class OneTimeOrderReviewListItemResponseDto {
  id!: string;
  title!: string;
  executionStartDate!: string | null;
  executionEndDate!: string | null;
  status!: string;
  managers!: Array<{
    userId: string;
    login: string;
    fullName: string;
  }>;
  reviewRating!: number | null;
  reviewText!: string | null;
  reviewUpdatedAt!: string | null;
}

export class OneTimeOrderReviewListResponseDto {
  items!: OneTimeOrderReviewListItemResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
