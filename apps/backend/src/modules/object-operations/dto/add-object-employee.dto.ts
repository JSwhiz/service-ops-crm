import { IsUUID } from 'class-validator';

export class AddObjectEmployeeDto {
  @IsUUID('4')
  employeeId!: string;
}
