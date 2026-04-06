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

  @IsString()
  @IsIn(['summer', 'winter'])
  seasonMode!: string;

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
