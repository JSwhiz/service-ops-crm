import { IsInt, Min } from 'class-validator';

export class SubmitDailyReportDto {
  @IsInt() @Min(1)
  expectedRevision!: number;
}
