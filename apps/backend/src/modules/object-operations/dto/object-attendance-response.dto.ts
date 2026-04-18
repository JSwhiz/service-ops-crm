import { ObjectEmployeeOptionDto } from './object-employee-option.dto';

export class ObjectAttendanceResponseDto {
  operationDate!: string;
  employeeIds!: string[];
  employees!: ObjectEmployeeOptionDto[];
}
