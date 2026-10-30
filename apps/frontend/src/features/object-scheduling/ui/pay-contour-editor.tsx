'use client';

import React from 'react';
import { Field } from '@/shared/ui/foundation';
import type { ContourDraft } from '../model/contour-draft';
import styles from './object-scheduling.module.css';

export function PayContourEditor({ value, onChange, disabled }: { value: ContourDraft; onChange: (value: ContourDraft) => void; disabled?: boolean }): React.JSX.Element {
  const patch = (next: Partial<ContourDraft>): void => onChange({ ...value, ...next });
  return <div className={styles.grid}>
    <Field label="Название условий оплаты" required><input value={value.name} maxLength={200} disabled={disabled} placeholder="Например, дневная работа" onChange={(event) => patch({ name: event.target.value })} /></Field>
    <Field label="Базовая ставка за выход, ₽" required><input type="number" step={1} min={0} max={100000000} value={value.dailyRate} disabled={disabled} onChange={(event) => patch({ dailyRate: event.target.value })} /></Field>
    <Field label="Летняя ставка за выход, ₽" description="Необязательно. Пусто — применяется базовая ставка."><input type="number" step={1} min={0} max={100000000} value={value.summerDailyRate} disabled={disabled} onChange={(event) => patch({ summerDailyRate: event.target.value })} /></Field>
    <Field label="Зимняя ставка за выход, ₽" description="Необязательно. Пусто — применяется базовая ставка."><input type="number" step={1} min={0} max={100000000} value={value.winterDailyRate} disabled={disabled} onChange={(event) => patch({ winterDailyRate: event.target.value })} /></Field>
  </div>;
}
