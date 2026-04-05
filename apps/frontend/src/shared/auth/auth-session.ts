import { fetcher } from '@/shared/api/fetcher';

import { clearTokens, getRefreshToken, setTokens } from './auth-storage';

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    login: string;
    fullName: string;
    roleCode: string;
    roleCodes?: string[];
    isActive: boolean;
  };
}

let refreshPromise: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();

    if (!refreshToken) {
      clearTokens();
      return null;
    }

    try {
      const response = await fetcher<RefreshResponse>('/auth/refresh', {
        method: 'POST',
        refreshToken,
        skipAuthRetry: true,
      });

      setTokens(response.accessToken, response.refreshToken);
      return response.accessToken;
    } catch {
      clearTokens();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
