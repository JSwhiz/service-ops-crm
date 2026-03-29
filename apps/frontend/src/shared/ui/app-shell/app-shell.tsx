import React from 'react';

import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <div className="app-shell">
      <AppSidebar />

      <div className="app-main">
        <AppHeader />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
