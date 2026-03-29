'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/shared/auth/use-auth';
import { AppShell } from '@/shared/ui/app-shell/app-shell';

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element | null {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <div style={{ padding: 24 }}>Загрузка...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
