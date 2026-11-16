'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/shared/auth/use-auth';
import { CreateNavigationProvider } from '@/shared/create-navigation';
import { CreateDraftProvider } from '@/shared/drafts';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { Alert, Button, Surface } from '@/shared/ui/foundation';
import { AppShell } from './app-shell';

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, capabilitiesRefreshError, refreshUser, logout } = useAuth();
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const checkAccess = async (): Promise<void> => {
    if (isCheckingAccess || isSigningOut) return;
    setIsCheckingAccess(true);
    setRecoveryError(null);
    try { await refreshUser({ force: true }); }
    catch { setRecoveryError('Проверка доступа пока недоступна. Попробуйте ещё раз позже или выйдите из аккаунта.'); }
    finally { setIsCheckingAccess(false); }
  };

  const signOut = async (): Promise<void> => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setRecoveryError(null);
    try { await logout(); }
    catch { setRecoveryError('Не удалось завершить выход. Попробуйте ещё раз.'); }
    finally { setIsSigningOut(false); }
  };

  useEffect(() => {
    const onWheel = (): void => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.type === 'number') active.blur();
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) return <div style={{ padding: 24 }}>Загрузка...</div>;
  if (!isAuthenticated || !user) return null;

  return (
    <CreateDraftProvider userId={user.id}>
      <CreateNavigationProvider>
        {capabilitiesRefreshError ? <main className="app-content">
          <Surface padding="md" className="ui-stack ui-stack--md">
            <Alert tone="warning" role="alert">Не удалось проверить актуальные права. Данные и действия временно скрыты; личные черновики сохранены.</Alert>
            {recoveryError ? <Alert tone="danger" role="alert">{recoveryError}</Alert> : null}
            <div className="ui-actions">
              <Button pending={isCheckingAccess} disabled={isCheckingAccess || isSigningOut} onClick={() => void checkAccess()}>Проверить доступ</Button>
              <Button pending={isSigningOut} disabled={isSigningOut} onClick={() => void signOut()}>Выйти</Button>
            </div>
          </Surface>
        </main> : null}
        <AccessSnapshotBoundary blocked={!!capabilitiesRefreshError}>
          <AppShell>{children}</AppShell>
        </AccessSnapshotBoundary>
      </CreateNavigationProvider>
    </CreateDraftProvider>
  );
}
