export interface SystemUser {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
  permissionCodes?: string[];
}
