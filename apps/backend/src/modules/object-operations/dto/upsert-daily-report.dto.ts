import { IsString, MinLength } from 'class-validator';

export class UpsertDailyReportDto {
  @IsString()
  @MinLength(3)
  content!: string;
}
