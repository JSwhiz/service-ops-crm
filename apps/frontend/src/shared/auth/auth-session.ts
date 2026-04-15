import { fetcher } from '@/shared/api/fetcher';

interface RefreshResponse {
  user: {
    id: string;
    login: string;
    fullName: string;
    roleCode: string;
    roleCodes?: string[];
    isActive: boolean;
  };
}

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
      await fetcher<RefreshResponse>('/auth/refresh', {
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
