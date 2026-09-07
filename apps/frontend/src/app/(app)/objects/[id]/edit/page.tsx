'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  changeObjectStatus,
  getObjectById,
  updateObject,
} from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { ObjectEditForm } from '@/features/object-edit/ui/object-edit-form';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { ObjectStatusPanel } from '@/features/object-status/ui/object-status-panel';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EditObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const [objectId, setObjectId] = useState('');
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const resolved = await params;
      if (cancelled) return;

      setObjectId(resolved.id);
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await getObjectById(resolved.id);
        if (!cancelled) setItem(response);
      } catch (error) {
        if (!cancelled) setLoadError(getErrorMessage(error, 'Не удалось загрузить объект для редактирования.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [params]);

  const goBack = (): void => {
    router.push(objectId ? `/objects/${objectId}` : '/objects');
  };

  if (isLoading) {
    return (
      <div className={`workspace-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.notice}>Загрузка объекта...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`workspace-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.surfaceCompact}>
          <div className={styles.error}>{loadError}</div>
          <div className={styles.actions}>
            <button type="button" onClick={goBack}>Вернуться назад</button>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className={`workspace-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.notice}>Объект не найден.</div>
      </div>
    );
  }

  const allowEditObject = item.capabilities.canEdit;
  const allowEditDailyRate = item.capabilities.canEditDailyRate;
  const allowChangeStatus = item.capabilities.canChangeStatus;

  if (!allowEditObject) {
    return (
      <div className={`workspace-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.surfaceCompact}>
          <div className={styles.error}>У вас нет прав на редактирование карточки объекта.</div>
          <div className={styles.actions}>
            <button type="button" onClick={goBack}>Вернуться назад</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`workspace-page ${styles.page}`}>
      <PageTitle title={`Редактирование: ${item.name}`} />

      <ObjectEditForm
        item={item}
        canEditDailyRate={allowEditDailyRate}
        onSubmit={async (payload) => {
          const updated = await updateObject(item.id, payload);
          setItem(updated);
        }}
      />

      <ObjectStatusPanel
        currentStatus={item.status}
        canChangeStatus={allowChangeStatus}
        approvalsHref={`/approvals?sourceEntityType=object&sourceEntityId=${item.id}`}
        onChangeStatus={async (status) => {
          await changeObjectStatus(item.id, { status });
        }}
      />

      <div className={styles.surfaceCompact}>
        <div className={styles.actions}>
          <button type="button" onClick={() => router.push(`/objects/${objectId}`)}>Вернуться в карточку</button>
          <button type="button" onClick={() => router.push('/objects')}>К списку объектов</button>
        </div>
      </div>
    </div>
  );
}
