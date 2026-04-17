export interface EmployeeListItem {
  id: string;
  fullName: string;
  phone: string | null;
  employmentStatus: string;
  baseDailyRate: number | null;
  currentObjectCount: number;
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
  residenceAddress: string | null;
  shiftPreferences: string | null;
  baseDailyRate: number | null;
  notes: string | null;
  employmentStatus: string;
  createdAt: string;
  updatedAt: string;
  currentObjectAssignments: Array<{
    objectId: string;
    objectName: string;
    startDate: string | null;
    endDate: string | null;
  }>;
  objectAssignmentHistory: Array<{
    id: string;
    objectId: string;
    objectName: string;
    startedAt: string;
    endedAt: string | null;
  }>;
  availabilityWindows: Array<{
    id: string;
    startDate: string;
    endDate: string | null;
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
    canManageStatus: boolean;
    canManageAvailability: boolean;
    canManageSubstitutions: boolean;
    canManageAssignments: boolean;
  };
}
