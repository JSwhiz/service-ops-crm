import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  residenceAddress?: string;

  @IsOptional()
  @IsString()
  shiftPreferences?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  baseDailyRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
