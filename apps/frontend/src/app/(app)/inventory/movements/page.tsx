'use client';

import React, { useCallback, useDeferredValue, useEffect, useState } from 'react';

import {
  createInventoryMovement,
  getInventoryItemById,
  listInventoryItems,
  listInventoryMovements,
  listInventoryObjectReferenceOptions,
  listInventoryOneTimeOrderReferenceOptions,
} from '@/entities/inventory/api/inventory-client';
import type {
  InventoryItem,
  InventoryMovement,
  InventoryObjectReference,
  InventoryOneTimeOrderReference,
  InventoryItemListResponse,
} from '@/entities/inventory/model/inventory.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import { InventoryMovementForm } from '@/features/inventory-movement-form/ui/inventory-movement-form';
import { InventoryMovementList } from '@/features/inventory-movement-list/ui/inventory-movement-list';
import { INVENTORY_MOVEMENT_TYPE_OPTIONS } from '@/shared/lib/inventory-presentation';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { mergeInventoryChoices } from '@/features/inventory-movement-form/model/strict-scope';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, BackLink, Button, Field, LoadingState, Surface } from '@/shared/ui/foundation';
import inventoryStyles from '@/app/(app)/inventory/inventory-workspace.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

type ReadSnapshot<T> = { key: string; data: T | null; error: string | null };

