export interface SystemUser {
  id: string;
  login: string;
  password: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
}
