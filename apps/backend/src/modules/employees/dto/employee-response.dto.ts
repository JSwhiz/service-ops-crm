export class EmployeeResponseDto {
  id!: string;
  fullName!: string;
  phone!: string | null;
  position!: string | null;
  birthDate!: string | null;
  residenceAddress!: string | null;
  shiftPreferences!: string | null;
  baseDailyRate!: number | null;
  notes!: string | null;
  employmentStatus!: string;
  employeeType!: string;
  workScheduleCode!: string | null;
  workScheduleCustom!: string | null;
  workTimeText!: string | null;
  version!: number;
  isArchived!: boolean;
  deletedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  currentObjectAssignments!: Array<{
    assignmentId: string;
    historyId: string | null;
    objectId: string;
    objectName: string;
    objectDailyRate: number;
    startDate: string | null;
    endDate: string | null;
    canOpenObjectCard: boolean;
  }>;
  objectAssignmentHistory!: Array<{
    id: string;
    objectId: string;
    objectName: string;
    objectDailyRate: number;
    startedAt: string;
    endedAt: string | null;
    canOpenObjectCard: boolean;
    canDeleteAsError: boolean;
  }>;
  availabilityWindows!: Array<{
    id: string;
    startDate: string;
    endDate: string | null;
    availabilityMode: string;
    availabilityStatus: string;
    comment: string | null;
  }>;
  substitutions!: Array<{
    id: string;
    role: 'primary' | 'replacement';
    counterpartEmployeeId: string;
    counterpartEmployeeName: string;
    objectId: string | null;
    objectName: string | null;
    startDate: string;
    endDate: string | null;
    status: string;
    reason: string;
    comment: string | null;
  }>;
  capabilities!: {
    canView: boolean;
    canEdit: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canDeletePermanently: boolean;
    canDeleteAssignmentAsError: boolean;
    canManageStatus: boolean;
    canManageAvailability: boolean;
    canManageSubstitutions: boolean;
    canManageAssignments: boolean;
  };
  lifecycleEligibility!: {
    archive: {
      eligible: boolean;
      blockers: Array<{ code: string; count: number }>;
    };
    permanentDelete: {
      eligible: boolean;
      blockers: Array<{ code: string; count: number }>;
    };
  };
}
