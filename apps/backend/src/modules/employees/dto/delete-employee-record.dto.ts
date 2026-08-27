import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class DeleteEmployeeAssignmentAsErrorDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class DeleteEmployeePermanentlyDto extends DeleteEmployeeAssignmentAsErrorDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
