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
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [approvalBridgeOnly, setApprovalBridgeOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
            listInventoryItems(),
            listInventoryMovements({
              ...(movementType ? { movementType } : {}),
              ...(selectedItemId ? { inventoryItemId: selectedItemId } : {}),
              ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
              ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
              ...(approvalBridgeOnly ? { approvalBridge: 'true' } : {}),
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
            }),
            listInventoryObjectReferenceOptions(),
            listInventoryOneTimeOrderReferenceOptions(),
          ]);

        if (!cancelled) {
          setItems(loadedItems);
          setMovements(loadedMovements);
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
    selectedItemId,
    selectedObjectId,
    selectedOrderId,
    approvalBridgeOnly,
    dateFrom,
    dateTo,
  ]);

  return (
    <>
      <PageTitle title="Движения расходников" />

      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
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
                listInventoryItems(),
                listInventoryMovements({
                  ...(movementType ? { movementType } : {}),
                  ...(selectedItemId ? { inventoryItemId: selectedItemId } : {}),
                  ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
                  ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
                  ...(approvalBridgeOnly ? { approvalBridge: 'true' } : {}),
                  ...(dateFrom ? { dateFrom } : {}),
                  ...(dateTo ? { dateTo } : {}),
                }),
              ]);

              setItems(updatedItems);
              setMovements(updatedMovements);
            }}
          />

          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600 }}>Фильтры</div>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label>
                <div style={{ marginBottom: 6 }}>Тип движения</div>
                <select
                  value={movementType}
                  onChange={(event) => setMovementType(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                >
                  <option value="">Все типы</option>
                  {INVENTORY_MOVEMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ marginBottom: 6 }}>Номенклатура</div>
                <select
                  value={selectedItemId}
                  onChange={(event) => setSelectedItemId(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                >
                  <option value="">Все позиции</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ marginBottom: 6 }}>Объект</div>
                <select
                  value={selectedObjectId}
                  onChange={(event) => setSelectedObjectId(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                >
                  <option value="">Все объекты</option>
                  {objectOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ marginBottom: 6 }}>Разовый заказ</div>
                <select
                  value={selectedOrderId}
                  onChange={(event) => setSelectedOrderId(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                >
                  <option value="">Все заказы</option>
                  {oneTimeOrderOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ marginBottom: 6 }}>Период: с</div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                />
              </label>

              <label>
                <div style={{ marginBottom: 6 }}>Период: по</div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={approvalBridgeOnly}
                  onChange={(event) =>
                    setApprovalBridgeOnly(event.target.checked)
                  }
                />
                Только без фото / bridge
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {error}
            </div>
          ) : (
            <InventoryMovementList items={movements} />
          )}
        </div>
      )}
    </>
  );
}
