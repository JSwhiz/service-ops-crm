import { appConfig } from '@/shared/config/app-config';
import { getAccessToken } from '@/shared/auth/auth-storage';
import { refreshAccessToken } from '@/shared/auth/auth-session';

interface FetcherOptions extends RequestInit {
  token?: string | null;
  refreshToken?: string | null;
  skipAuthRetry?: boolean;
}

function buildErrorMessage(
  method: string,
  url: string,
  status: number,
  rawBody: string,
): string {
  if (!rawBody.trim()) {
    return `${method} ${url} failed with status ${status}`;
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      message?: string | string[];
      error?: string;
    };

    const message = Array.isArray(parsed.message)
      ? parsed.message.join(', ')
      : parsed.message;

    if (message) {
      return `${method} ${url} failed with status ${status}: ${message}`;
    }

    if (parsed.error) {
      return `${method} ${url} failed with status ${status}: ${parsed.error}`;
    }
  } catch {
    // ignore JSON parse failure
  }

  return `${method} ${url} failed with status ${status}: ${rawBody}`;
}

async function executeRequest(
  url: string,
  method: string,
  body: BodyInit | null | undefined,
  headers: Record<string, string>,
  rest: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...rest,
    method,
    body,
    headers,
    cache: 'no-store',
  });
}

export async function fetcher<T>(
  path: string,
  options: FetcherOptions = {},
): Promise<T> {
  const {
    token,
    refreshToken,
    headers,
    method,
    body,
    skipAuthRetry,
    ...rest
  } = options;

  const resolvedMethod = method ?? 'GET';
  const url = `${appConfig.apiUrl}${path}`;

  const explicitToken = token ?? undefined;
  const authToken =
    explicitToken !== undefined ? explicitToken : getAccessToken();

  const resolvedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(refreshToken ? { 'x-refresh-token': refreshToken } : {}),
    ...((headers as Record<string, string> | undefined) ?? {}),
  };

  if (body !== undefined && !resolvedHeaders['Content-Type']) {
    resolvedHeaders['Content-Type'] = 'application/json';
  }

  try {
    let response = await executeRequest(
      url,
      resolvedMethod,
      body,
      resolvedHeaders,
      rest,
    );

    if (response.status === 401 && !skipAuthRetry) {
      const refreshedAccessToken = await refreshAccessToken();

      if (refreshedAccessToken) {
        const retryHeaders: Record<string, string> = {
          ...resolvedHeaders,
          Authorization: `Bearer ${refreshedAccessToken}`,
        };

        response = await executeRequest(
          url,
          resolvedMethod,
          body,
          retryHeaders,
          rest,
        );
      }
    }

    if (!response.ok) {
      const rawBody = await response.text();
      throw new Error(
        buildErrorMessage(resolvedMethod, url, response.status, rawBody),
      );
    }

    const rawBody = await response.text();

    if (!rawBody.trim()) {
      return null as T;
    }

    return JSON.parse(rawBody) as T;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`${resolvedMethod} ${url} failed: ${error.message}`);
    }

    throw new Error(`${resolvedMethod} ${url} failed`);
  }
}
