'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Alert, Button, Field, IconButton } from '@/shared/ui/foundation';

import styles from './overlays.module.css';

type DialogSize = 'compact' | 'standard';
type DrawerSize = 'preview' | 'review';
type ConfirmTone = 'neutral' | 'danger';
type ReasonTone = 'warning' | 'danger';

interface ModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement>;
  returnFocusRef?: React.RefObject<HTMLElement>;
  presentation: 'dialog' | 'drawer';
  size: DialogSize | DrawerSize;
}

let modalLockCount = 0;
let previousBodyOverflow = '';
let inertedBodyChildren: Array<{ element: HTMLElement; hadInert: boolean }> = [];
const dialogStack: string[] = [];

function ensureOverlayHost(): HTMLElement {
  const existing = document.getElementById('ui-overlay-root');

  if (existing instanceof HTMLElement) {
    return existing;
  }

  const host = document.createElement('div');
  host.id = 'ui-overlay-root';
  document.body.appendChild(host);
  return host;
}

function lockModalEnvironment(host: HTMLElement): void {
  if (modalLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inertedBodyChildren = [];

    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child === host) {
        continue;
      }

      inertedBodyChildren.push({
        element: child,
        hadInert: child.hasAttribute('inert'),
      });
      child.setAttribute('inert', '');
    }
  }

  modalLockCount += 1;
}

function unlockModalEnvironment(): void {
  modalLockCount = Math.max(0, modalLockCount - 1);

  if (modalLockCount !== 0) {
    return;
  }

  document.body.style.overflow = previousBodyOverflow;

  for (const { element, hadInert } of inertedBodyChildren) {
    if (!element.isConnected || hadInert) {
      continue;
    }

    element.removeAttribute('inert');
  }

  inertedBodyChildren = [];
}


function syncOverlayInert(host: HTMLElement): void {
  const topId = dialogStack[dialogStack.length - 1];

  for (const child of Array.from(host.children)) {
    if (!(child instanceof HTMLElement) || child.dataset.uiOverlay !== 'true') {
      continue;
    }

    if (topId && child.dataset.overlayId !== topId) {
      child.setAttribute('inert', '');
    } else {
      child.removeAttribute('inert');
    }
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0,
  );
}

function isTopDialog(id: string): boolean {
  return dialogStack[dialogStack.length - 1] === id;
}

function ModalShell({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  children,
  footer,
  initialFocusRef,
  returnFocusRef,
  presentation,
  size,
}: ModalShellProps): React.JSX.Element | null {
  const instanceId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalHost(ensureOverlayHost());
  }, []);

  useEffect(() => {
    if (!open || !portalHost) {
      return;
    }

    previousActiveRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    dialogStack.push(instanceId);
    lockModalEnvironment(portalHost);
    syncOverlayInert(portalHost);

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const preferred = initialFocusRef?.current;

      if (preferred?.isConnected) {
        preferred.focus();
        return;
      }

      const marked = panel?.querySelector<HTMLElement>('[autofocus]');
      const firstFocusable = panel ? getFocusableElements(panel)[0] : null;
      (marked ?? firstFocusable ?? panel)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);

      const stackIndex = dialogStack.lastIndexOf(instanceId);
      if (stackIndex >= 0) {
        dialogStack.splice(stackIndex, 1);
      }

      syncOverlayInert(portalHost);
      unlockModalEnvironment();

      const previous = previousActiveRef.current;
      const fallback = returnFocusRef?.current;
      const target = previous?.isConnected ? previous : fallback?.isConnected ? fallback : null;

      if (target) {
        window.requestAnimationFrame(() => {
          target.focus();
        });
      }
    };
  }, [initialFocusRef, instanceId, open, portalHost, returnFocusRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTopDialog(instanceId)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();

        if (!busy) {
          onOpenChange(false);
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }

      const focusable = getFocusableElements(panel);

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (event.shiftKey) {
        if (!active || active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [busy, instanceId, onOpenChange, open]);

  if (!open || !portalHost) {
    return null;
  }

  const requestClose = (): void => {
    if (!busy && isTopDialog(instanceId)) {
      onOpenChange(false);
    }
  };

  return createPortal(
    <div
      className={styles.overlay}
      data-ui-overlay="true"
      data-overlay-id={instanceId}
      data-presentation={presentation}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={panelRef}
        className={styles.panel}
        data-presentation={presentation}
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description ? (
              <div className={styles.description} id={descriptionId}>
                {description}
              </div>
            ) : null}
          </div>
          <IconButton
            className={styles.closeButton}
            aria-label="Закрыть"
            disabled={busy}
            onClick={requestClose}
          >
            <span aria-hidden="true">×</span>
          </IconButton>
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </div>,
    portalHost,
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  size?: DialogSize;
  initialFocusRef?: React.RefObject<HTMLElement>;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export function Dialog({
  size = 'standard',
  ...props
}: DialogProps): React.JSX.Element | null {
  return <ModalShell {...props} presentation="dialog" size={size} />;
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  size?: DrawerSize;
  initialFocusRef?: React.RefObject<HTMLElement>;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export function Drawer({
  size = 'review',
  ...props
}: DrawerProps): React.JSX.Element | null {
  return <ModalShell {...props} presentation="drawer" size={size} />;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  consequence: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: ConfirmTone;
  pending?: boolean;
  error?: React.ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  tone = 'neutral',
  pending = false,
  error,
  returnFocusRef,
}: ConfirmDialogProps): React.JSX.Element | null {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      busy={pending}
      size="compact"
      returnFocusRef={returnFocusRef}
      footer={
        <div className={styles.dialogActions}>
          <Button
            autoFocus={tone === 'danger'}
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            autoFocus={tone === 'neutral'}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            pending={pending}
            pendingLabel="Выполнение…"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogContent}>
        <p className={styles.consequence}>{consequence}</p>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: (reason: string) => void;
  reasonLabel?: string;
  confirmLabel: string;
  required?: boolean;
  tone?: ReasonTone;
  pending?: boolean;
  error?: React.ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reason,
  onReasonChange,
  onConfirm,
  reasonLabel = 'Причина',
  confirmLabel,
  required = true,
  tone = 'danger',
  pending = false,
  error,
  returnFocusRef,
}: ReasonDialogProps): React.JSX.Element | null {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedReason = reason.trim();
  const invalid = required && !trimmedReason;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      busy={pending}
      size="compact"
      initialFocusRef={textareaRef}
      returnFocusRef={returnFocusRef}
      footer={
        <div className={styles.dialogActions}>
          <Button disabled={pending} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            pending={pending}
            pendingLabel="Выполнение…"
            disabled={invalid}
            onClick={() => {
              if (invalid) {
                textareaRef.current?.focus();
                return;
              }

              onConfirm(trimmedReason);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogContent}>
        <Field label={reasonLabel} required={required}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            rows={4}
            value={reason}
            disabled={pending}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </Field>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
