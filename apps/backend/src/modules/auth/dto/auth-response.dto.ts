export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  user!: {
    id: string;
    login: string;
    fullName: string;
    roleCode: string;
    roleCodes: string[];
    isActive: boolean;
  };
}
