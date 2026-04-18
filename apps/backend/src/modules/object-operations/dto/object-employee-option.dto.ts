export class ObjectEmployeeOptionDto {
  id!: string;
  fullName!: string;
  isAssignedToObject!: boolean;
  availability!: {
    isUnavailable: boolean;
    availabilityMode: string | null;
    startDate: string | null;
    endDate: string | null;
    comment: string | null;
  };
  activeSubstitutions!: Array<{
    id: string;
    role: 'primary' | 'replacement';
    counterpartEmployeeId: string;
    counterpartEmployeeName: string;
    startDate: string;
    endDate: string | null;
    status: string;
    reason: string;
    comment: string | null;
  }>;
}
