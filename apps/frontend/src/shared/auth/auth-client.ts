import { fetcher } from '@/shared/api/fetcher';

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes: string[];
  isActive: boolean;
}

export interface LoginPayload {
  login: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  return fetcher<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  return fetcher<AuthResponse>('/auth/refresh', {
    method: 'POST',
    refreshToken,
  });
}

export async function getMe(accessToken: string): Promise<AuthUser> {
  return fetcher<AuthUser>('/auth/me', {
    method: 'GET',
    token: accessToken,
  });
}
