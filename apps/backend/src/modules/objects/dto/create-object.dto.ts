import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateObjectDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  internalName!: string;

  @IsString()
  @MinLength(3)
  address!: string;

  @IsString()
  @IsIn(['active', 'frozen', 'archived'])
  status!: string;

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
  @IsString()
  notes?: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsUUID('4')
  counterpartyId?: string | null;

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
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds?: string[];

  @IsUUID('4')
  responsibleUserId!: string;
}
