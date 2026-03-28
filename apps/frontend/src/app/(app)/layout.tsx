import React from 'react';

import { AppShell } from '@/shared/ui/app-shell/app-shell';

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <AppShell>{children}</AppShell>;
}
