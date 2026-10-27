import { IsDateString, IsOptional, IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class CreateObjectSubstitutionDto {
  @IsUUID('4') employeeId!: string;
  @IsUUID('4') substituteEmployeeId!: string;
  @IsOptional() @IsUUID('4') rateOptionId?: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsString() @MinLength(2) @MaxLength(1000) reason!: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
