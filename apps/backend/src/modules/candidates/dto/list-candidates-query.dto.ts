import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { CANDIDATE_ARCHIVE_STATES, CANDIDATE_SLA_STATES, CANDIDATE_STATUSES, CANDIDATE_TYPES } from '../constants/candidate.constants';

const optionalTrim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() || undefined : value;

export const CANDIDATE_SORT_FIELDS = ['fullName', 'status', 'candidateType', 'createdAt', 'updatedAt'] as const;

export class ListCandidatesQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(CANDIDATE_TYPES)
  candidateType?: (typeof CANDIDATE_TYPES)[number];

  @IsOptional()
  @IsIn(CANDIDATE_STATUSES)
  status?: (typeof CANDIDATE_STATUSES)[number];

  @IsOptional()
  @IsUUID('4')
  managerUserId?: string;

  @IsOptional()
  @IsIn(CANDIDATE_SLA_STATES)
  slaState?: (typeof CANDIDATE_SLA_STATES)[number];

  @IsOptional()
  @IsIn(CANDIDATE_ARCHIVE_STATES)
  archiveState: (typeof CANDIDATE_ARCHIVE_STATES)[number] = 'active';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsIn(CANDIDATE_SORT_FIELDS)
  sort: (typeof CANDIDATE_SORT_FIELDS)[number] = 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class ListCandidateManagersQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID('4')
  selectedId?: string;
}
