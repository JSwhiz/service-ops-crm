import React from 'react';

import { AppShellClient } from './app-shell.client';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return <AppShellClient>{children}</AppShellClient>;
}
