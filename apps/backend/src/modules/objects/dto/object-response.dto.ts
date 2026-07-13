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
    fullName: string;
    roleCode: string;
  }>;
  responsibles!: Array<{
    userId: string;
    fullName: string;
    roleCode: string;
  }>;
  capabilities!: {
    canEdit: boolean;
    canEditDailyRate: boolean;
    canChangeStatus: boolean;
    canManageResponsibles: boolean;
    canManageManagers: boolean;
    canCreateTask: boolean;
  };
}
