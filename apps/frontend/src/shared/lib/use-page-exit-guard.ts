'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { getPageExitTarget } from '@/shared/lib/page-exit-target';
import type { ConfirmOptions } from '@/shared/ui/overlays/use-dialogs';

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;

/** Guards unsaved client-side forms against reloads and same-origin link navigation. */
export function usePageExitGuard(isDirty: boolean, confirm: ConfirmAction): void {
  const router = useRouter();

  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onDocumentClick = (event: MouseEvent): void => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;

      const navigationTarget = getPageExitTarget(anchor.href, window.location.href);
      if (!navigationTarget) return;

      event.preventDefault();
      void confirm({
        title: 'Покинуть страницу?',
        consequence: 'Несохранённые изменения будут потеряны.',
        confirmLabel: 'Перейти без сохранения',
        tone: 'danger',
      }).then((accepted) => {
        if (accepted) router.push(navigationTarget);
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, [confirm, isDirty, router]);
}
