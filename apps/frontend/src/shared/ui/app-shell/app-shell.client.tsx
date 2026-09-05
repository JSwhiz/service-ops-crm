'use client';

import { usePathname } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/shared/auth/use-auth';
import { recordRecentPath } from '@/shared/ui/global-command/global-command-recent';

import { AppHeader } from './app-header';
import styles from './app-shell.client.module.css';
import { AppSidebar } from './app-sidebar';

const SIDEBAR_STORAGE_KEY = 'service-ops.sidebar.expanded';

interface AppShellClientProps {
  children: React.ReactNode;
}

export function AppShellClient({ children }: AppShellClientProps): React.JSX.Element {
  const pathname = usePathname();
  const { user } = useAuth();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    try {
      setSidebarExpanded(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }, []);

  useEffect(() => {
    recordRecentPath(user?.id, pathname);
  }, [pathname, user?.id]);

  const toggleSidebar = useCallback((): void => {
    setSidebarExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Keep the in-memory preference even when persistence is unavailable.
      }
      return next;
    });
  }, []);

  const dashboardWide = pathname === '/dashboard';

  return (
    <div className="app-shell" data-sidebar-expanded={sidebarExpanded ? 'true' : 'false'}>
      <AppSidebar expanded={sidebarExpanded} onToggle={toggleSidebar} />

      <div className="app-main">
        <div className={styles.topbarAnchor}>
          <AppHeader />
        </div>
        <main className={`app-content${dashboardWide ? ` ${styles.dashboardWide}` : ''}`}>{children}</main>
      </div>
    </div>
  );
}
