import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsString()
  notes?: string;

  @IsInt()
  @Min(0)
  dailyRate!: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds?: string[];
}
