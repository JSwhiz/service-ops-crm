'use client';

import React, { createContext, useEffect, useMemo, useState } from 'react';

import {
  getMe,
  login as loginRequest,
  type AuthUser,
  type LoginPayload,
} from './auth-client';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from './auth-storage';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      const accessToken = getAccessToken();

      if (!accessToken) {
        setIsLoading(false);
        return;
      }

      try {
        const me = await getMe(accessToken);
        setUser(me);
      } catch {
        clearTokens();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrap();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login: async (payload: LoginPayload) => {
        const response = await loginRequest(payload);
        setTokens(response.accessToken, response.refreshToken);
        setUser(response.user);
      },
      logout: () => {
        clearTokens();
        setUser(null);
      },
    }),
    [user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
