import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class ListTimesheetCorrectionsQueryDto {
  @IsString()
  objectId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
