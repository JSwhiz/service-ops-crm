import { ObjectEmployeeOptionDto } from './object-employee-option.dto';

export class ObjectAttendanceEmployeeFactResponseDto {
  employeeId!: string;
  workedHours!: number | null;
}

export class ObjectAttendanceResponseDto {
  operationDate!: string;
  employeeIds!: string[];
  employeeFacts!: ObjectAttendanceEmployeeFactResponseDto[];
  employees!: ObjectEmployeeOptionDto[];
}
