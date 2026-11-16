'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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
import { OneTimeOrderForm, type OneTimeOrderFormDraft } from '@/features/one-time-order-form/ui/one-time-order-form';
import { isOrderCreateSection } from '@/features/one-time-order-form/model/create-request';
import {
  listOneTimeOrderManagerCandidates,
} from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { isLeadershipCircle } from '@/shared/lib/access';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { Alert, Button } from '@/shared/ui/foundation';
import { ConfirmDialog } from '@/shared/ui/overlays';
import { FormDialog } from '@/shared/ui/overlays';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { ScheduleConflictList } from '@/entities/one-time-order/ui/schedule-conflicts';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

const ORDER_CREATE_SECTIONS = [
  { id: 'basic', label: 'Основное' }, { id: 'planning', label: 'Планирование и команда' },
  { id: 'conditions', label: 'Условия' }, { id: 'specification', label: 'ТЗ' }, { id: 'notes', label: 'Заметки' },
];

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

export function OneTimeOrderCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const targetSearch = navigation.getTargetSearchParams().toString();
  const searchParams = useMemo(() => new URLSearchParams(targetSearch), [targetSearch]);
  const { user, capabilitiesRefreshError } = useAuth();
  const accessRevision = useAccessRevision();
  const draft = useCreateDraft<OneTimeOrderFormDraft | null>('one-time-order-create', null);
  const [activeSection, setActiveSection] = useState<'basic' | 'planning' | 'conditions' | 'specification' | 'notes'>('basic');
  const [localSubmitting, setIsSubmitting] = useState(false);
  const isSubmitting = localSubmitting || draft.submitting;
  const fallbackSearch = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext(`/one-time-orders${fallbackSearch ? `?${fallbackSearch}` : ''}`);
  const onDraftChange = useCallback((value: OneTimeOrderFormDraft) => draft.setValue(value), [draft.setValue]);
  const onDirtyChange = useCallback((dirty: boolean) => { if (!dirty) draft.setDirty(false); }, [draft.setDirty]);
  const onBusyChange = useCallback((busy: boolean) => setIsSubmitting(busy), []);
  const canCreateOneTimeOrder =
    user?.capabilities?.canCreateOneTimeOrder ?? false;
  const canComposeSpecification = isLeadershipCircle(user?.roleCodes ?? []);
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
  const [copyAllowed, setCopyAllowed] = useState(false);
  const [copyFinanceAllowed, setCopyFinanceAllowed] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scope = `${accessRevision}:${targetSearch}`;
  const canSubmit = copyFromId ? copyAllowed : canCreateOneTimeOrder;
  const context = useRef({ scope, allowed: false });
  context.current = { scope, allowed: !capabilitiesRefreshError && loadedScope === scope && !isLoading && !error && canSubmit };
  const copiedFinancialValues = useMemo(() => copyFromId ? {
    agreedSum: initialValue?.agreedSum == null ? '' : String(initialValue.agreedSum),
    plannedPaymentMethod: initialValue?.plannedPaymentMethod ?? '',
    financialNotes: initialValue?.financialNotes ?? '', expenseNotes: initialValue?.expenseNotes ?? '',
  } : undefined, [copyFromId, initialValue]);
  const [conflictPrompt, setConflictPrompt] = useState<{
    conflicts: Parameters<typeof ScheduleConflictList>[0]['conflicts'];
    isCurrent: () => boolean;
    resolve: (accepted: boolean) => void;
  } | null>(null);
  useEffect(() => {
    if (conflictPrompt && !conflictPrompt.isCurrent()) {
      conflictPrompt.resolve(false);
      setConflictPrompt(null);
    }
  }, [conflictPrompt, scope, capabilitiesRefreshError, canSubmit, copyFinanceAllowed, loadedScope]);
  useEffect(() => () => { context.current = { ...context.current, allowed: false }; }, []);

  useEffect(() => {
    setLoadedScope(null);
    if (capabilitiesRefreshError) return;
    if (!canCreateOneTimeOrder && !copyFromId) {
      setLoadedScope(scope);
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
          copyFromId && canComposeSpecification
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
          setCopyAllowed(copySource?.capabilities.canCopy === true);
          setCopyFinanceAllowed(copySource?.capabilities.canReadFinance === true);
          setLoadedScope(scope);

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
  }, [canCreateOneTimeOrder, copyFromId, searchParams, accessRevision, capabilitiesRefreshError]);

  return (
    <FormDialog open title={copyFromId ? 'Скопировать разовый заказ' : 'Создать разовый заказ'} size="wide" busy={isSubmitting} dirty={draft.dirty}
      closeContext={closeContext} clearDraft={draft.clear}
      sections={{ sections: ORDER_CREATE_SECTIONS, activeSectionId: activeSection, onSectionChange: (id) => {
        if (isOrderCreateSection(id)) setActiveSection(id);
      } }}
      footer={({ requestClose }) => <div className="ui-inline">
        <Button onClick={() => void requestClose()} disabled={isSubmitting}>Отмена</Button>
        {context.current.allowed ? <Button variant="primary" type="submit" form="one-time-order-create-form" pending={isSubmitting} pendingLabel="Создаём…">{copyFromId ? 'Создать копию' : 'Создать заказ'}</Button> : null}
      </div>}>
    <div className={`ui-page ${orderStyles.orderDetailPage}`}>
      <ConfirmDialog
        open={conflictPrompt !== null && conflictPrompt.isCurrent()}
        onOpenChange={(open) => { if (!open) { conflictPrompt?.resolve(false); setConflictPrompt(null); } }}
        title="Есть конфликты расписания"
        consequence={conflictPrompt ? <ScheduleConflictList conflicts={conflictPrompt.conflicts} /> : null}
        confirmLabel="Сохранить с конфликтами"
        onConfirm={() => { conflictPrompt?.resolve(conflictPrompt.isCurrent()); setConflictPrompt(null); }}
      />
      {copyFromId && loadedScope === scope && !copyFinanceAllowed ? <Alert tone="warning" role="alert">
        Финансовые поля исходного заказа скрыты и не копируются. Личные изменения сохранены отдельно. Выберите новый способ оплаты для создаваемого заказа.
      </Alert> : null}
      {capabilitiesRefreshError || loadedScope !== scope ? (
        <div role="status">{capabilitiesRefreshError || error || 'Проверяем доступ…'}</div>
      ) : !canSubmit ? (
        <div className="ui-surface ui-surface--padded">У вас нет права создавать разовые заказы.</div>
      ) : isLoading ? (
        <div className="ui-surface ui-surface--padded">Загрузка...</div>
      ) : error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : (
        <OneTimeOrderForm
          formId="one-time-order-create-form"
          activeSection={activeSection}
          hideSubmitActions
          dialogMode
          initialDraft={draft.value ?? undefined}
          initialDraftDirty={draft.dirty}
          canEditFinancialFields={!copyFromId || copyFinanceAllowed}
          newPaymentMethodContext={copyFromId && !copyFinanceAllowed ? `${copyFromId}:${accessRevision}` : undefined}
          copiedFinancialValues={copiedFinancialValues}
          onDirtyChange={onDirtyChange}
          onDraftChange={onDraftChange}
          onRequiredSection={(id) => setActiveSection(id)}
          onBusyChange={onBusyChange}
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
          includeSpecificationItems={Boolean(copyFromId && canComposeSpecification)}
          canComposeSpecification={canComposeSpecification}
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
          onSubmit={async (payload) => draft.submit(async () => {
            const generation = getAccessGeneration();
            const originScope = scope;
            const isCurrent = (): boolean => isAccessGenerationCurrent(generation) && context.current.scope === originScope && context.current.allowed;
            if (!isCurrent()) return;
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
              if (!isCurrent()) return;
              if (result.hasConflicts) {
                const confirmed = await new Promise<boolean>((resolve) => setConflictPrompt({ conflicts: result.conflicts, isCurrent, resolve }));
                if (!confirmed || !isCurrent()) return;
                conflictFingerprint = result.conflictFingerprint;
              }
            }
            const createPayload = {
              ...payload,
              plannedPaymentMethod: payload.plannedPaymentMethod,
              conflictFingerprint,
            };
            if (!isCurrent()) return;
            const created = copyFromId
              ? await copyOneTimeOrder(copyFromId, {
                  ...createPayload,
                  specificationItems: payload.specificationItems ?? [],
                })
              : await createOneTimeOrder(createPayload);
            if (!isCurrent()) return;
            draft.clear();
            router.push(`/one-time-orders/${created.id}`);
          })}
        />
      )}
    </div>
    </FormDialog>
  );
}

