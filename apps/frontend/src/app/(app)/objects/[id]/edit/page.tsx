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
import { ObjectSetupPanel } from '@/features/object-setup/ui/object-setup-panel';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { ObjectStatusPanel } from '@/features/object-status/ui/object-status-panel';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Button } from '@/shared/ui/foundation';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EditObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
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
      <div className={`ui-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.notice}>Загрузка объекта...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`ui-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.surfaceCompact}>
          <div className={styles.error}>{loadError}</div>
          <div className={styles.actions}>
            <Button onClick={goBack}>Вернуться назад</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className={`ui-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.notice}>Объект не найден.</div>
      </div>
    );
  }

  const allowEditObject = item.capabilities.canEdit;
  const canManageCompensationRates = item.capabilities.canManageCompensationRates ?? item.capabilities.canEditMonthlySalary;
  const allowChangeStatus = item.capabilities.canChangeStatus;

  if (!allowEditObject && !canManageCompensationRates) {
    return (
      <div className={`ui-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.surfaceCompact}>
          <div className={styles.error}>У вас нет прав на редактирование карточки объекта.</div>
          <div className={styles.actions}>
            <Button onClick={goBack}>Вернуться назад</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ui-page ${styles.page}`}>
      <PageTitle title={`Редактирование: ${item.name}`} />

      <ObjectEditForm
        item={item}
        canEditObject={allowEditObject}
        canManageCompensationRates={canManageCompensationRates}
        canLinkCounterparty={
          user?.capabilities?.canLinkCounterpartyObjects ?? false
        }
        onSubmit={async (payload) => {
          const updated = await updateObject(item.id, payload);
          setItem(updated);
        }}
      />

      <ObjectSetupPanel key={objectId} objectId={objectId} />

      {allowEditObject ? <ObjectStatusPanel
        currentStatus={item.status}
        canChangeStatus={allowChangeStatus}
        approvalsHref={`/approvals?sourceEntityType=object&sourceEntityId=${item.id}`}
        onChangeStatus={async (status) => {
          await changeObjectStatus(item.id, { status });
        }}
      /> : null}

      <div className={styles.backRow}>
        <Button onClick={() => router.push(`/objects/${objectId}`)}>Вернуться в карточку</Button>
      </div>
    </div>
  );
}
