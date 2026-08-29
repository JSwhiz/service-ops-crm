'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  checkOneTimeOrderConflicts,
  createOneTimeOrder,
} from '@/entities/one-time-order/api/one-time-order-client';
import { OneTimeOrderForm } from '@/features/one-time-order-form/ui/one-time-order-form';
import {
  listOneTimeOrderManagerCandidates,
} from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { getOneTimeOrderConflictTypeLabel } from '@/shared/lib/one-time-order-presentation';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function NewOneTimeOrderPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canCreateOneTimeOrder =
    user?.capabilities?.canCreateOneTimeOrder ?? false;

  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [managerOptions, setManagerOptions] = useState<SystemUserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canCreateOneTimeOrder) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const [loadedObjects, loadedManagers] = await Promise.all([
          listObjects(),
          listOneTimeOrderManagerCandidates(),
        ]);

        if (!cancelled) {
          setObjects(loadedObjects);
          setManagerOptions(loadedManagers);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось подготовить создание заказа.'),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [canCreateOneTimeOrder]);

  return (
    <>
      <PageTitle title="Создать разовый заказ" />

      {!canCreateOneTimeOrder ? (
        <div className="page-card">У вас нет права создавать разовые заказы.</div>
      ) : isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <OneTimeOrderForm
          objects={objects}
          managerOptions={managerOptions}
          initialValue={{
            ...(searchParams.get('date') &&
            /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date')!)
              ? {
                  executionStartDate: searchParams.get('date'),
                  executionEndDate: searchParams.get('date'),
                }
              : {}),
            ...(searchParams.get('managerUserId')
              ? { managerUserIds: [searchParams.get('managerUserId')!] }
              : {}),
          }}
          canSelectLinkedObject
          requirePlannedPaymentMethod
          includeManagers
          allowStatusEdit
          submitLabel="Создать заказ"
          onSubmit={async (payload) => {
            if (!payload.plannedPaymentMethod) {
              throw new Error('Укажите плановый способ оплаты');
            }
            let conflictFingerprint: string | undefined;
            if (
              payload.executionStartDate &&
              payload.executionEndDate &&
              payload.managerUserIds?.length
            ) {
              const result = await checkOneTimeOrderConflicts({
                executionStartDate: payload.executionStartDate,
                executionEndDate: payload.executionEndDate,
                managerUserIds: payload.managerUserIds,
              });
              if (result.hasConflicts) {
                const details = result.conflicts
                  .filter(
                    (conflict) =>
                      conflict.type !== 'pending_availability_request',
                  )
                  .slice(0, 8)
                  .map(
                    (conflict) =>
                      `${conflict.date} · ${conflict.user.fullName} · ${getOneTimeOrderConflictTypeLabel(conflict.type)}`,
                  )
                  .join('\n');
                const confirmed = window.confirm(
                  `Найдены конфликты расписания:\n${details}\n\nСохранить заказ с конфликтами?`,
                );
                if (!confirmed) return;
                conflictFingerprint = result.conflictFingerprint;
              }
            }
            const created = await createOneTimeOrder({
              ...payload,
              plannedPaymentMethod: payload.plannedPaymentMethod,
              conflictFingerprint,
            });
            router.push(`/one-time-orders/${created.id}`);
          }}
        />
      )}
    </>
  );
}
