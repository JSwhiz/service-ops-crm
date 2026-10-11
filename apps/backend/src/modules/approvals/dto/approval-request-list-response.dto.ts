import { ApprovalRequestResponseDto } from './approval-request-response.dto';

export class ApprovalRequestListResponseDto {
  items!: ApprovalRequestResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
