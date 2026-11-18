'use client';

import { useEffect, type RefObject } from 'react';
import { useAuth } from './use-auth';

const OPEN_ACCESS_RECHECK_MS = 5000;

/** Check the access revision while a protected surface is in use. */
export function useOpenAccessRefresh(enabled: boolean, surface?: RefObject<HTMLElement | null>, includeHidden = false): void {
  const { refreshUser } = useAuth();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number;
    let surfaceVisible = !surface;
    const check = async (): Promise<void> => {
      if (surfaceVisible && (includeHidden || document.visibilityState === 'visible')) {
        await refreshUser().catch(() => undefined);
      }
      if (active) timer = window.setTimeout(() => void check(), OPEN_ACCESS_RECHECK_MS);
    };
    const element = surface?.current;
    const observer = element
      ? new IntersectionObserver(([entry]) => {
          surfaceVisible = entry?.isIntersecting ?? false;
        })
      : null;
    if (element) observer?.observe(element);
    timer = window.setTimeout(() => void check(), OPEN_ACCESS_RECHECK_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [enabled, includeHidden, refreshUser, surface]);
}
