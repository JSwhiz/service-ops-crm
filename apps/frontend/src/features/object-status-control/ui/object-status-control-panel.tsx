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
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Управление статусом объекта
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Текущий статус:</strong> {getStatusLabel(currentStatus)}
      </div>

      <div className="page-muted" style={{ marginBottom: 16 }}>
        {getStatusDescription(currentStatus)}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
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
