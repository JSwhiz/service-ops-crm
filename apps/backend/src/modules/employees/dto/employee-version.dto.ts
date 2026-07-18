import { IsInt, Min } from 'class-validator';

export class EmployeeVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
