import { Type } from "class-transformer";
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

export class VisitPlanQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsUUID()
  managerUserId?: string;
}

export class CreateVisitPlanDto {
  @IsUUID()
  managerUserId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  planDate!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  reportDueAt?: string;
}

export class VisitPlanVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SaveVisitPlanEntryDto extends VisitPlanVersionDto {
  @IsOptional()
  @IsUUID()
  objectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientName?: string;

  @IsOptional()
  @IsBoolean()
  isUnplanned?: boolean;
}

export class RecordVisitDto extends VisitPlanVersionDto {
  @IsBoolean()
  visited!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  visitReport?: string;
}

export class SaveVisitPlanReportDto extends VisitPlanVersionDto {
  @IsString()
  @MaxLength(20000)
  report!: string;

  @IsBoolean()
  closeReport!: boolean;
}

export class SaveVisitPlanDeadlineDto extends VisitPlanVersionDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  reportDueAt?: string | null;
}
