import './globals.css';
import type { Metadata } from 'next';
import React from 'react';

import { appConfig } from '@/shared/config/app-config';

export const metadata: Metadata = {
  title: appConfig.appName,
  description: 'Service Ops CRM frontend',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
