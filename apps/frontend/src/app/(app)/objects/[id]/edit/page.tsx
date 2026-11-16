'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

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
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Button } from '@/shared/ui/foundation';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence, objectSavedWithoutAccess } from '@/features/object-shared-ui/object-write-fence';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EditObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const { user, capabilitiesRefreshError, refreshUser } = useAuth();
  const accessRevision = useAccessRevision();
  const surfaceMounted = useRef(true);
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  const [loadedParams, setLoadedParams] = useState<typeof params | null>(null);
  const latestAccess = useRef({ accessRevision, capabilitiesRefreshError, params, userId: user?.id });
  latestAccess.current = { accessRevision, capabilitiesRefreshError, params, userId: user?.id };
  const [objectId, setObjectId] = useState('');
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeAcknowledged, setWriteAcknowledged] = useState<{ actorId: string | undefined; objectId: string } | null>(null);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const currentObjectId = useRef(objectId);
  currentObjectId.current = objectId;
  useEffect(() => { setWriteAcknowledged(null); }, [objectId]);

  useEffect(() => {
    let cancelled = false;
    const identity = user?.id;
    const readFence = captureObjectWriteFence(() => surfaceMounted.current && latestAccess.current.params === params && latestAccess.current.userId === identity);

    const load = async (): Promise<void> => {
      const resolved = await params;
      if (cancelled || !readFence.current()) return;

      setObjectId(resolved.id);
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await getObjectById(resolved.id);
        if (!cancelled && readFence.current() && response.id === resolved.id && latestAccess.current.accessRevision === accessRevision && latestAccess.current.params === params && !latestAccess.current.capabilitiesRefreshError) {
          setItem(response);
          setLoadedRevision(accessRevision);
          setLoadedParams(params);
        }
      } catch (error) {
        if (!cancelled && readFence.current()) setLoadError(getErrorMessage(error, 'Не удалось загрузить объект для редактирования.'));
      } finally {
        if (!cancelled && readFence.current()) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [params, accessRevision, capabilitiesRefreshError, user?.id]);

  const goBack = (): void => {
    router.push(objectId ? `/objects/${objectId}` : '/objects');
  };

  if (isLoading && !item) {
    return (
      <div className={`ui-page ${styles.page}`}>
        <PageTitle title="Редактирование объекта" />
        <div className={styles.notice}>Загрузка объекта...</div>
      </div>
    );
  }

  if (loadError && !item) {
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

  const currentAcknowledgement = writeAcknowledged?.actorId === user?.id && writeAcknowledged?.objectId === objectId;
  const accessBlocked = currentAcknowledgement || isLoading || !!loadError || !!capabilitiesRefreshError || loadedRevision !== accessRevision || loadedParams !== params;

  return (
    <div className={`ui-page ${styles.page}`}>
      <PageTitle title={accessBlocked ? 'Редактирование объекта' : `Редактирование: ${item.name}`} />

      {accessBlocked ? <div className={styles.notice}>Проверяем доступ к объекту. Черновик сохранён.</div> : null}
      {!accessBlocked && !allowEditObject && !canManageCompensationRates ? <div className={styles.error}>Право редактирования отозвано. Черновик сохранён; сохранение недоступно.</div> : null}
      {loadError ? <div className={styles.error}>Доступ к объекту не подтверждён. Черновик сохранён.</div> : null}
      {currentAcknowledgement ? <div className={styles.notice} role="status">Сохранение подтверждено, но подробности недоступны. Черновик сохранён; повторная запись не отправлялась.
        <Button pending={checkingReceipt} disabled={checkingReceipt} onClick={async () => {
          const targetId = item.id;
          const identity = user?.id;
          setCheckingReceipt(true);
          try {
            await refreshUser({ force: true });
            const requestParams = latestAccess.current.params;
            const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId && latestAccess.current.params === requestParams && latestAccess.current.userId === identity);
            const fresh = await getObjectById(targetId);
            if (!fence.current() || latestAccess.current.capabilitiesRefreshError || fresh.id !== targetId) return;
            setItem(fresh); setLoadedRevision(latestAccess.current.accessRevision); setLoadedParams(requestParams); setLoadError(null); setWriteAcknowledged(null);
          } catch { /* A confirmed write stays acknowledged; no retry or stale DTO publication. */ }
          finally { if (currentObjectId.current === targetId && latestAccess.current.userId === identity) setCheckingReceipt(false); }
        }}>Проверить сохранённый объект</Button>
      </div> : null}
      <AccessSnapshotBoundary blocked={accessBlocked}>
      <ObjectEditForm
        key={`${user?.id}:${item.id}`}
        preserveDraftOnRefresh
        item={item}
        canEditObject={allowEditObject}
        canManageCompensationRates={canManageCompensationRates}
        canLinkCounterparty={
          user?.capabilities?.canLinkCounterpartyObjects ?? false
        }
        onSubmit={async (payload) => {
          if (latestAccess.current.accessRevision !== loadedRevision || latestAccess.current.params !== loadedParams || latestAccess.current.capabilitiesRefreshError || accessBlocked) {
            throw new Error('Доступ изменился. Дождитесь проверки прав и повторите сохранение.');
          }
          const targetId = item.id;
          const identity = user?.id;
          const requestParams = params;
          const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId && latestAccess.current.params === requestParams && latestAccess.current.userId === identity);
          const confirmed = await getObjectById(targetId);
          if (!fence.current() || confirmed.id !== targetId || latestAccess.current.accessRevision !== loadedRevision || latestAccess.current.params !== loadedParams || latestAccess.current.capabilitiesRefreshError) {
            throw new Error('Доступ изменился. Повторите сохранение после проверки прав.');
          }
          if ('counterpartyId' in payload && confirmed.updatedAt !== item.updatedAt) {
            throw new Error('Карточка объекта изменилась. Проверьте актуальные данные перед изменением связи; черновик сохранён.');
          }
          const coreFields = ['name', 'internalName', 'address', 'summerWindowCleaning', 'engineeringRequired', 'winterTractorMode', 'instructionSteps', 'notes', 'responsibleUserId', 'counterpartyId'];
          const writesCore = coreFields.some((key) => key in payload);
          const canWriteRates = confirmed.capabilities.canManageCompensationRates ?? confirmed.capabilities.canEditMonthlySalary;
          const rateFields = ['paymentType', 'dailyRate', 'monthlySalary', 'paymentScheduleCode', 'paymentScheduleWeekdays', 'paymentScheduleCycleStartDate', 'summerPaymentType', 'summerDailyRate', 'summerMonthlySalary', 'summerScheduleCode', 'summerScheduleWeekdays', 'summerScheduleCycleStartDate', 'winterPaymentType', 'winterDailyRate', 'winterMonthlySalary', 'winterScheduleCode', 'winterScheduleWeekdays', 'winterScheduleCycleStartDate'];
          const writesRates = rateFields.some((key) => key in payload);
          if ((writesCore && !confirmed.capabilities.canEdit) || (writesRates && !canWriteRates) || (!writesCore && !writesRates)) {
            throw new Error('Право редактирования отозвано. Черновик сохранён.');
          }
          const updated = await updateObject(targetId, payload);
          if (isSavedWithoutAccess(updated) || !fence.current() || latestAccess.current.capabilitiesRefreshError || updated.id !== targetId) {
            if (fence.sameTarget()) { setWriteAcknowledged({ actorId: identity, objectId: targetId }); void refreshUser({ force: true }).catch(() => undefined); }
            return objectSavedWithoutAccess;
          }
          setItem(updated);
        }}
      />

      <ObjectSetupPanel key={objectId} objectId={objectId} />

      {allowEditObject ? <ObjectStatusPanel
        objectId={item.id}
        currentStatus={item.status}
        canChangeStatus={allowChangeStatus}
        approvalsHref={`/approvals?sourceEntityType=object&sourceEntityId=${item.id}`}
        onChangeStatus={async (status) => {
          if (accessBlocked) throw new Error('Доступ к объекту не подтверждён.');
          const targetId = item.id, identity = user?.id, requestParams = params;
          const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId && latestAccess.current.params === requestParams && latestAccess.current.userId === identity);
          const result = await changeObjectStatus(targetId, { status });
          if (isSavedWithoutAccess(result) || !fence.current()) {
            if (fence.sameTarget()) setWriteAcknowledged({ actorId: identity, objectId: targetId });
            return objectSavedWithoutAccess;
          }
        }}
      /> : null}

      </AccessSnapshotBoundary>

      <div className={styles.backRow}>
        <Button onClick={() => router.push(`/objects/${objectId}`)}>Вернуться в карточку</Button>
      </div>
    </div>
  );
}
