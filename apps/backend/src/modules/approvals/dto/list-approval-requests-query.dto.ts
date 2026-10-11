import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import {
  APPROVAL_SOURCE_ENTITY_TYPES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
} from '../constants/approval.constants';

export class ListApprovalRequestsQueryDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : parsed;
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

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
