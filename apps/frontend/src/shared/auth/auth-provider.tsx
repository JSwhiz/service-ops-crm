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
import { notifyOtherTabsOfAccessChange, notifyOtherTabsOfLogout, subscribeToAccessChange, subscribeToAuthCleared, suspendSessionRefresh, waitForPendingSessionRefresh, withAuthCookieLock } from './auth-session';
import { ApiError } from '@/shared/api/fetcher';
import { updateAccessIdentity } from './access-generation';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  capabilitiesRefreshError: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const ACCESS_RECHECK_MS = 5_000;

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
  const acceptedProfile = useRef<AuthUser | null>(null);
  const profileDenied = useRef(false);
  const sessionVersion = useRef(0);
  const mounted = useRef(false);
  const refreshInFlight = useRef<{ version: number; promise: Promise<void> } | null>(null);
  const logoutInFlight = useRef<Promise<void> | null>(null);
  const profileRequests = useRef(new Set<Promise<void>>());
  const loginRequests = useRef(new Set<Promise<unknown>>());
  const loginSignals = useRef<Map<string, number> | null>(null);

  const router = useRouter();
  const pathname = usePathname();

  const refreshUser = useCallback(({ force = false }: { force?: boolean } = {}): Promise<void> => {
    // Focus events must not restore a profile while its cookie is being cleared.
    if (logoutInFlight.current) return Promise.resolve();
    // A post-save refresh must not reuse a request started before the mutation.
    if (force) sessionVersion.current += 1;
    const version = sessionVersion.current;
    if (refreshInFlight.current?.version === version) {
      return refreshInFlight.current.promise;
    }

    const promise = getMe()
      .then((me) => {
        if (!mounted.current || sessionVersion.current !== version) return;
        const previous = acceptedProfile.current;
        const wasDenied = profileDenied.current;
        acceptedProfile.current = me;
        profileDenied.current = false;
        updateAccessIdentity(`${me.id}:${me.accessVersion ?? 'legacy'}`);
        setUser(me);
        setCapabilitiesRefreshError(null);
        if (previous?.id === me.id && typeof me.accessVersion === 'number' &&
          (wasDenied || me.accessVersion > (previous.accessVersion ?? -1))) {
          notifyOtherTabsOfAccessChange({ userId: me.id, revision: me.accessVersion });
        }
      })
      .catch((error: unknown) => {
        if (mounted.current && sessionVersion.current === version) {
          setCapabilitiesRefreshError('Не удалось обновить права. Проверьте подключение и повторите обновление.');
          const previous = acceptedProfile.current;
          if (!profileDenied.current && previous && error instanceof ApiError &&
            (error.statusCode === 401 || error.statusCode === 403)) {
            profileDenied.current = true;
            updateAccessIdentity(`${previous.id}:recheck`);
            notifyOtherTabsOfAccessChange({ userId: previous.id, revision: null });
          }
        }
        throw error;
      })
      .finally(() => {
        profileRequests.current.delete(promise);
        if (refreshInFlight.current?.promise === promise) refreshInFlight.current = null;
      });
    profileRequests.current.add(promise);
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
    const needsLocalRecheck = typeof BroadcastChannel === 'undefined';
    let active = true;
    let timer: number | undefined;
    const refreshVisible = async (): Promise<void> => {
      if (document.visibilityState !== 'visible' || loginRequests.current.size > 0) return;
      await refreshUser({ force: needsLocalRecheck }).catch(() => undefined);
    };
    const refreshOnFocus = (): void => { void refreshVisible(); };
    const recheck = async (): Promise<void> => {
      // In a browser without tab messaging a new read must supersede an old
      // response still in flight. Wait for this check before scheduling again.
      await refreshVisible();
      if (active) timer = window.setTimeout(() => void recheck(), ACCESS_RECHECK_MS);
    };
    if (needsLocalRecheck) timer = window.setTimeout(() => void recheck(), ACCESS_RECHECK_MS);
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [isAuthenticated, refreshUser]);

  useEffect(() => subscribeToAccessChange(({ userId, revision }) => {
    const pendingLogin = loginSignals.current;
    if (pendingLogin) {
      pendingLogin.set(userId, (pendingLogin.get(userId) ?? 0) + 1);
      return;
    }
    const current = acceptedProfile.current;
    if (current?.id !== userId || logoutInFlight.current) return;
    if (revision === null ? profileDenied.current : !profileDenied.current && (current.accessVersion ?? -1) >= revision) return;

    // Hide stale reads immediately, and fence off a profile already in flight.
    updateAccessIdentity(`${userId}:recheck`);
    setCapabilitiesRefreshError('Проверяем доступ в этой вкладке…');
    void refreshUser({ force: true }).catch(() => undefined);
  }), [refreshUser]);

  useEffect(() => {
    return subscribeToAuthCleared(() => {
      sessionVersion.current += 1;
      acceptedProfile.current = null;
      profileDenied.current = false;
      updateAccessIdentity(null);
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
        await logoutInFlight.current;
        if (!mounted.current || sessionVersion.current !== version) {
          throw new Error('Вход отменён. Повторите попытку.');
        }
        const signals = new Map<string, number>();
        loginSignals.current = signals;
        const request = withAuthCookieLock(async () => {
          if (!mounted.current || sessionVersion.current !== version) {
            throw new Error('Вход отменён. Повторите попытку.');
          }
          const issued = await loginRequest(payload);
          if (!mounted.current || sessionVersion.current !== version) {
            throw new Error('Вход отменён. Повторите попытку.');
          }
          // The browser may have applied old Set-Cookie headers after a deny.
          // Confirm the current policy before accepting the issued identity.
          let confirmed: AuthUser;
          const checkedSignal = signals.get(issued.user.id);
          try {
            const provisional = await getMe({ confirmLogin: true });
            if (!mounted.current || sessionVersion.current !== version) {
              throw new Error('Вход отменён. Повторите попытку.');
            }
            if (provisional.id !== issued.user.id) {
              throw new Error('Сессия изменилась. Повторите вход.');
            }
            // A confirmation body can itself arrive late when tab messaging is
            // unavailable. Do not publish it: start a fresh policy checkpoint
            // after receiving it, and accept only the checkpoint's profile.
            confirmed = await getMe({ confirmLogin: true });
            if (checkedSignal !== signals.get(issued.user.id)) {
              throw new Error('Права изменились. Повторите вход.');
            }
          } catch (error) {
            if (mounted.current && sessionVersion.current === version &&
              typeof navigator !== 'undefined' && navigator.locks &&
              error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) {
              // Only a real cross-tab cookie lock proves this jar still belongs
              // to the attempted login. Without it, leave a newer session alone.
              await logoutRequest().then(notifyOtherTabsOfLogout, () => undefined);
            }
            throw error;
          }
          if (confirmed.id !== issued.user.id) throw new Error('Сессия изменилась. Повторите вход.');
          return { confirmed, checkedSignal };
        });
        loginRequests.current.add(request);
        try {
          const { confirmed, checkedSignal } = await request;
          if (!mounted.current || sessionVersion.current !== version) {
            throw new Error('Вход отменён. Повторите попытку.');
          }
          if (checkedSignal !== signals.get(confirmed.id)) {
            throw new Error('Права изменились. Повторите вход.');
          }
          acceptedProfile.current = confirmed;
          profileDenied.current = false;
          updateAccessIdentity(`${confirmed.id}:${confirmed.accessVersion ?? 'legacy'}`);
          setUser(confirmed);
          setCapabilitiesRefreshError(null);
        } catch (error) {
          if (mounted.current && sessionVersion.current === version) {
            acceptedProfile.current = null;
            profileDenied.current = false;
            updateAccessIdentity(null);
            setUser(null);
            setCapabilitiesRefreshError(null);
          }
          throw error;
        } finally {
          loginRequests.current.delete(request);
          if (loginSignals.current === signals) loginSignals.current = null;
          if (mounted.current && sessionVersion.current === version) setIsLoading(false);
        }
      },
      logout: async () => {
        if (logoutInFlight.current) return logoutInFlight.current;
        const version = ++sessionVersion.current;
        const resumeRefresh = suspendSessionRefresh();
        const pendingRequests = [...profileRequests.current, ...loginRequests.current];
        const pendingRefresh = waitForPendingSessionRefresh();
        if (pendingRefresh) pendingRequests.push(pendingRefresh);
        acceptedProfile.current = null;
        profileDenied.current = false;
        updateAccessIdentity(null);
        setUser(null);
        setCapabilitiesRefreshError(null);
        setIsLoading(true);
        const pending = Promise.resolve().then(async () => {
          // A profile read can refresh cookies; finish it before clearing them.
          await Promise.allSettled(pendingRequests);
          try {
            await withAuthCookieLock(async () => {
              await logoutRequest();
              notifyOtherTabsOfLogout();
            });
          } catch {
            // Local auth state should still be cleared on logout intent.
          }
        }).finally(() => {
          resumeRefresh();
          if (logoutInFlight.current === pending) logoutInFlight.current = null;
          if (!mounted.current || sessionVersion.current !== version) return;
          setIsLoading(false);
          if (typeof window !== 'undefined' && pathname !== '/login') router.replace('/login');
        });
        logoutInFlight.current = pending;
        return pending;
      },
    }),
    [user, isLoading, isAuthenticated, refreshUser, capabilitiesRefreshError, pathname, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
