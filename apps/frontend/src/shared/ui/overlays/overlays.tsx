'use client';

import React, { useEffect, useId, useRef } from 'react';

import { Alert, Button, Field, IconButton } from '@/shared/ui/foundation';

import styles from './overlays.module.css';

type OverlayKind = 'dialog' | 'drawer';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function getInitialFocusTarget(root?: HTMLElement | null): HTMLElement | null {
  if (!root) {
    return null;
  }

  if (root.matches(FOCUSABLE_SELECTOR)) {
    return root;
  }

  return root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

interface OverlayFrameProps
  extends Omit<
    React.DialogHTMLAttributes<HTMLDialogElement>,
    'open' | 'title' | 'onClose' | 'onCancel'
  > {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  busy?: boolean;
  footer?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement>;
  returnFocusRef?: React.RefObject<HTMLElement>;
  kind: OverlayKind;
}

function OverlayFrame({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  footer,
  initialFocusRef,
  returnFocusRef,
  kind,
  className,
  children,
  ...props
}: OverlayFrameProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();

      const initialTarget =
        getInitialFocusTarget(initialFocusRef?.current) ??
        dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');

      if (initialTarget) {
        queueMicrotask(() => initialTarget.focus());
      }
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [initialFocusRef, open]);

  const restoreFocus = (): void => {
    const trigger = triggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }

    if (returnFocusRef?.current?.isConnected) {
      returnFocusRef.current.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={classes(
        styles.overlay,
        kind === 'drawer' ? styles.drawer : styles.dialog,
        className,
      )}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onOpenChange(false);
        }
      }}
      onClose={() => {
        if (open) {
          onOpenChange(false);
        }
        restoreFocus();
      }}
      {...props}
    >
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className={styles.description} id={descriptionId}>
              {description}
            </p>
          ) : null}
        </div>

        <IconButton
          aria-label="Закрыть"
          className={styles.closeButton}
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          <span aria-hidden="true">×</span>
        </IconButton>
      </div>

      <div className={styles.body}>{children}</div>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}

export interface DialogProps
  extends Omit<OverlayFrameProps, 'kind'> {}

export function Dialog(props: DialogProps): React.JSX.Element {
  return <OverlayFrame {...props} kind="dialog" />;
}

export interface DrawerProps
  extends Omit<OverlayFrameProps, 'kind'> {}

export function Drawer(props: DrawerProps): React.JSX.Element {
  return <OverlayFrame {...props} kind="drawer" />;
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
  confirmLabel?: string;
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
  confirmLabel = 'Подтвердить',
  pending = false,
  error,
  returnFocusRef,
}: ReasonDialogProps): React.JSX.Element {
  const canConfirm = Boolean(reason.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      busy={pending}
      returnFocusRef={returnFocusRef}
      footer={
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            variant="danger"
            pending={pending}
            pendingLabel="Сохранение…"
            disabled={!canConfirm}
            onClick={() => onConfirm(reason)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.formStack}>
        {error ? (
          <Alert tone="danger" role="alert" title="Не удалось выполнить действие">
            {error}
          </Alert>
        ) : null}

        <Field label={reasonLabel} required>
          <textarea
            data-dialog-initial-focus
            className={styles.textarea}
            rows={4}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  consequence: React.ReactNode;
  confirmLabel: string;
  tone?: 'neutral' | 'danger';
  pending?: boolean;
  error?: React.ReactNode;
  onConfirm: () => void;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  tone = 'neutral',
  pending = false,
  error,
  onConfirm,
  returnFocusRef,
}: ConfirmDialogProps): React.JSX.Element {
  const cancelActionRef = useRef<HTMLSpanElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      busy={pending}
      initialFocusRef={tone === 'danger' ? cancelActionRef : undefined}
      returnFocusRef={returnFocusRef}
      footer={
        <div className={styles.actions}>
          <span ref={cancelActionRef} className={styles.actionProxy}>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
          </span>
          <Button
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
      <div className={styles.formStack}>
        <p className={styles.consequence}>{consequence}</p>
        {error ? (
          <Alert tone="danger" role="alert" title="Не удалось выполнить действие">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
