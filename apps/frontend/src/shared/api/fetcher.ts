import { appConfig } from '@/shared/config/app-config';
import { refreshSession } from '@/shared/auth/auth-session';

interface FetcherOptions extends RequestInit {
  skipAuthRetry?: boolean;
}

type ParsedErrorBody = {
  code?: string;
  message?: string | string[];
  error?: string | { code?: string; message?: string | string[]; error?: string };
  statusCode?: number;
  path?: string;
  method?: string;
  timestamp?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function extractCodeFromParsedBody(parsed: ParsedErrorBody): string | null {
  if (typeof parsed.code === 'string' && parsed.code.trim()) {
    return parsed.code;
  }

  if (
    parsed.error &&
    typeof parsed.error === 'object' &&
    typeof parsed.error.code === 'string' &&
    parsed.error.code.trim()
  ) {
    return parsed.error.code;
  }

  return null;
}

function extractMessageFromParsedBody(parsed: ParsedErrorBody): string | null {
  if (Array.isArray(parsed.message)) {
    return parsed.message.join(', ');
  }

  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return parsed.message;
  }

  if (parsed.error && typeof parsed.error === 'object') {
    if (Array.isArray(parsed.error.message)) {
      return parsed.error.message.join(', ');
    }

    if (
      typeof parsed.error.message === 'string' &&
      parsed.error.message.trim()
    ) {
      return parsed.error.message;
    }

    if (typeof parsed.error.error === 'string' && parsed.error.error.trim()) {
      return parsed.error.error;
    }
  }

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return parsed.error;
  }

  return null;
}

function buildApiError(
  method: string,
  url: string,
  status: number,
  rawBody: string,
): ApiError {
  if (!rawBody.trim()) {
    return new ApiError(
      `${method} ${url} failed with status ${status}`,
      status,
      null,
    );
  }

  try {
    const parsed = JSON.parse(rawBody) as ParsedErrorBody;
    const extractedMessage = extractMessageFromParsedBody(parsed);

    if (extractedMessage) {
      return new ApiError(
        `${method} ${url} failed with status ${status}: ${extractedMessage}`,
        status,
        extractCodeFromParsedBody(parsed),
      );
    }
  } catch {
    // ignore JSON parse failure
  }

  return new ApiError(
    `${method} ${url} failed with status ${status}: ${rawBody}`,
    status,
    null,
  );
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
    credentials: rest.credentials ?? 'include',
  });
}

export async function fetcher<T>(
  path: string,
  options: FetcherOptions = {},
): Promise<T> {
  const {
    headers,
    method,
    body,
    skipAuthRetry,
    ...rest
  } = options;

  const resolvedMethod = method ?? 'GET';
  const url = `${appConfig.apiUrl}${path}`;

  const resolvedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string> | undefined) ?? {}),
  };

  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    !resolvedHeaders['Content-Type']
  ) {
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
      const refreshed = await refreshSession();

      if (refreshed) {
        response = await executeRequest(
          url,
          resolvedMethod,
          body,
          resolvedHeaders,
          rest,
        );
      }
    }

    if (!response.ok) {
      const rawBody = await response.text();
      throw buildApiError(resolvedMethod, url, response.status, rawBody);
    }

    const rawBody = await response.text();

    if (!rawBody.trim()) {
      return null as T;
    }

    return JSON.parse(rawBody) as T;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new Error(`${resolvedMethod} ${url} failed: ${error.message}`, {
        cause: error,
      });
    }

    throw new Error(`${resolvedMethod} ${url} failed`, {
      cause: error,
    });
  }
}
