export type EmployeeArchiveState = 'active' | 'archived' | 'all';
export type EmployeeSortField =
  | 'fullName'
  | 'position'
  | 'employmentStatus'
  | 'birthDate'
  | 'createdAt'
  | 'updatedAt';

export interface EmployeeListItem {
  id: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  birthDate: string | null;
  employmentStatus: string;
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
}

export interface EmployeeListQuery {
  search?: string;
  objectId?: string;
  position?: string;
  employmentStatus?: string;
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
  version: number;
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentObjectAssignments: Array<{
    objectId: string;
    objectName: string;
    startDate: string | null;
    endDate: string | null;
    canOpenObjectCard: boolean;
  }>;
  objectAssignmentHistory: Array<{
    id: string;
    objectId: string;
    objectName: string;
    startedAt: string;
    endedAt: string | null;
    canOpenObjectCard: boolean;
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
    canEdit: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canManageStatus: boolean;
    canManageAvailability: boolean;
    canManageSubstitutions: boolean;
    canManageAssignments: boolean;
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
}
