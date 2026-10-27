import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

export class SaveObjectContactDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
  @IsOptional()
  @IsString()
  @MaxLength(160)
  position?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  phones?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  emails?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUrl(
    { protocols: ["http", "https"], require_protocol: true },
    { each: true },
  )
  @MaxLength(2000, { each: true })
  links?: string[];
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class ContactVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SaveObjectPlanningDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  monthlyBudget?: number | null;
  @IsOptional()
  @IsBoolean()
  automaticSeasons?: boolean;
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}$/)
  summerStartsOn?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}$/)
  winterStartsOn?: string;
}
