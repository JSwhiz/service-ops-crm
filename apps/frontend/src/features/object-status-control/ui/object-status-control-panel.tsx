'use client';

import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import styles from '@/features/object-shared-ui/object-surfaces.module.css';

type ObjectStatusCode = 'active' | 'frozen' | 'archived';

interface ObjectStatusControlPanelProps {
  currentStatus: string;
  approvalsHref?: string;
  onChangeStatus: (status: ObjectStatusCode) => Promise<void>;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Активный';
    case 'frozen': return 'Заморожен';
    case 'archived': return 'Архивный';
    default: return status;
  }
}

function getStatusDescription(status: string): string {
  switch (status) {
    case 'active': return 'Объект участвует в рабочем контуре и доступен для текущих операций.';
    case 'frozen': return 'Объект временно выведен из активной работы. Это управленческий статус, а не рабочая пауза на уровне менеджера.';
    case 'archived': return 'Объект выведен из активной эксплуатации и считается архивным.';
    default: return 'Статус объекта не распознан текущим frontend-слоем.';
  }
}

export function ObjectStatusControlPanel({
  currentStatus,
  approvalsHref,
  onChangeStatus,
}: ObjectStatusControlPanelProps): React.JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableTransitions = useMemo<ObjectStatusCode[]>(() => {
    const allStatuses: ObjectStatusCode[] = ['active', 'frozen', 'archived'];
    return allStatuses.filter((status) => status !== currentStatus);
  }, [currentStatus]);

  const handleChangeStatus = async (status: ObjectStatusCode): Promise<void> => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      await onChangeStatus(status);
      setSuccess(`Запрос на перевод объекта в статус "${getStatusLabel(status)}" отправлен в approvals queue.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message.trim()
          ? caughtError.message
          : 'Не удалось изменить статус объекта.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Управление статусом объекта</div>
          <div className="section-subtitle">Изменение статуса доступно только через backend policy.</div>
        </div>
        <span className="status-pill" data-status={currentStatus}>{getStatusLabel(currentStatus)}</span>
      </div>

      <div className="page-muted" style={{ marginBottom: 16 }}>{getStatusDescription(currentStatus)}</div>

      <div className="action-row">
        {availableTransitions.map((status) => (
          <button
            key={status}
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleChangeStatus(status)}
          >
            {isSubmitting ? 'Сохраняем...' : `Перевести в статус "${getStatusLabel(status)}"`}
          </button>
        ))}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? (
        <div className={styles.success}>
          <div>{success}</div>
          {approvalsHref ? <Link className={styles.buttonLike} href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
