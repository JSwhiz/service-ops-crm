import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

import { CANDIDATE_STATUSES, CANDIDATE_TYPES } from '../constants/candidate.constants';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class CreateCandidateDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsIn(CANDIDATE_TYPES)
  candidateType!: (typeof CANDIDATE_TYPES)[number];
}

export class UpdateCandidateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsIn(CANDIDATE_TYPES)
  candidateType?: (typeof CANDIDATE_TYPES)[number];
}

export class CandidateVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ChangeCandidateStatusDto extends CandidateVersionDto {
  @IsIn(CANDIDATE_STATUSES)
  status!: (typeof CANDIDATE_STATUSES)[number];
}

export class AssignCandidateManagerDto extends CandidateVersionDto {
  @IsUUID('4')
  managerUserId!: string;
}

export class CreateCandidateResponseDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}
