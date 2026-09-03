import { ObjectEmployeeOptionDto } from './object-employee-option.dto';

export class ObjectAttendanceEmployeeFactResponseDto {
  employeeId!: string;
  workedHours!: number | null;
}

export class ObjectAttendanceSubmittedByResponseDto {
  id!: string;
  login!: string;
  fullName!: string;
}

export class ObjectAttendanceResponseDto {
  operationDate!: string;
  employeeIds!: string[];
  employeeFacts!: ObjectAttendanceEmployeeFactResponseDto[];
  employees!: ObjectEmployeeOptionDto[];
  submittedAt?: string | null;
  submittedBy?: ObjectAttendanceSubmittedByResponseDto | null;
}
