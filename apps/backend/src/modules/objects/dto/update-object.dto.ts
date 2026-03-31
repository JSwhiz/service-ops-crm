import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateObjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  internalName?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsIn(['active', 'archived', 'frozen'])
  status?: string;

  @IsOptional()
  @IsIn(['summer', 'winter'])
  seasonMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
