export class ObjectResponseDto {
  id!: string;
  name!: string;
  internalName!: string | null;
  address!: string;
  status!: string;
  seasonMode!: string | null;
  summerWindowCleaning!: boolean;
  engineeringRequired!: boolean;
  winterTractorMode!: 'none' | 'with_removal' | 'without_removal';
  instructionSteps!: string[];
  paymentType!: 'monthly' | 'daily' | null;
  dailyRate!: number | null;
  monthlySalary!: number | null;
  paymentScheduleCode!: string | null;
  paymentScheduleWeekdays!: string[];
  paymentScheduleCycleStartDate!: string | null;
  summerPaymentType!: 'monthly' | 'daily' | null;
  summerDailyRate!: number | null;
  summerMonthlySalary!: number | null;
  summerScheduleCode!: string | null;
  summerScheduleWeekdays!: string[];
  summerScheduleCycleStartDate!: string | null;
  winterPaymentType!: 'monthly' | 'daily' | null;
  winterDailyRate!: number | null;
  winterMonthlySalary!: number | null;
  winterScheduleCode!: string | null;
  winterScheduleWeekdays!: string[];
  winterScheduleCycleStartDate!: string | null;
  notes!: string | null;
  counterparty!: {
    id: string;
    name: string;
    legalName: string | null;
    status: string;
    canOpenCounterparty: boolean;
  } | null;
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
    canViewCompensationRates: boolean;
    canManageCompensationRates: boolean;
    canEditMonthlySalary: boolean;
    canChangeStatus: boolean;
    canManageResponsibles: boolean;
    canManageManagers: boolean;
    canCreateTask: boolean;
    canViewBasicProfile: boolean;
    canViewOperationalSections: boolean;
    canManageEmployees: boolean;
    canViewEmployees: boolean;
    canOperateAttendance: boolean;
    canAddExtraShift: boolean;
  };
}
