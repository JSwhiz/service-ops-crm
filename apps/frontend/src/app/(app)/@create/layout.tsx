'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

/** An unmatched parallel slot can retain its last page during soft navigation. */
export default function CreateSlotLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const pathname = usePathname();
  return pathname.endsWith('/new') ? <>{children}</> : null;
}
