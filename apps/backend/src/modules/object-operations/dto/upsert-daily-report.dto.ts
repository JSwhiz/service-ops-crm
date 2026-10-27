import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertDailyReportDto {
  @IsOptional() @IsInt() @Min(0)
  expectedRevision?: number;
  @IsString()
  content!: string;
}
