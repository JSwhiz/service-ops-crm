import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../constants/auth.constants';

function parseSameSite(
  rawValue: string | undefined,
): CookieOptions['sameSite'] {
  switch (rawValue?.trim().toLowerCase()) {
    case 'strict':
      return 'strict';
    case 'none':
      return 'none';
    case 'lax':
    default:
      return 'lax';
  }
}

function buildBaseCookieOptions(
  configService: ConfigService,
): Pick<CookieOptions, 'domain' | 'httpOnly' | 'sameSite' | 'secure'> {
  const cookieDomain = configService.get<string>('auth.cookieDomain');

  return {
    domain: cookieDomain?.trim() ? cookieDomain.trim() : undefined,
    httpOnly: true,
    sameSite: parseSameSite(configService.get<string>('auth.cookieSameSite')),
    secure: configService.get<boolean>('auth.cookieSecure') ?? false,
  };
}

export function getCookieValue(
  rawCookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!rawCookieHeader?.trim()) {
    return null;
  }

  const pairs = rawCookieHeader.split(';');

  for (const pair of pairs) {
    const trimmedPair = pair.trim();

    if (!trimmedPair) {
      continue;
    }

    const separatorIndex = trimmedPair.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const name = trimmedPair.slice(0, separatorIndex).trim();

    if (name !== cookieName) {
      continue;
    }

    const value = trimmedPair.slice(separatorIndex + 1);
    return decodeURIComponent(value);
  }

  return null;
}

export function setAuthCookies(
  response: Response,
  configService: ConfigService,
  params: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  },
): void {
  const baseOptions = buildBaseCookieOptions(configService);

  response.cookie(ACCESS_TOKEN_COOKIE, params.accessToken, {
    ...baseOptions,
    expires: params.accessExpiresAt,
    path: '/',
  });

  response.cookie(REFRESH_TOKEN_COOKIE, params.refreshToken, {
    ...baseOptions,
    expires: params.refreshExpiresAt,
    path: '/api/v1/auth',
  });
}

export function clearAuthCookies(
  response: Response,
  configService: ConfigService,
): void {
  const baseOptions = buildBaseCookieOptions(configService);

  response.clearCookie(ACCESS_TOKEN_COOKIE, {
    ...baseOptions,
    path: '/',
  });

  response.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...baseOptions,
    path: '/api/v1/auth',
  });
}
