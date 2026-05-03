import { IsIn, IsOptional, IsString } from 'class-validator';

import {
  APPROVAL_SOURCE_ENTITY_TYPES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
} from '../constants/approval.constants';

export class ListApprovalRequestsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(APPROVAL_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(APPROVAL_TYPES)
  approvalType?: string;

  @IsOptional()
  @IsString()
  @IsIn(APPROVAL_SOURCE_ENTITY_TYPES)
  sourceEntityType?: string;

  @IsOptional()
  @IsString()
  sourceEntityId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
