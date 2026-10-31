'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import { useConfirm } from './use-dialogs';
import { Dialog } from './overlays';
import type { DialogSize } from './overlays';
import { getPageExitTarget } from '@/shared/lib/page-exit-target';
import { useCreateReturnFocus } from '@/shared/create-navigation/create-navigation';
import styles from './form-dialog.module.css';

export type FormDialogSize = DialogSize;

export interface FormDialogSection {
  id: string;
  label: string;
  invalid?: boolean;
  complete?: boolean;
}

export interface FormSectionNavigation {
  sections: FormDialogSection[];
  activeSectionId: string;
  onSectionChange: (id: string) => void;
}

export type FormDialogCloseContext =
  | { kind: 'intercepted'; returnTo: string }
  | { kind: 'direct'; fallbackHref: string };

export interface FormDialogActions {
  requestClose: () => Promise<void>;
}

export interface FormDialogProps {
  open: boolean;
  title: React.ReactNode;
  size: FormDialogSize;
  busy?: boolean;
  dirty: boolean;
  closeContext: FormDialogCloseContext;
  clearDraft: () => void;
  sections?: FormSectionNavigation;
  footer: React.ReactNode | ((actions: FormDialogActions) => React.ReactNode);
  children: React.ReactNode;
}

export function FormDialog({
  open,
  title,
  size,
  busy = false,
  dirty,
  closeContext,
  clearDraft,
  sections,
  footer,
  children,
}: FormDialogProps): React.JSX.Element {
  const router = useRouter();
  const returnFocus = useCreateReturnFocus();
  const [confirmDiscard, confirmDialog] = useConfirm();

  const requestClose = async (): Promise<void> => {
    if (busy) return;
    const directFallback = closeContext.kind === 'direct'
      ? getPageExitTarget(closeContext.fallbackHref, window.location.href)
      : null;
    const returnTarget = closeContext.kind === 'intercepted'
      ? getPageExitTarget(closeContext.returnTo, window.location.href)
      : directFallback;
    if (!returnTarget) return;
    if (dirty) {
      const confirmed = await confirmDiscard({
        title: 'Закрыть форму без сохранения?',
        consequence: 'Введённые данные будут удалены.',
        confirmLabel: 'Закрыть форму',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    clearDraft();
    returnFocus(returnTarget);
    router.replace(returnTarget);
  };

  return (
    <>
      {confirmDialog}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => { if (!nextOpen) void requestClose(); }}
        title={title}
        size={size}
        busy={busy}
        className={styles.formDialog}
        footer={typeof footer === 'function' ? footer({ requestClose }) : footer}
      >
        {sections ? (
          <nav className={styles.sections} aria-label="Разделы формы">
            {sections.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={sections.activeSectionId === section.id ? 'step' : undefined}
                aria-invalid={section.invalid || undefined}
                data-active={sections.activeSectionId === section.id ? 'true' : undefined}
                onClick={() => sections.onSectionChange(section.id)}
              >
                {section.label}{section.invalid ? ' · ошибка' : ''}
              </button>
            ))}
          </nav>
        ) : null}
        {children}
      </Dialog>
    </>
  );
}

