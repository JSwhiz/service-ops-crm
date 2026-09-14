'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  getObjectById,
  listObjectsPage,
} from '@/entities/object/api/object-client';
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
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { getOneTimeOrderConflictTypeLabel } from '@/shared/lib/one-time-order-presentation';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function toObjectOption(object: ServiceObject): SearchableSelectOption {
  return {
    value: object.id,
    label: object.name,
    description: [object.internalName, object.address].filter(Boolean).join(' · '),
    searchText: [object.name, object.internalName, object.address]
      .filter(Boolean)
      .join(' '),
  };
}

export default function NewOneTimeOrderPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canCreateOneTimeOrder =
    user?.capabilities?.canCreateOneTimeOrder ?? false;
  const copyFromId = searchParams.get('copyFrom');

  const [initialLinkedObjectOption, setInitialLinkedObjectOption] =
    useState<SearchableSelectOption | null>(null);
  const [initialManagerOptions, setInitialManagerOptions] = useState<
    SystemUserOption[]
  >([]);
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
        const [copySource, sourceSpecification] = await Promise.all([
          copyFromId ? getOneTimeOrderById(copyFromId) : Promise.resolve(null),
          copyFromId
            ? listOneTimeOrderSpecificationItems(copyFromId)
            : Promise.resolve([]),
        ]);

        const requestedManagerIds = copySource
          ? copySource.managers.map((manager) => manager.userId)
          : searchParams.get('managerUserId')
            ? [searchParams.get('managerUserId')!]
            : [];

        const [linkedObject, hydratedManagerOptions] = await Promise.all([
          copySource?.linkedObject?.canOpenObjectCard
            ? getObjectById(copySource.linkedObject.id).catch(() => null)
            : Promise.resolve(null),
          Promise.all(
            requestedManagerIds.map(async (userId) => {
              const matches = await listOneTimeOrderManagerCandidates(
                undefined,
                undefined,
                userId,
              );
              return matches.find((user) => user.id === userId) ?? null;
            }),
          ),
        ]);

        if (!cancelled) {
          const selectedManagers = hydratedManagerOptions.filter(
            (user): user is SystemUserOption => user !== null,
          );
          setInitialLinkedObjectOption(
            linkedObject ? toObjectOption(linkedObject) : null,
          );
          setInitialManagerOptions(selectedManagers);
          setCopySpecificationItems(sourceSpecification);

          if (copySource) {
            setInitialValue({
              title: `Копия — ${copySource.title}`,
              executionAddress: copySource.executionAddress,
              linkedObjectId: linkedObject?.id ?? null,
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
              managerUserIds: selectedManagers.map((manager) => manager.id),
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
              ...(selectedManagers.length
                ? { managerUserIds: selectedManagers.map((manager) => manager.id) }
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
          initialLinkedObjectOption={initialLinkedObjectOption}
          initialManagerOptions={initialManagerOptions}
          searchObjects={async (query) => {
            const result = await listObjectsPage({
              q: query,
              page: 1,
              limit: 20,
              sortBy: 'name',
              sortDirection: 'asc',
            });
            return result.items.map(toObjectOption);
          }}
          searchManagers={(query) =>
            listOneTimeOrderManagerCandidates(undefined, query)
          }
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
