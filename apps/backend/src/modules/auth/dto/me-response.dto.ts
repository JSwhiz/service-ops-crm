export class MeResponseDto {
  id!: string;
  login!: string;
  fullName!: string;
  roleCode!: string;
  roleCodes!: string[];
  isActive!: boolean;
  capabilities!: {
    canCreateObject: boolean;
    canAccessEmployeesHr: boolean;
    canManageEmployeesHr: boolean;
  };
}
