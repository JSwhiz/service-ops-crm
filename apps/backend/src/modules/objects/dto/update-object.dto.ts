import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

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
  @IsBoolean()
  summerWindowCleaning?: boolean;

  @IsOptional()
  @IsBoolean()
  engineeringRequired?: boolean;

  @IsOptional()
  @IsIn(['none', 'with_removal', 'without_removal'])
  winterTractorMode?: 'none' | 'with_removal' | 'without_removal';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  instructionSteps?: string[];

  @IsOptional()
  @IsIn(['monthly', 'daily'])
  paymentType?: 'monthly' | 'daily';

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlySalary?: number;

  @IsOptional() @IsIn(['monthly', 'daily'])
  summerPaymentType?: 'monthly' | 'daily';
  @IsOptional() @IsInt() @Min(0)
  summerDailyRate?: number;
  @IsOptional() @IsInt() @Min(0)
  summerMonthlySalary?: number;
  @IsOptional() @IsIn(['monthly', 'daily'])
  winterPaymentType?: 'monthly' | 'daily';
  @IsOptional() @IsInt() @Min(0)
  winterDailyRate?: number;
  @IsOptional() @IsInt() @Min(0)
  winterMonthlySalary?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsUUID('4')
  counterpartyId?: string | null;

  @IsOptional()
  @IsUUID('4')
  responsibleUserId?: string;
}
