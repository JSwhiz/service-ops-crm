'use client';

import Link from 'next/link';
import React, { useState } from 'react';

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
      setSuccess(
        `Запрос на смену статуса объекта создан: ${getStatusLabel(status)}.`,
      );
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message) {
        setError(caughtError.message);
      } else {
        setError('Не удалось изменить статус объекта.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 18 }}>Статус объекта</div>

      <div className="page-muted">
        Текущий статус: {getStatusLabel(currentStatus)}
      </div>

      {!canChangeStatus ? (
        <div className="page-muted">
          Изменение статуса доступно только руководящему кругу.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      {success ? (
        <div style={{ color: '#15803d', display: 'grid', gap: 6 }}>
          <div>{success}</div>
          {approvalsHref ? <Link href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
