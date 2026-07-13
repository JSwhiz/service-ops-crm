import { Transform } from 'class-transformer';
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

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsIn(['summer', 'winter'])
  seasonMode?: 'summer' | 'winter' | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
