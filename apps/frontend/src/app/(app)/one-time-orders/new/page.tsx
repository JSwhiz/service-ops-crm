'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  checkOneTimeOrderConflicts,
  copyOneTimeOrder,
  createOneTimeOrder,
  getOneTimeOrderById,
  listOneTimeOrderSpecificationItems,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  CreateOneTimeOrderPayload,
  OneTimeOrderSpecificationItem,
} from '@/entities/one-time-order/model/one-time-order.types';
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
  const copyFromId = searchParams.get('copyFrom');

  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [managerOptions, setManagerOptions] = useState<SystemUserOption[]>([]);
  const [initialValue, setInitialValue] = useState<
    Partial<CreateOneTimeOrderPayload> | undefined
  >();
  const [copySpecificationItems, setCopySpecificationItems] = useState<
    OneTimeOrderSpecificationItem[]
  >([]);
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
        const [loadedObjects, loadedManagers, copySource, sourceSpecification] =
          await Promise.all([
          listObjects(),
          listOneTimeOrderManagerCandidates(),
          copyFromId ? getOneTimeOrderById(copyFromId) : Promise.resolve(null),
          copyFromId
            ? listOneTimeOrderSpecificationItems(copyFromId)
            : Promise.resolve([]),
        ]);

        if (!cancelled) {
          setObjects(loadedObjects);
          setManagerOptions(loadedManagers);
          setCopySpecificationItems(sourceSpecification);
          if (copySource) {
            const eligibleManagerIds = new Set(
              loadedManagers.map((manager) => manager.id),
            );
            setInitialValue({
              title: `Копия — ${copySource.title}`,
              executionAddress: copySource.executionAddress,
              linkedObjectId:
                copySource.linkedObject &&
                loadedObjects.some(
                  (object) => object.id === copySource.linkedObject?.id,
                )
                  ? copySource.linkedObject.id
                  : null,
              status: 'new',
              description: copySource.description ?? undefined,
              executionStartDate: copySource.executionStartDate,
              executionEndDate: copySource.executionEndDate,
              contactName: copySource.contactName,
              contactPhone: copySource.contactPhone ?? undefined,
              agreedSum: copySource.agreedSum ?? undefined,
              plannedPaymentMethod:
                copySource.plannedPaymentMethod ?? undefined,
              financialNotes: copySource.financialNotes ?? undefined,
              expenseNotes: copySource.expenseNotes ?? undefined,
              managerUserIds: copySource.managers
                .map((manager) => manager.userId)
                .filter((managerId) => eligibleManagerIds.has(managerId)),
            });
          } else {
            setInitialValue({
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
            });
          }
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
  }, [canCreateOneTimeOrder, copyFromId, searchParams]);

  return (
    <>
      <PageTitle
        title={copyFromId ? 'Скопировать разовый заказ' : 'Создать разовый заказ'}
      />

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
          initialValue={initialValue}
          includeSpecificationItems={Boolean(copyFromId)}
          initialSpecificationItems={copySpecificationItems.map((item) => ({
            title: item.title,
            description: item.description,
            requiresAttachment: item.requiresAttachment,
          }))}
          canSelectLinkedObject
          requirePlannedPaymentMethod
          includeManagers
          allowStatusEdit
          submitLabel={copyFromId ? 'Создать копию' : 'Создать заказ'}
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
            const createPayload = {
              ...payload,
              plannedPaymentMethod: payload.plannedPaymentMethod,
              conflictFingerprint,
            };
            const created = copyFromId
              ? await copyOneTimeOrder(copyFromId, {
                  ...createPayload,
                  specificationItems: payload.specificationItems ?? [],
                })
              : await createOneTimeOrder(createPayload);
            router.push(`/one-time-orders/${created.id}`);
          }}
        />
      )}
    </>
  );
}
