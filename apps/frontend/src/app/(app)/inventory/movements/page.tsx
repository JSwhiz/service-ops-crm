'use client';

import React, { useEffect, useState } from 'react';

import {
  createInventoryMovement,
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
} from '@/entities/inventory/model/inventory.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import { InventoryMovementForm } from '@/features/inventory-movement-form/ui/inventory-movement-form';
import { InventoryMovementList } from '@/features/inventory-movement-list/ui/inventory-movement-list';
import { INVENTORY_MOVEMENT_TYPE_OPTIONS } from '@/shared/lib/inventory-presentation';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function InventoryMovementsPage(): React.JSX.Element {
  const { user } = useAuth();
  const capabilities = user?.capabilities;
  const canAccessInventory = capabilities?.canAccessInventory ?? false;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [objectOptions, setObjectOptions] = useState<InventoryObjectReference[]>(
    [],
  );
  const [oneTimeOrderOptions, setOneTimeOrderOptions] = useState<
    InventoryOneTimeOrderReference[]
  >([]);
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
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessInventory) {
      setItems([]);
      setMovements([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const [loadedItems, loadedMovements, loadedObjects, loadedOrders] =
          await Promise.all([
            listInventoryItems({ isActive: true, limit: 100 }),
            listInventoryMovements({
              ...(movementType ? { movementType } : {}),
              ...(movementStatus ? { status: movementStatus } : {}),
              ...(selectedItemId ? { inventoryItemId: selectedItemId } : {}),
              ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
              ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
              ...(approvalBridgeOnly ? { approvalBridge: 'true' } : {}),
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
              page,
              limit: 25,
            }),
            listInventoryObjectReferenceOptions(),
            listInventoryOneTimeOrderReferenceOptions(),
          ]);

        if (!cancelled) {
          setItems(loadedItems.items);
          setMovements(loadedMovements.items);
          setTotalPages(loadedMovements.totalPages);
          setObjectOptions(loadedObjects);
          setOneTimeOrderOptions(loadedOrders);
        }
      } catch (loadError) {
        if (!cancelled) {
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
    movementType,
    movementStatus,
    selectedItemId,
    selectedObjectId,
    selectedOrderId,
    approvalBridgeOnly,
    dateFrom,
    dateTo,
    page,
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
    periodFilterActive ? { id: 'period', label: 'Период', value: dateFrom || dateTo ? `${dateFrom || '…'} — ${dateTo || '…'}` : 'Любые даты', options: [], onChange: () => undefined, onRemove: () => { setDateFrom(''); setDateTo(''); setPeriodFilterActive(false); setPage(1); }, customControl: <div className="registry-date-range"><input aria-label="Дата с" type="date" max={dateTo || undefined} value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /><span>—</span><input aria-label="Дата по" type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></div> } : null,
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
    <div className="workspace-page inventory-workspace">
      <PageTitle title="Движения расходников" />

      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div className="page-stack">
          <InventoryMovementForm
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
            onSubmit={async ({ payload, evidenceFiles }) => {
              const created = await createInventoryMovement(payload);

              for (const file of evidenceFiles) {
                await uploadFileToEntity({
                  entityType: 'inventory_movement',
                  entityId: created.id,
                  file,
                });
              }

              const [updatedItems, updatedMovements] = await Promise.all([
                listInventoryItems({ isActive: true, limit: 100 }),
                listInventoryMovements({
                  ...(movementType ? { movementType } : {}),
                  ...(movementStatus ? { status: movementStatus } : {}),
                  ...(selectedItemId ? { inventoryItemId: selectedItemId } : {}),
                  ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
                  ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
                  ...(approvalBridgeOnly ? { approvalBridge: 'true' } : {}),
                  ...(dateFrom ? { dateFrom } : {}),
                  ...(dateTo ? { dateTo } : {}),
                  page,
                  limit: 25,
                }),
              ]);

              setItems(updatedItems.items);
              setMovements(updatedMovements.items);
              setTotalPages(updatedMovements.totalPages);
            }}
          />

          <RegistryToolbar showSearch={false} searchValue="" searchLabel="" searchPlaceholder="" onSearchChange={() => undefined} activeFilters={activeFilters} availableFilters={availableFilters} />

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {error}
            </div>
          ) : (
            <InventoryMovementList items={movements} />
          )}

          {totalPages > 1 ? (
            <div className="page-card pagination-row">
              <button
                type="button"
                className="button-secondary"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Назад
              </button>
              <span className="page-muted">
                Страница {page} из {totalPages}
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((current) => current + 1)}
              >
                Далее
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
