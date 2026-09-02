'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/shared/lib/cn';

interface NavLinkProps {
  href: string;
  label: string;
  icon?: React.ReactNode;
  className?: string;
}

interface TooltipPosition {
  left: number;
  top: number;
}

const TOOLTIP_DELAY_MS = 320;

export function NavLink({
  href,
  label,
  icon,
  className,
}: NavLinkProps): React.JSX.Element {
  const pathname = usePathname();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  const clearTooltipTimer = (): void => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  };

  const showCollapsedTooltip = (): void => {
    const link = linkRef.current;
    if (!link) return;

    const shell = link.closest('.app-shell') as HTMLElement | null;
    if (shell?.dataset.sidebarExpanded === 'true') {
      clearTooltipTimer();
      setTooltipPosition(null);
      return;
    }

    clearTooltipTimer();
    tooltipTimerRef.current = setTimeout(() => {
      const currentLink = linkRef.current;
      if (!currentLink) return;
      const rect = currentLink.getBoundingClientRect();
      setTooltipPosition({
        left: rect.right + 8,
        top: rect.top + rect.height / 2,
      });
      tooltipTimerRef.current = null;
    }, TOOLTIP_DELAY_MS);
  };

  const hideTooltip = (): void => {
    clearTooltipTimer();
    setTooltipPosition(null);
  };

  useEffect(() => () => clearTooltipTimer(), []);

  return (
    <>
      <Link
        ref={linkRef}
        href={href}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        className={cn(
          'app-sidebar__link',
          className,
          isActive && 'app-sidebar__link--active',
        )}
        onPointerEnter={showCollapsedTooltip}
        onPointerLeave={hideTooltip}
        onFocus={showCollapsedTooltip}
        onBlur={hideTooltip}
      >
        {icon ? <span className="app-sidebar__link-icon" aria-hidden="true">{icon}</span> : null}
        <span className="app-sidebar__link-label">{label}</span>
      </Link>

      {tooltipPosition && typeof document !== 'undefined'
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              className="app-sidebar-tooltip"
              style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
