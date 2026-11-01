import React from 'react';
import { AuthenticatedAppShell } from '@/shared/ui/app-shell/authenticated-app-shell';

export default function AppLayout({
  children,
  create,
}: Readonly<{ children: React.ReactNode; create: React.ReactNode }>): React.JSX.Element {
  return (
    <AuthenticatedAppShell>
      {children}
      {create}
    </AuthenticatedAppShell>
  );
}
