import { AccessRule } from './access-policy.type';

export interface SystemUser {
  accessVersion?: number;
  accessRules?: readonly AccessRule[];
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
  permissionCodes?: string[];
}
