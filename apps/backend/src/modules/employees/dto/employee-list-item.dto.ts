export class EmployeeListItemDto {
  id!: string;
  fullName!: string;
  phone!: string | null;
  position!: string | null;
  birthDate!: string | null;
  employmentStatus!: string;
  employeeType!: string;
  workScheduleCode!: string | null;
  workScheduleCustom!: string | null;
  workTimeText!: string | null;
  baseDailyRate!: number | null;
  version!: number;
  isArchived!: boolean;
  deletedAt!: string | null;
  updatedAt!: string;
  currentObjects!: Array<{
    id: string;
    name: string;
  }>;
  currentObjectCount!: number;
}

export class EmployeeListResponseDto {
  items!: EmployeeListItemDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
  capabilities!: {
    canCreate: boolean;
  };
}
