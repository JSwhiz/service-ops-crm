'use client';

import Link from 'next/link';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';

import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError } from '@/shared/api/fetcher';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import { StatusBadge, Surface } from '@/shared/ui/foundation';

type ObjectStatusCode = 'active' | 'frozen' | 'archived';

interface ObjectStatusControlPanelProps {
  objectId: string;
  currentStatus: string;
  canChangeStatus?: boolean;
  canFreeze?: boolean;
  canArchive?: boolean;
  canRestore?: boolean;
  approvalsHref?: string;
  onChangeStatus: (status: ObjectStatusCode) => Promise<void | SavedWithoutAccess>;
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
  objectId,
  currentStatus,
  canChangeStatus = true,
  canFreeze,
  canArchive,
  canRestore,
  approvalsHref,
  onChangeStatus,
}: ObjectStatusControlPanelProps): React.JSX.Element {
  const mounted = useRef(true), currentObjectId = useRef(objectId), busy = useRef(false);
  currentObjectId.current = objectId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = useContext(AccessSnapshotBlockedContext), currentBlocked = useRef(blocked); currentBlocked.current = blocked;
  const [acknowledged, setAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableTransitions = useMemo<ObjectStatusCode[]>(() => {
    const allStatuses: ObjectStatusCode[] = ['active', 'frozen', 'archived'];
    return allStatuses.filter((status) => status !== currentStatus && (
      status === 'frozen' ? canFreeze ?? canChangeStatus : status === 'archived' ? canArchive ?? canChangeStatus : currentStatus === 'archived' ? canRestore ?? canChangeStatus : canChangeStatus
    ));
  }, [currentStatus, canChangeStatus, canFreeze, canArchive, canRestore]);

  const handleChangeStatus = async (statusCode: ObjectStatusCode): Promise<void> => {
    if (isSubmitting || !availableTransitions.includes(statusCode)) return;
    if (busy.current || currentBlocked.current || acknowledged) return;
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => mounted.current && currentObjectId.current === targetId);
    busy.current = true;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const result = await onChangeStatus(statusCode);
      if (!fence.sameTarget()) return;
      if ((result && isSavedWithoutAccess(result)) || !fence.current() || currentBlocked.current) {
        setAcknowledged(true); setSuccess('Запрос сохранён. Подробности сейчас недоступны; повтор не отправлялся.'); return;
      }
      setSuccess('Изменение статуса отправлено на согласование.');
    } catch (caughtError) {
      if (!fence.sameTarget()) return;
      setError(caughtError instanceof ApiError && [403, 404].includes(caughtError.statusCode)
        ? 'Запрос на изменение статуса недоступен текущим правам.'
        : 'Результат запроса не подтверждён. Проверьте согласования перед повтором.');
    } finally {
      busy.current = false;
      if (fence.sameTarget()) setIsSubmitting(false);
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
              disabled={blocked || acknowledged || isSubmitting}
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
          {approvalsHref && !acknowledged ? <Link className={styles.buttonLike} href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </Surface>
  );
}
