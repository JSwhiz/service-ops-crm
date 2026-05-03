'use client';

import React, { createContext, useEffect, useMemo, useState } from 'react';
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

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    return subscribeToAuthCleared(() => {
      setUser(null);
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
      isAuthenticated: Boolean(user),
      login: async (payload: LoginPayload) => {
        const response = await loginRequest(payload);
        setUser(response.user);
      },
      logout: async () => {
        try {
          await logoutRequest();
        } catch {
          // local auth state should still be cleared on logout intent
        }

        setUser(null);

        if (typeof window !== 'undefined' && pathname !== '/login') {
          router.replace('/login');
        }
      },
    }),
    [user, isLoading, pathname, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
