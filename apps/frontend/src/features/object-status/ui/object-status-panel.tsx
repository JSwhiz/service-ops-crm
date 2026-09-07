'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import styles from '@/features/object-shared-ui/object-surfaces.module.css';

interface ObjectStatusPanelProps {
  currentStatus: string;
  canChangeStatus: boolean;
  approvalsHref?: string;
  onChangeStatus: (status: string) => Promise<void>;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Активный' },
  { value: 'frozen', label: 'Заморожен' },
  { value: 'archived', label: 'Архив' },
] as const;

function getStatusLabel(status: string): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

export function ObjectStatusPanel({
  currentStatus,
  canChangeStatus,
  approvalsHref,
  onChangeStatus,
}: ObjectStatusPanelProps): React.JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleChange = async (status: string): Promise<void> => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      await onChangeStatus(status);
      setSuccess(`Запрос на смену статуса объекта создан: ${getStatusLabel(status)}.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Не удалось изменить статус объекта.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.surfaceCompact}>
      <div>
        <h2 className={styles.title}>Статус объекта</h2>
        <p className={styles.description}>Текущий статус: {getStatusLabel(currentStatus)}</p>
      </div>

      {!canChangeStatus ? (
        <div className={styles.notice}>Изменение статуса доступно только руководящему кругу.</div>
      ) : (
        <div className={styles.statusActions}>
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void handleChange(option.value)}
              disabled={isSubmitting || option.value === currentStatus}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? (
        <div className={styles.success}>
          <div>{success}</div>
          {approvalsHref ? <Link className={styles.buttonLike} href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </section>
  );
}
