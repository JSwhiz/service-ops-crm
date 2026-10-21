'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Rows-per-page kept in the `limit` URL parameter so Back and shared links
 * restore it. Changing the size drops `page` (and calls `onChange`, for
 * registries that keep the page in local state).
 */
export function usePageSizeParam(
  defaultSize: number,
  options: ReadonlyArray<number> = [defaultSize, 50, 100],
  onChange?: () => void,
): { pageSize: number; pageSizeOptions: number[]; setPageSize: (size: number) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allowed = [...new Set([defaultSize, ...options])].sort((left, right) => left - right);
  const requested = Number(searchParams.get('limit'));
  const pageSize = allowed.includes(requested) ? requested : defaultSize;

  const setPageSize = useCallback((size: number): void => {
    const next = new URLSearchParams(searchParams.toString());
    if (size === defaultSize) next.delete('limit');
    else next.set('limit', String(size));
    next.delete('page');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    onChange?.();
  }, [defaultSize, onChange, pathname, router, searchParams]);

  return { pageSize, pageSizeOptions: allowed, setPageSize };
}
