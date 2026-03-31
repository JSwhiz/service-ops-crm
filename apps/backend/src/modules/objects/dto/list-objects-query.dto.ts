import { IsOptional, IsString } from 'class-validator';

export class ListObjectsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
