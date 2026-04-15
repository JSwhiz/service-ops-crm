export class AuthResponseDto {
  user!: {
    id: string;
    login: string;
    fullName: string;
    roleCode: string;
    roleCodes: string[];
    isActive: boolean;
  };
}
