'use client';

import React, { useMemo, useState } from 'react';

type ObjectStatusCode = 'active' | 'frozen' | 'archived';

interface ObjectStatusControlPanelProps {
  currentStatus: string;
  onChangeStatus: (status: ObjectStatusCode) => Promise<void>;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Активный';
    case 'frozen':
      return 'Заморожен';
    case 'archived':
      return 'Архивный';
    default:
      return status;
  }
}

function getStatusDescription(status: string): string {
  switch (status) {
    case 'active':
      return 'Объект участвует в рабочем контуре и доступен для текущих операций.';
    case 'frozen':
      return 'Объект временно выведен из активной работы. Это управленческий статус, а не рабочая пауза на уровне менеджера.';
    case 'archived':
      return 'Объект выведен из активной эксплуатации и считается архивным.';
    default:
      return 'Статус объекта не распознан текущим frontend-слоем.';
  }
}

export function ObjectStatusControlPanel({
  currentStatus,
  onChangeStatus,
}: ObjectStatusControlPanelProps): React.JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTransitions = useMemo<ObjectStatusCode[]>(() => {
    const allStatuses: ObjectStatusCode[] = ['active', 'frozen', 'archived'];

    return allStatuses.filter((status) => status !== currentStatus);
  }, [currentStatus]);

  const handleChangeStatus = async (status: ObjectStatusCode): Promise<void> => {
    setError(null);
    setIsSubmitting(true);

    try {
      await onChangeStatus(status);
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message.trim()) {
        setError(caughtError.message);
      } else {
        setError('Не удалось изменить статус объекта.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Управление статусом объекта</div>
          <div className="section-subtitle">
            Изменение статуса доступно только через backend policy.
          </div>
        </div>
        <span className="status-pill" data-status={currentStatus}>
          {getStatusLabel(currentStatus)}
        </span>
      </div>

      <div className="page-muted" style={{ marginBottom: 16 }}>
        {getStatusDescription(currentStatus)}
      </div>

      <div className="action-row">
        {availableTransitions.map((status) => (
          <button
            key={status}
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleChangeStatus(status)}
          >
            {isSubmitting
              ? 'Сохраняем...'
              : `Перевести в статус "${getStatusLabel(status)}"`}
          </button>
        ))}
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
      ) : null}
    </div>
  );
}
