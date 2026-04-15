export interface ObjectAssignedUser {
  userId: string;
  fullName: string;
  roleCode: string;
}

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
}

export interface ServiceObject {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string;
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
