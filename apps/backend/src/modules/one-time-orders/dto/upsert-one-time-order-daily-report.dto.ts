import { IsString } from 'class-validator';

export class UpsertOneTimeOrderDailyReportDto {
  @IsString()
  content!: string;
}
