import { ObjectEmployeeOptionDto } from './object-employee-option.dto';

export class ObjectAttendanceEmployeeFactResponseDto {
  employeeId!: string;
  employeeName!: string;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: { id: string; fullName: string; login: string } | null;
  workedHours!: number | null;
  ratePolicyType!: string | null;
  rateAmount!: number;
  dailyRateSnapshot!: number;
  rateReason!: string | null;
}

export class ObjectAttendanceSubmittedByResponseDto {
  id!: string;
  login!: string;
  fullName!: string;
}

export class ObjectAttendanceResponseDto {
  operationDate!: string;
  suggestedEmployeeIds!: string[];
  prefillSourceDate!: string | null;
  employeeIds!: string[];
  employeeFacts!: ObjectAttendanceEmployeeFactResponseDto[];
  employees!: ObjectEmployeeOptionDto[];
  submittedAt?: string | null;
  submittedBy?: ObjectAttendanceSubmittedByResponseDto | null;
}
