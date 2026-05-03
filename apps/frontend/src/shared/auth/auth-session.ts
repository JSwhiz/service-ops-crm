import { fetcher } from '@/shared/api/fetcher';
import type { AuthResponse } from './auth-client';

const AUTH_CLEARED_EVENT = 'service-ops-auth-cleared';
let refreshPromise: Promise<boolean> | null = null;

function emitAuthCleared(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
}

export function subscribeToAuthCleared(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(AUTH_CLEARED_EVENT, handler);

  return () => {
    window.removeEventListener(AUTH_CLEARED_EVENT, handler);
  };
}

export async function refreshSession(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      await fetcher<AuthResponse>('/auth/refresh', {
        method: 'POST',
        skipAuthRetry: true,
      });

      return true;
    } catch {
      emitAuthCleared();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
