import { appConfig } from '@/shared/config/app-config';

interface FetcherOptions extends RequestInit {
  token?: string | null;
  refreshToken?: string | null;
}

export async function fetcher<T>(
  path: string,
  options: FetcherOptions = {},
): Promise<T> {
  const { token, refreshToken, headers, ...rest } = options;

  const response = await fetch(`${appConfig.apiUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(refreshToken ? { 'x-refresh-token': refreshToken } : {}),
      ...(headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  return response.json() as Promise<T>;
}
