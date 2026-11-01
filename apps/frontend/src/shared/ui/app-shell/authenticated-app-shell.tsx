'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/shared/auth/use-auth';
import { CreateNavigationProvider } from '@/shared/create-navigation';
import { CreateDraftProvider } from '@/shared/drafts';
import { AppShell } from './app-shell';

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

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
        <AppShell>{children}</AppShell>
      </CreateNavigationProvider>
    </CreateDraftProvider>
  );
}
