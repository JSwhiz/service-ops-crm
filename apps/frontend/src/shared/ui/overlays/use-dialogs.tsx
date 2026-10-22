'use client';

import React, { useCallback, useRef, useState } from 'react';

import { ConfirmDialog, ReasonDialog } from './overlays';

export interface ConfirmOptions {
  title: React.ReactNode;
  consequence: React.ReactNode;
  confirmLabel: string;
  tone?: 'neutral' | 'danger';
}

/**
 * Promise-based ConfirmDialog for imperative flows (replaces window.confirm).
 * Render the returned element once in the component.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title, consequence, confirmLabel }))) return;
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setOptions(next);
  }), []);

  const settle = (value: boolean): void => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  };

  const element = (
    <ConfirmDialog
      open={Boolean(options)}
      onOpenChange={(open) => { if (!open) settle(false); }}
      title={options?.title ?? ''}
      consequence={options?.consequence ?? ''}
      confirmLabel={options?.confirmLabel ?? 'Подтвердить'}
      tone={options?.tone}
      onConfirm={() => settle(true)}
    />
  );
  return [confirm, element];
}

export interface ReasonOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  reasonLabel?: string;
  confirmLabel?: string;
  /** Minimum trimmed length; shorter input keeps the dialog open with a hint. */
  minLength?: number;
  initialValue?: string;
}

/**
 * Promise-based ReasonDialog (replaces window.prompt). Resolves with the trimmed
 * reason, or null when cancelled.
 */
export function useReasonPrompt(): [(options: ReasonOptions) => Promise<string | null>, React.ReactNode] {
  const [options, setOptions] = useState<ReasonOptions | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback((next: ReasonOptions) => new Promise<string | null>((resolve) => {
    resolverRef.current?.(null);
    resolverRef.current = resolve;
    setReason(next.initialValue ?? '');
    setError(null);
    setOptions(next);
  }), []);

  const settle = (value: string | null): void => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  };

  const element = (
    <ReasonDialog
      open={Boolean(options)}
      onOpenChange={(open) => { if (!open) settle(null); }}
      title={options?.title ?? ''}
      description={options?.description}
      reasonLabel={options?.reasonLabel}
      confirmLabel={options?.confirmLabel}
      reason={reason}
      onReasonChange={(value) => { setReason(value); setError(null); }}
      error={error}
      onConfirm={(value) => {
        const trimmed = value.trim();
        const minLength = options?.minLength ?? 1;
        if (trimmed.length < minLength) {
          setError(`Укажите не меньше ${minLength} символов.`);
          return;
        }
        settle(trimmed);
      }}
    />
  );
  return [ask, element];
}
