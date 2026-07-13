export interface ObjectAssignedUser {
  userId: string;
  fullName: string;
  roleCode: string;
}

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
  isAssignedToObject: boolean;
  ratePolicy: {
    ratePolicyType: string;
    baseAmount: number;
    scheduleCode: string | null;
    roundingMode: string;
    roundingStep: number | null;
    standardShiftHours: number;
    workingDaysInMonth: number | null;
    excludedHolidayDays: number | null;
    notes: string | null;
    label: string;
    updatedAt: string | null;
  } | null;
  availability: {
    isUnavailable: boolean;
    availabilityMode: string | null;
    startDate: string | null;
    endDate: string | null;
    comment: string | null;
  };
  activeSubstitutions: Array<{
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

export interface ServiceObject {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string | null;
  dailyRate: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  managers: ObjectAssignedUser[];
  responsibles: ObjectAssignedUser[];
  capabilities: {
    canEdit: boolean;
    canEditDailyRate: boolean;
    canChangeStatus: boolean;
    canManageResponsibles: boolean;
    canManageManagers: boolean;
    canCreateTask: boolean;
  };
}

export interface ObjectAuditActor {
  id: string;
  login: string;
  fullName: string;
}

export interface ObjectAuditLogItem {
  id: string;
  objectId: string;
  actionCode: string;
  createdAt: string;
  actor: ObjectAuditActor;
  payload: Record<string, unknown> | null;
}
