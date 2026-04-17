import { fetcher } from '@/shared/api/fetcher';

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes: string[];
  isActive: boolean;
  capabilities?: {
    canCreateObject: boolean;
    canAccessEmployeesHr?: boolean;
    canManageEmployeesHr?: boolean;
  };
}

export interface LoginPayload {
  login: string;
  password: string;
}

export interface AuthResponse {
  user: AuthUser;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  return fetcher<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function refreshSessionRequest(): Promise<AuthResponse> {
  return fetcher<AuthResponse>('/auth/refresh', {
    method: 'POST',
  });
}

export async function getMe(): Promise<AuthUser> {
  return fetcher<AuthUser>('/auth/me', {
    method: 'GET',
  });
}

export async function logout(): Promise<{ success: true }> {
  return fetcher<{ success: true }>('/auth/logout', {
    method: 'POST',
  });
}
