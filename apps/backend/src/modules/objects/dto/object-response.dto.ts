export class ObjectResponseDto {
  id!: string;
  name!: string;
  internalName!: string | null;
  address!: string;
  status!: string;
  seasonMode!: string | null;
  dailyRate!: number;
  notes!: string | null;
  createdAt!: string;
  updatedAt!: string;
  managers!: Array<{
    userId: string;
    login: string;
    fullName: string;
    roleCode: string;
  }>;
  responsibles!: Array<{
    userId: string;
    login: string;
    fullName: string;
    roleCode: string;
  }>;
  responsible!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  employees!: Array<{
    id: string;
    fullName: string;
    position: string | null;
    baseDailyRate: number | null;
    workScheduleCode: string | null;
    workScheduleCustom: string | null;
    workTimeText: string | null;
  }>;
  capabilities!: {
    canEdit: boolean;
    canEditDailyRate: boolean;
    canChangeStatus: boolean;
    canManageResponsibles: boolean;
    canManageManagers: boolean;
    canCreateTask: boolean;
    canViewOperationalSections: boolean;
    canManageEmployees: boolean;
  };
}
