export class NotificationResponseDto {
  id!: string;
  type!: string;
  title!: string;
  body!: string | null;
  entityType!: string | null;
  entityId!: string | null;
  targetUrl!: string | null;
  readAt!: string | null;
  createdAt!: string;
}

export class NotificationListResponseDto {
  items!: NotificationResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
