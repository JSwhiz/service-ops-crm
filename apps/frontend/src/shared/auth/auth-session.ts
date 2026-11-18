import { fetcher } from '@/shared/api/fetcher';
import type { AuthResponse } from './auth-client';

const AUTH_CLEARED_EVENT = 'service-ops-auth-cleared';
const AUTH_LOGOUT_STORAGE_KEY = 'service-ops-auth-logout';
const AUTH_COOKIE_LOCK = 'service-ops-auth-cookie-write';
let refreshPromise: Promise<boolean> | null = null;
let refreshSuspensions = 0;

/** Block new cookie refreshes while logout drains existing auth requests. */
export function suspendSessionRefresh(): () => void {
  refreshSuspensions += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refreshSuspensions -= 1;
  };
}

export function waitForPendingSessionRefresh(): Promise<boolean> | null {
  return refreshPromise;
}

function emitAuthCleared(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
}

/** Cookie writes must finish in order across tabs sharing this origin. */
export async function withAuthCookieLock<T>(write: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return write();
  return await navigator.locks.request(AUTH_COOKIE_LOCK, write);
}

export function notifyOtherTabsOfLogout(): void {
  if (typeof window === 'undefined') return;
  try {
    // Only a signal. Never put credentials or account data in browser storage.
    window.localStorage.setItem(AUTH_LOGOUT_STORAGE_KEY, 'logout');
    window.localStorage.removeItem(AUTH_LOGOUT_STORAGE_KEY);
  } catch {
    // Storage can be disabled even when the logout endpoint succeeds.
  }
}

export function subscribeToAuthCleared(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const onOtherTabLogout = (event: StorageEvent): void => {
    if (event.key === AUTH_LOGOUT_STORAGE_KEY && event.newValue === 'logout') handler();
  };
  window.addEventListener(AUTH_CLEARED_EVENT, handler);
  window.addEventListener('storage', onOtherTabLogout);

  return () => {
    window.removeEventListener(AUTH_CLEARED_EVENT, handler);
    window.removeEventListener('storage', onOtherTabLogout);
  };
}

interface AccessChangeSignal {
  userId: string;
  revision: number | null;
}

const ACCESS_CHANGE_CHANNEL = 'service-ops-access-change';

export function notifyOtherTabsOfAccessChange(signal: AccessChangeSignal): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(ACCESS_CHANGE_CHANNEL);
  try {
    channel.postMessage(signal);
  } finally {
    channel.close();
  }
}

export function subscribeToAccessChange(handler: (signal: AccessChangeSignal) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(ACCESS_CHANGE_CHANNEL);
  channel.onmessage = ({ data }) => {
    if (data && typeof data.userId === 'string' &&
      (data.revision === null || (Number.isSafeInteger(data.revision) && data.revision >= 0))) {
      handler(data);
    }
  };
  return () => channel.close();
}

export async function refreshSession(): Promise<boolean> {
  if (refreshSuspensions > 0) return false;
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      return await withAuthCookieLock(async () => {
        if (refreshSuspensions > 0) return false;
        await fetcher<AuthResponse>('/auth/refresh', {
          method: 'POST',
          skipAuthRetry: true,
          signal: AbortSignal.timeout(30_000),
        });
        return true;
      });
    } catch {
      if (refreshSuspensions === 0) emitAuthCleared();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
