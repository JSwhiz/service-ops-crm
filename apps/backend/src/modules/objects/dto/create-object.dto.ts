import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateObjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  internalName?: string;

  @IsString()
  address!: string;

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
