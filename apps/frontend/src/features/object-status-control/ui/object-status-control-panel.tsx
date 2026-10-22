'use client';

import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import { StatusBadge, Surface } from '@/shared/ui/foundation';

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

function getTransitionLabel(status: ObjectStatusCode): string {
  switch (status) {
    case 'active': return 'Активировать';
    case 'frozen': return 'Заморозить';
    case 'archived': return 'В архив';
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

  const handleChangeStatus = async (statusCode: ObjectStatusCode): Promise<void> => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      await onChangeStatus(statusCode);
      setSuccess('Изменение статуса отправлено на согласование.');
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
    <Surface padding="md" className="object-status-control">
      <div className={`${styles.statusHeader} object-status-control__header`}>
        <div className="ui-section-title">Статус объекта</div>
        <div className={styles.statusControls}>
          <StatusBadge status={currentStatus}>{getStatusLabel(currentStatus)}</StatusBadge>
          {availableTransitions.map((statusCode) => (
            <button
              key={statusCode}
              className={statusCode === 'frozen' || statusCode === 'archived' ? 'object-status-control__action' : undefined}
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleChangeStatus(statusCode)}
            >
              {statusCode === 'frozen' ? <MediaActionIcon name="freeze" /> : statusCode === 'archived' ? <MediaActionIcon name="archive" /> : null}
              {isSubmitting ? 'Сохраняем…' : getTransitionLabel(statusCode)}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? (
        <div className={styles.success}>
          <span>{success}</span>
          {approvalsHref ? <Link className={styles.buttonLike} href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </Surface>
  );
}
