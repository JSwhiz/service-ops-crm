import { IsOptional, IsString } from 'class-validator';

export class SearchEmployeeQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
