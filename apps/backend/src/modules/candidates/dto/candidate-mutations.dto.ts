import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested, ValidateIf } from 'class-validator';

import { CANDIDATE_STATUSES, CANDIDATE_TYPES } from '../constants/candidate.constants';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class CandidateManagerSelectionDto {
  @IsUUID('4')
  managerUserId!: string;

  @IsOptional()
  @IsUUID('4')
  objectId?: string | null;
}

export class CreateCandidateDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @ValidateIf((value: CreateCandidateDto) => !value.phones?.length || value.phone !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(3, { each: true })
  @MaxLength(50, { each: true })
  phones?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsIn(CANDIDATE_TYPES)
  candidateType!: (typeof CANDIDATE_TYPES)[number];

  @IsOptional()
  @IsUUID('4')
  objectId?: string | null;

  @IsOptional()
  @IsUUID('4')
  managerUserId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CandidateManagerSelectionDto)
  assignments?: CandidateManagerSelectionDto[];
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
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(3, { each: true })
  @MaxLength(50, { each: true })
  phones?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsIn(CANDIDATE_TYPES)
  candidateType?: (typeof CANDIDATE_TYPES)[number];

  @IsOptional()
  @IsUUID('4')
  objectId?: string | null;
}

export class CandidateVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ChangeCandidateStatusDto extends CandidateVersionDto {
  @IsIn(CANDIDATE_STATUSES)
  status!: (typeof CANDIDATE_STATUSES)[number];

  /** Managers to assign when a closed candidate is returned to work. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CandidateManagerSelectionDto)
  assignments?: CandidateManagerSelectionDto[];
}

export class AssignCandidateManagerDto extends CandidateVersionDto {
  @IsOptional()
  @IsUUID('4')
  managerUserId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CandidateManagerSelectionDto)
  assignments?: CandidateManagerSelectionDto[];
}

export class ConvertCandidateToEmployeeDto extends CandidateVersionDto {
  @IsOptional()
  @IsIn(['regular', 'one_time', 'substitution'])
  employeeType?: 'regular' | 'one_time' | 'substitution';
}

export class CreateCandidateResponseDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}
