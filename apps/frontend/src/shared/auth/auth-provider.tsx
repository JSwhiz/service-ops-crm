'use client';

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  type AuthUser,
  type LoginPayload,
} from './auth-client';
import { subscribeToAuthCleared } from './auth-session';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  capabilitiesRefreshError: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isAuthenticated = Boolean(user);
  const [capabilitiesRefreshError, setCapabilitiesRefreshError] = useState<string | null>(null);
  const sessionVersion = useRef(0);
  const mounted = useRef(false);
  const refreshInFlight = useRef<{ version: number; promise: Promise<void> } | null>(null);

  const router = useRouter();
  const pathname = usePathname();

  const refreshUser = useCallback(({ force = false }: { force?: boolean } = {}): Promise<void> => {
    // A post-save refresh must not reuse a request started before the mutation.
    if (force) sessionVersion.current += 1;
    const version = sessionVersion.current;
    if (refreshInFlight.current?.version === version) {
      return refreshInFlight.current.promise;
    }

    const promise = getMe()
      .then((me) => {
        if (!mounted.current || sessionVersion.current !== version) return;
        setUser(me);
        setCapabilitiesRefreshError(null);
      })
      .catch((error: unknown) => {
        if (mounted.current && sessionVersion.current === version) {
          setCapabilitiesRefreshError('Не удалось обновить права. Проверьте подключение и повторите обновление.');
        }
        throw error;
      })
      .finally(() => {
        if (refreshInFlight.current?.promise === promise) refreshInFlight.current = null;
      });
    refreshInFlight.current = { version, promise };
    return promise;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const version = sessionVersion.current;
    void refreshUser()
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current && sessionVersion.current === version) setIsLoading(false);
      });
    return () => {
      mounted.current = false;
      sessionVersion.current += 1;
    };
  }, [refreshUser]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshOnFocus = (): void => {
      if (document.visibilityState !== 'visible') return;
      void refreshUser().catch(() => undefined);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [isAuthenticated, refreshUser]);

  useEffect(() => {
    return subscribeToAuthCleared(() => {
      sessionVersion.current += 1;
      setUser(null);
      setCapabilitiesRefreshError(null);
      setIsLoading(false);

      if (typeof window !== 'undefined' && pathname !== '/login') {
        router.replace('/login');
      }
    });
  }, [pathname, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated,
      refreshUser,
      capabilitiesRefreshError,
      login: async (payload: LoginPayload) => {
        const version = ++sessionVersion.current;
        const response = await loginRequest(payload);
        if (!mounted.current || sessionVersion.current !== version) return;
        setUser(response.user);
        setCapabilitiesRefreshError(null);
        setIsLoading(false);
      },
      logout: async () => {
        sessionVersion.current += 1;
        setUser(null);
        setCapabilitiesRefreshError(null);
        setIsLoading(false);
        try {
          await logoutRequest();
        } catch {
          // local auth state should still be cleared on logout intent
        }

        if (typeof window !== 'undefined' && pathname !== '/login') {
          router.replace('/login');
        }
      },
    }),
    [user, isLoading, isAuthenticated, refreshUser, capabilitiesRefreshError, pathname, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
