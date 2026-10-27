import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class SaveOrderEscortsDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  operationDate!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  employeeIds!: string[];
}

export class OrderServiceLineDto {
  @IsIn(["cleaning", "drycleaning"])
  serviceCode!: "cleaning" | "drycleaning";

  @IsInt()
  @Min(0)
  @Max(2147483647)
  amount!: number;
}

export class SaveOrderServiceLinesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  agreedSum?: number;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => OrderServiceLineDto)
  lines!: OrderServiceLineDto[];
}

export class SaveOrderDeadlineDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  deadlineAt?: string | null;
}
