'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { FormDialogCloseContext } from '@/shared/ui/overlays';
import { mergeCreateDestination } from './merge-create-destination';
import { createTargetSearch } from './target-search';
import { canRestoreCreateFocus, selectCreateReturnFocus } from './create-return-focus';
export { mergeCreateDestination } from './merge-create-destination';

interface CapturedCreateRoute {
  returnTo: string;
  targetSearch: string;
  opener: HTMLElement | null;
  openerHref: string | null;
}

interface ReturnFocusRequest { returnTo: string; opener: HTMLElement | null; openerHref: string | null; expiresAt: number }

interface CreateNavigationStore {
  routes: Map<string, CapturedCreateRoute>;
  queueFocus: (request: ReturnFocusRequest) => void;
}

const CreateNavigationContext = createContext<CreateNavigationStore | null>(null);

function routeKey(pathname: string, search: string): string {
  return `${pathname}${search ? `?${search}` : ''}`;
}

export function CreateNavigationProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const routes = useRef(new Map<string, CapturedCreateRoute>()).current;
  const [focusRequest, queueFocus] = useState<ReturnFocusRequest | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const store = useMemo<CreateNavigationStore>(() => ({ routes, queueFocus }), [routes]);
  useEffect(() => {
    if (!focusRequest) return;
    const usable = (node: HTMLElement): boolean => node !== document.body && node !== document.documentElement && node.isConnected && node.getClientRects().length > 0 && !node.matches(':disabled') && !node.closest('[inert], [hidden], dialog:not([open])');
    const attempt = (): void => {
      if (!canRestoreCreateFocus(focusRequest.returnTo, window.location.href, Boolean(document.querySelector('dialog[open]')))) return;
      const replacement = focusRequest.openerHref ? Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find((link) => link.href === focusRequest.openerHref) ?? null : null;
      const target = selectCreateReturnFocus(focusRequest.opener, replacement, document.querySelector<HTMLElement>('.global-create__trigger'), usable);
      if (target) { target.focus({ preventScroll: true }); if (document.activeElement === target) queueFocus(null); }
    };
    const frame = requestAnimationFrame(attempt);
    const observer = new MutationObserver(attempt);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'inert', 'hidden', 'disabled'] });
    const timeout = window.setTimeout(() => queueFocus(null), Math.max(0, focusRequest.expiresAt - Date.now()));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.clearTimeout(timeout); };
  }, [focusRequest, pathname, search]);
  return <CreateNavigationContext.Provider value={store}>{children}</CreateNavigationContext.Provider>;
}

/** Used only by FormDialog after explicit close/discard has been accepted. */
export function useCreateReturnFocus(): (returnTo: string) => void {
  const store = useContext(CreateNavigationContext);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return useCallback((returnTo: string) => {
    const captured = store?.routes.get(routeKey(pathname, search));
    store?.queueFocus({ returnTo, opener: captured?.opener ?? null, openerHref: captured?.openerHref ?? null, expiresAt: Date.now() + 5000 });
  }, [pathname, search, store]);
}

export interface CreateNavigation {
  getHref: (destinationHref: string) => string;
  open: (destinationHref: string) => boolean;
  closeContext: (directFallbackHref: string) => FormDialogCloseContext;
  /** Reads target query values for the form; on direct load, reads the URL query. */
  getTargetSearchParams: () => URLSearchParams;
}

export function useCreateNavigation(): CreateNavigation {
  const store = useContext(CreateNavigationContext);
  if (!store) throw new Error('useCreateNavigation must be used within CreateNavigationProvider');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentRoute = routeKey(pathname, search);

  const getHref = useCallback((destinationHref: string): string => {
    const merged = mergeCreateDestination(destinationHref, `https://create-navigation.invalid${currentRoute}`);
    return merged?.href ?? destinationHref;
  }, [currentRoute]);

  const open = useCallback((destinationHref: string): boolean => {
    const locationHref = window.location.href;
    const merged = mergeCreateDestination(destinationHref, locationHref);
    if (!merged) return false;
    const destination = new URL(merged.href, window.location.origin);
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    store.routes.set(routeKey(destination.pathname, destination.searchParams.toString()), {
      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      targetSearch: merged.targetSearch,
      opener,
      openerHref: opener instanceof HTMLAnchorElement ? opener.href : null,
    });
    router.push(merged.href);
    return true;
  }, [router, store]);

  const closeContext = useCallback((directFallbackHref: string): FormDialogCloseContext => {
    const captured = store.routes.get(currentRoute);
    return captured
      ? { kind: 'intercepted', returnTo: captured.returnTo }
      : { kind: 'direct', fallbackHref: directFallbackHref };
  }, [currentRoute, store]);

  const getTargetSearchParams = useCallback((): URLSearchParams => {
    const captured = store.routes.get(currentRoute);
    return createTargetSearch(captured, search);
  }, [currentRoute, search, store]);

  return useMemo(() => ({ getHref, open, closeContext, getTargetSearchParams }), [
    closeContext,
    getHref,
    getTargetSearchParams,
    open,
  ]);
}

export interface CreateNavigationLinkProps extends Omit<React.ComponentProps<typeof Link>, 'href'> {
  href: string;
}

/** Link for creation entry points; preserves the registry query and captures an explicit close target. */
export function CreateNavigationLink({ href, onClick, prefetch = false, ...props }: CreateNavigationLinkProps): React.JSX.Element {
  const navigation = useCreateNavigation();
  return (
    <Link
      {...props}
      href={navigation.getHref(href)}
      prefetch={prefetch}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || props.target || props.download
        ) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        navigation.open(href);
      }}
    />
  );
}
