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
    options?: ErrorOptions,
  ) {
    super(message, options);
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

function isTechnicalMessage(message: string): boolean {
  return /\b(?:prisma|queryfailederror|syntaxerror|typeerror|referenceerror|internal server error|bad request exception|failed to fetch|stack trace)\b|https?:\/\/|\bat\s+\S+\([^)]*:\d+:\d+\)/i.test(
    message,
  );
}

function buildApiError(
  status: number,
  rawBody: string,
): ApiError {
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as ParsedErrorBody;
      const extractedMessage = extractMessageFromParsedBody(parsed);

      if (
        extractedMessage &&
        status < 500 &&
        !isTechnicalMessage(extractedMessage)
      ) {
        return new ApiError(
          extractedMessage,
          status,
          extractCodeFromParsedBody(parsed),
        );
      }
    } catch {
      // Raw response bodies can contain framework diagnostics; never display them.
    }
  }

  const fallbackMessage =
    status === 401
      ? 'Сеанс завершён. Войдите в систему и повторите действие.'
      : status === 403
        ? 'Недостаточно прав для этого действия.'
        : status === 404
          ? 'Запись не найдена или недоступна.'
          : status === 409
            ? 'Данные изменились. Обновите страницу и повторите действие.'
            : status === 422
              ? 'Проверьте введённые данные и повторите попытку.'
              : status === 429
                ? 'Слишком много запросов. Подождите и попробуйте снова.'
                : status >= 500
                  ? 'Не удалось выполнить действие. Попробуйте позже.'
                  : 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.';

  return new ApiError(fallbackMessage, status, null);
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
      throw buildApiError(response.status, rawBody);
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

    if (error instanceof TypeError) {
      throw new ApiError(
        'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.',
        0,
        'NETWORK_ERROR',
        { cause: error },
      );
    }

    throw new Error('Не удалось выполнить запрос. Попробуйте ещё раз.', {
      cause: error,
    });
  }
}
