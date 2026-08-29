import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListOneTimeOrderCalendarManagersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
