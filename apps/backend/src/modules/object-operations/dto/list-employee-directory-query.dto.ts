import { IsOptional, IsString } from 'class-validator';

export class ListEmployeeDirectoryQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
