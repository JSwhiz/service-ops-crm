'use client';

import Link from 'next/link';
import React, { useContext, useEffect, useRef, useState } from 'react';

import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError } from '@/shared/api/fetcher';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { Button } from '@/shared/ui/foundation';

interface ObjectStatusPanelProps {
  objectId: string;
  currentStatus: string;
  canChangeStatus: boolean;
  approvalsHref?: string;
  onChangeStatus: (status: string) => Promise<void | SavedWithoutAccess>;
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
  objectId,
  currentStatus,
  canChangeStatus,
  approvalsHref,
  onChangeStatus,
}: ObjectStatusPanelProps): React.JSX.Element {
  const mounted = useRef(true), currentObjectId = useRef(objectId), busy = useRef(false);
  currentObjectId.current = objectId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = useContext(AccessSnapshotBlockedContext), currentBlocked = useRef(blocked); currentBlocked.current = blocked;
  const [acknowledged, setAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleChange = async (status: string): Promise<void> => {
    if (busy.current || currentBlocked.current || acknowledged) return;
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => mounted.current && currentObjectId.current === targetId);
    busy.current = true;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const result = await onChangeStatus(status);
      if (!fence.sameTarget()) return;
      if ((result && isSavedWithoutAccess(result)) || !fence.current() || currentBlocked.current) {
        setAcknowledged(true); setSuccess('Запрос сохранён. Подробности сейчас недоступны; повтор не отправлялся.'); return;
      }
      setSuccess(`Запрос на смену статуса объекта создан: ${getStatusLabel(status)}.`);
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
            <Button
              key={option.value}
              onClick={() => void handleChange(option.value)}
              disabled={blocked || acknowledged || isSubmitting || option.value === currentStatus}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? (
        <div className={styles.success}>
          <div>{success}</div>
          {approvalsHref && !acknowledged ? <Link className={styles.buttonLike} href={approvalsHref}>Открыть согласование</Link> : null}
        </div>
      ) : null}
    </section>
  );
}