export default function InventoryMovementsPage(): React.JSX.Element {
  const { user } = useAuth();
  const capabilities = user?.capabilities;
  const canAccessInventory = capabilities?.canAccessInventory ?? false;
  const canReadMovements = capabilities?.canViewInventoryMovements === true;
  const accessRevision = useAccessRevision();
  const [reload, setReload] = useState(0);

  const [itemSearch, setItemSearch] = useState('');
  const deferredItemSearch = useDeferredValue(itemSearch);
  const [itemPage, setItemPage] = useState(1);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [catalogSnapshot, setCatalogSnapshot] = useState<ReadSnapshot<InventoryItemListResponse> | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ReadSnapshot<InventoryItem[]> | null>(null);
  const [objectSnapshot, setObjectSnapshot] = useState<ReadSnapshot<InventoryObjectReference[]> | null>(null);
  const [orderSnapshot, setOrderSnapshot] = useState<ReadSnapshot<InventoryOneTimeOrderReference[]> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [movementType, setMovementType] = useState('');
  const [movementStatus, setMovementStatus] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [objectFilterActive, setObjectFilterActive] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [approvalBridgeOnly, setApprovalBridgeOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodFilterActive, setPeriodFilterActive] = useState(false);
  const [page, setPage] = useState(1);
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(25, [25, 50, 100], () => setPage(1));
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedHistoryKey, setLoadedHistoryKey] = useState<string | null>(null);
  const refsKey = JSON.stringify([accessRevision, reload]);
  const catalogKey = JSON.stringify([accessRevision, deferredItemSearch, itemPage, reload]);
  const selectedKey = JSON.stringify([accessRevision, selectedItemIds, reload]);
  const historyKey = JSON.stringify([accessRevision, movementType, movementStatus, selectedItemId, selectedObjectId, selectedOrderId, approvalBridgeOnly, dateFrom, dateTo, page, pageSize, reload]);
  const catalog = catalogSnapshot?.key === catalogKey ? catalogSnapshot : null;
  const selection = selectedSnapshot?.key === selectedKey ? selectedSnapshot : null;
  const objects = objectSnapshot?.key === refsKey ? objectSnapshot : null;
  const orders = orderSnapshot?.key === refsKey ? orderSnapshot : null;
  // Selected IDs are authorized by their own fresh direct reads, not by a page
  // cache or their presence/absence in a search result.
  const items = mergeInventoryChoices((catalog?.data?.items ?? []).filter((item) => !selectedItemIds.includes(item.id)), selection?.data ?? []);
  const objectOptions = objects?.data ?? [];
  const oneTimeOrderOptions = orders?.data ?? [];
  const scopeReady = canAccessInventory && selection?.data !== null && selection !== null;
  const rememberSelection = useCallback((ids: string[]) => {
    setSelectedItemIds((current) => JSON.stringify(current) === JSON.stringify(ids) ? current : ids);
  }, []);

  useEffect(() => {
    if (!canAccessInventory) return;
    let active = true;
    void listInventoryItems({ isActive: true, page: itemPage, limit: 100, search: deferredItemSearch.trim() || undefined })
      .then((data) => { if (active) setCatalogSnapshot({ key: catalogKey, data, error: null }); })
      .catch((caughtError) => { if (active) setCatalogSnapshot({ key: catalogKey, data: null, error: getErrorMessage(caughtError, 'Не удалось загрузить страницу номенклатуры.') }); });
    return () => { active = false; };
  }, [canAccessInventory, catalogKey, itemPage, deferredItemSearch]);

  useEffect(() => {
    if (!canAccessInventory) return;
    let active = true;
    void Promise.allSettled(selectedItemIds.map((id) => getInventoryItemById(id))).then((results) => {
      if (!active) return;
      const data = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      setSelectedSnapshot({ key: selectedKey, data, error: results.some((result) => result.status === 'rejected') ? 'Не удалось подтвердить доступ ко всем выбранным позициям. Черновик сохранён.' : null });
    });
    return () => { active = false; };
  }, [canAccessInventory, selectedKey, selectedItemIds]);

  useEffect(() => {
    if (!canAccessInventory) return;
    let active = true;
    void listInventoryObjectReferenceOptions()
      .then((data) => { if (active) setObjectSnapshot({ key: refsKey, data, error: null }); })
      .catch((caughtError) => { if (active) setObjectSnapshot({ key: refsKey, data: null, error: getErrorMessage(caughtError, 'Не удалось загрузить объекты.') }); });
    return () => { active = false; };
  }, [canAccessInventory, refsKey]);

  useEffect(() => {
    if (!canAccessInventory) return;
    let active = true;
    void listInventoryOneTimeOrderReferenceOptions()
      .then((data) => { if (active) setOrderSnapshot({ key: refsKey, data, error: null }); })
      .catch((caughtError) => { if (active) setOrderSnapshot({ key: refsKey, data: null, error: getErrorMessage(caughtError, 'Не удалось загрузить заказы.') }); });
    return () => { active = false; };
  }, [canAccessInventory, refsKey]);

  useEffect(() => {
    if (!canAccessInventory || !canReadMovements) {
      setMovements([]);
      setLoadedHistoryKey(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const loadedMovements = await listInventoryMovements({
              ...(movementType ? { movementType } : {}),
              ...(movementStatus ? { status: movementStatus } : {}),
              ...(selectedItemId ? { inventoryItemId: selectedItemId } : {}),
              ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
              ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
              ...(approvalBridgeOnly ? { approvalBridge: 'true' } : {}),
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
              page,
              limit: pageSize,
            });

        if (!cancelled) {
          setMovements(loadedMovements.items);
          setTotal(loadedMovements.total);
          setTotalPages(loadedMovements.totalPages);
          setLoadedHistoryKey(historyKey);
        }
      } catch (loadError) {
        if (!cancelled) {
          setLoadedHistoryKey(null);
          setMovements([]);
          setError(
            getErrorMessage(
              loadError,
              'Не удалось загрузить складские движения.',
            ),
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
  }, [
    canAccessInventory,
    canReadMovements,
    historyKey,
    movementType,
    movementStatus,
    selectedItemId,
    selectedObjectId,
    selectedOrderId,
    approvalBridgeOnly,
    dateFrom,
    dateTo,
    page,
    pageSize,
  ]);

  const movementTypeOptions = INVENTORY_MOVEMENT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
  const movementStatusOptions = [
    { value: 'applied', label: 'Применено' },
    { value: 'pending_approval', label: 'Ожидает согласования' },
    { value: 'rejected', label: 'Отклонено' },
    { value: 'cancelled', label: 'Отменено' },
  ];
  const activeFilters = [
    movementType ? { id: 'type', label: 'Тип движения', value: movementType, options: movementTypeOptions, onChange: (value: string) => { setMovementType(value); setPage(1); }, onRemove: () => { setMovementType(''); setPage(1); } } : null,
    movementStatus ? { id: 'status', label: 'Статус', value: movementStatus, options: movementStatusOptions, onChange: (value: string) => { setMovementStatus(value); setPage(1); }, onRemove: () => { setMovementStatus(''); setPage(1); } } : null,
    selectedItemId ? { id: 'item', label: 'Номенклатура', value: selectedItemId, options: items.map((item) => ({ value: item.id, label: item.name })), onChange: (value: string) => { setSelectedItemId(value); setPage(1); }, onRemove: () => { setSelectedItemId(''); setPage(1); } } : null,
    objectFilterActive || selectedObjectId ? { id: 'object', label: 'Объект', value: selectedObjectId, options: objectOptions.map((item) => ({ value: item.id, label: item.name })), onChange: (value: string) => { setSelectedObjectId(value); setPage(1); }, onRemove: () => { setSelectedObjectId(''); setObjectFilterActive(false); setPage(1); }, customControl: <SearchableSelect label="Объект" hideLabel value={selectedObjectId} options={objectOptions.map((item) => ({ value: item.id, label: item.name }))} placeholder="Все объекты" searchPlaceholder="Введите название объекта" minimumSearchLength={2} searchPromptText="Введите не менее 2 символов, чтобы найти объект" searchInputVariant="registry" onChange={(value) => { setSelectedObjectId(value); setPage(1); }} /> } : null,
    selectedOrderId ? { id: 'order', label: 'Разовый заказ', value: selectedOrderId, options: oneTimeOrderOptions.map((item) => ({ value: item.id, label: item.title })), onChange: (value: string) => { setSelectedOrderId(value); setPage(1); }, onRemove: () => { setSelectedOrderId(''); setPage(1); } } : null,
    periodFilterActive ? { id: 'period', label: 'Период', value: dateFrom || dateTo ? `${dateFrom || '…'} — ${dateTo || '…'}` : 'Любые даты', options: [], onChange: () => undefined, onRemove: () => { setDateFrom(''); setDateTo(''); setPeriodFilterActive(false); setPage(1); }, customControl: <div className="registry-date-range"><DatePicker aria-label="Дата с" max={dateTo || undefined} value={dateFrom} onChange={(nextValue) => { setDateFrom(nextValue); setPage(1); }} /><span>—</span><DatePicker aria-label="Дата по" min={dateFrom || undefined} value={dateTo} onChange={(nextValue) => { setDateTo(nextValue); setPage(1); }} /></div> } : null,
    approvalBridgeOnly ? { id: 'bridge', label: 'Фото', value: 'true', options: [{ value: 'true', label: 'Только без фото / bridge' }], onChange: () => undefined, onRemove: () => { setApprovalBridgeOnly(false); setPage(1); } } : null,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);
  const availableFilters = [
    !movementType ? { id: 'type', label: 'Тип движения', options: movementTypeOptions, onAdd: (value: string) => { setMovementType(value); setPage(1); } } : null,
    !movementStatus ? { id: 'status', label: 'Статус', options: movementStatusOptions, onAdd: (value: string) => { setMovementStatus(value); setPage(1); } } : null,
    !selectedItemId ? { id: 'item', label: 'Номенклатура', options: items.map((item) => ({ value: item.id, label: item.name })), onAdd: (value: string) => { setSelectedItemId(value); setPage(1); } } : null,
    !objectFilterActive && !selectedObjectId ? { id: 'object', label: 'Объект', options: [{ value: 'object', label: 'Выбрать объект' }], onAdd: () => { setObjectFilterActive(true); setPage(1); } } : null,
    !selectedOrderId ? { id: 'order', label: 'Разовый заказ', options: oneTimeOrderOptions.map((item) => ({ value: item.id, label: item.title })), onAdd: (value: string) => { setSelectedOrderId(value); setPage(1); } } : null,
    !periodFilterActive ? { id: 'period', label: 'Период', options: [{ value: 'period', label: 'Выбрать даты' }], onAdd: () => { setPeriodFilterActive(true); setPage(1); } } : null,
    !approvalBridgeOnly ? { id: 'bridge', label: 'Фото', options: [{ value: 'true', label: 'Только без фото / bridge' }], onAdd: () => { setApprovalBridgeOnly(true); setPage(1); } } : null,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);

  return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <BackLink href="/inventory">Расходники</BackLink>

      {!canAccessInventory ? (
        <Surface padding="md">У вас нет доступа к inventory-модулю.</Surface>
      ) : null}
      <AccessSnapshotBoundary blocked={!canAccessInventory}>
        <div className="ui-stack ui-stack--lg">
          <RegistryToolbar
            showSearch={false}
            searchValue=""
            searchLabel=""
            searchPlaceholder=""
            onSearchChange={() => undefined}
            activeFilters={activeFilters}
            availableFilters={availableFilters}
            actions={(
              <Button
                variant={createOpen ? 'default' : 'primary'}
                icon={createOpen ? undefined : <PlusIcon />}
                onClick={() => setCreateOpen((value) => !value)}
              >
                {createOpen ? 'Скрыть форму' : 'Новое движение'}
              </Button>
            )}
          />

          {createOpen ? <Surface padding="md">
            <Field label="Поиск номенклатуры на сервере">
              <input value={itemSearch} onChange={(event) => { setItemSearch(event.target.value); setItemPage(1); }} placeholder="Название, категория или единица" />
            </Field>
            {!catalog ? <LoadingState label="Загружаем страницу номенклатуры…" /> : catalog.error ? <Alert tone="warning">{catalog.error}</Alert> : catalog.data ? <TablePagination
              page={catalog.data.page} totalPages={catalog.data.totalPages} label="Страницы номенклатуры для движения"
              summary={`На этой странице ${catalog.data.items.length} из ${catalog.data.total} позиций. Выбранные позиции сохраняются отдельно.`}
              onPageChange={setItemPage}
            /> : null}
            {selection?.error ? <Alert tone="warning">{selection.error}</Alert> : null}
            {!objects ? <LoadingState label="Проверяем объекты…" /> : objects.error ? <Alert tone="warning">{objects.error}</Alert> : null}
            {!orders ? <LoadingState label="Проверяем заказы…" /> : orders.error ? <Alert tone="warning">{orders.error}</Alert> : null}
            <Button onClick={() => setReload((value) => value + 1)}>Обновить списки и права</Button>
          </Surface> : null}
          {createOpen ? <InventoryMovementForm
            strictScope
            scopeReady={scopeReady}
            onSelectedItemIdsChange={rememberSelection}
            items={items}
            objectOptions={objectOptions}
            oneTimeOrderOptions={oneTimeOrderOptions}
            canCreateMovement={capabilities?.canCreateInventoryMovement ?? false}
            canCreateReceipt={capabilities?.canCreateInventoryReceipt ?? false}
            canIssueToObject={capabilities?.canIssueInventoryToObject ?? false}
            canIssueToOneTimeOrder={
              capabilities?.canIssueInventoryToOneTimeOrder ?? false
            }
            canReturn={capabilities?.canReturnInventory ?? false}
            canWriteoff={capabilities?.canWriteoffInventory ?? false}
            canAdjust={capabilities?.canAdjustInventory ?? false}
            onSubmit={async ({ payload }) => {
              const created = await createInventoryMovement(payload);
              return created;
            }}
            onAttachEvidence={async (movementId, files) => {
              await Promise.all(files.map((file) => uploadFileToEntity({
                entityType: 'inventory_movement',
                entityId: movementId,
                file,
              })));
            }}
            onRefresh={async () => {
              setReload((value) => value + 1);
            }}
          /> : null}

          {!canReadMovements ? <Alert tone="info">Просмотр истории движений недоступен. Разрешённые операции можно выполнить в форме.</Alert> : isLoading || (loadedHistoryKey !== historyKey && !error) ? (
            <LoadingState label="Загружаем движения…" />
          ) : error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : (
            <InventoryMovementList items={loadedHistoryKey === historyKey ? movements : []} />
          )}

          {canReadMovements && loadedHistoryKey === historyKey && !isLoading && !error ? <TablePagination page={page} totalPages={totalPages} pending={isLoading} label="Страницы движений расходников"
            summary={total > 0 ? `Показано ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} из ${total}` : 'Движения не найдены'}
            onPageChange={setPage}
            pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={setPageSize} /> : null}
        </div>
      </AccessSnapshotBoundary>
    </div>
  );
}
