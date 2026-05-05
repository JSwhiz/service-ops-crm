'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

import { cn } from '@/shared/lib/cn';

interface NavLinkProps {
  href: string;
  label: string;
  className?: string;
}

export function NavLink({
  href,
  label,
  className,
}: NavLinkProps): React.JSX.Element {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        'app-sidebar__link',
        className,
        isActive && 'app-sidebar__link--active',
      )}
    >
      {label}
    </Link>
  );
}
