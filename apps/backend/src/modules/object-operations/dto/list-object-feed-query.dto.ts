import { IsOptional, IsString } from 'class-validator';

export class ListObjectFeedQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}
