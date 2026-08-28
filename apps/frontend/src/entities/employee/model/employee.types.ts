export type EmployeeArchiveState = 'active' | 'archived' | 'all';
export type EmployeeSortField =
  | 'fullName'
  | 'position'
  | 'employmentStatus'
  | 'employeeType'
  | 'birthDate'
  | 'createdAt'
  | 'updatedAt';

export type EmployeeType = 'regular' | 'one_time';
export type EmployeeWorkScheduleCode =
  | '5_2'
  | '2_2'
  | '6_1'
  | '7_0'
  | '3_1'
  | 'on_demand'
  | 'custom';

export interface EmployeeListItem {
  id: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  birthDate: string | null;
  employmentStatus: string;
  employeeType: EmployeeType;
  workScheduleCode: EmployeeWorkScheduleCode | null;
  workScheduleCustom: string | null;
  workTimeText: string | null;
  baseDailyRate: number | null;
  version: number;
  isArchived: boolean;
  deletedAt: string | null;
  updatedAt: string;
  currentObjects: Array<{
    id: string;
    name: string;
  }>;
  currentObjectCount: number;
}

export interface EmployeeListResponse {
  items: EmployeeListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  capabilities: {
    canCreate: boolean;
  };
}

export interface EmployeeListQuery {
  search?: string;
  objectId?: string;
  position?: string;
  employmentStatus?: string;
  employeeType?: EmployeeType;
  workScheduleCode?: EmployeeWorkScheduleCode;
  workTimeSearch?: string;
  archiveState?: EmployeeArchiveState;
  birthMonth?: number;
  hasActiveObjectAssignment?: boolean;
  sortBy?: EmployeeSortField;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface EmployeeObjectOption {
  id: string;
  name: string;
  status: string;
}

export interface EmployeePositionReference {
  value: string;
  label: string;
}

export interface EmployeeObjectReference {
  id: string;
  name: string;
}

export interface EmployeeDetail {
  id: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  birthDate: string | null;
  residenceAddress: string | null;
  shiftPreferences: string | null;
  baseDailyRate: number | null;
  notes: string | null;
  employmentStatus: string;
  employeeType: EmployeeType;
  workScheduleCode: EmployeeWorkScheduleCode | null;
  workScheduleCustom: string | null;
  workTimeText: string | null;
  version: number;
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentObjectAssignments: Array<{
    assignmentId: string;
    historyId: string | null;
    objectId: string;
    objectName: string;
    objectDailyRate: number;
    startDate: string | null;
    endDate: string | null;
    canOpenObjectCard: boolean;
  }>;
  objectAssignmentHistory: Array<{
    id: string;
    objectId: string;
    objectName: string;
    objectDailyRate: number;
    startedAt: string;
    endedAt: string | null;
    canOpenObjectCard: boolean;
    canDeleteAsError: boolean;
  }>;
  availabilityWindows: Array<{
    id: string;
    startDate: string;
    endDate: string | null;
    availabilityMode: string;
    availabilityStatus: string;
    comment: string | null;
  }>;
  substitutions: Array<{
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
  capabilities: {
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
  lifecycleEligibility: {
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

export interface EmployeeMutationPayload {
  fullName?: string;
  phone?: string | null;
  position?: string | null;
  birthDate?: string | null;
  residenceAddress?: string | null;
  shiftPreferences?: string | null;
  baseDailyRate?: number | null;
  notes?: string | null;
  employmentStatus?: string;
  employeeType?: EmployeeType;
  workScheduleCode?: EmployeeWorkScheduleCode | null;
  workScheduleCustom?: string | null;
  workTimeText?: string | null;
}
