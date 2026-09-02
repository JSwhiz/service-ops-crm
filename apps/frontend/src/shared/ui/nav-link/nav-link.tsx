'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

import { cn } from '@/shared/lib/cn';

interface NavLinkProps {
  href: string;
  label: string;
  icon?: React.ReactNode;
  className?: string;
}

export function NavLink({
  href,
  label,
  icon,
  className,
}: NavLinkProps): React.JSX.Element {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'app-sidebar__link',
        className,
        isActive && 'app-sidebar__link--active',
      )}
    >
      {icon ? <span className="app-sidebar__link-icon" aria-hidden="true">{icon}</span> : null}
      <span className="app-sidebar__link-label">{label}</span>
    </Link>
  );
}
