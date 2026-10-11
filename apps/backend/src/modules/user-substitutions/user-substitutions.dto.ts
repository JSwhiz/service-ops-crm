import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUserSubstitutionDto {
  @IsOptional() @IsUUID() principalUserId?: string;
  @IsUUID() replacementUserId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(36, { each: true }) @Matches(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, { each: true }) objectIds!: string[];
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

export class RevokeUserSubstitutionDto {
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

export class SubstitutionOptionsQueryDto {
  @IsOptional() @IsUUID() principalUserId?: string;
  @IsOptional() @IsString() @MaxLength(100) userSearch?: string;
  @IsOptional() @IsString() @MaxLength(100) objectSearch?: string;
}

export class ListUserSubstitutionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
