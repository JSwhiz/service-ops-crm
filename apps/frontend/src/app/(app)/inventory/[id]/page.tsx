'use client';

import React, { useEffect, useState } from 'react';

import {
  createInventoryMovement,
  getInventoryItemById,
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
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [objectOptions, setObjectOptions] = useState<InventoryObjectReference[]>(
    [],
  );
  const [oneTimeOrderOptions, setOneTimeOrderOptions] = useState<
    InventoryOneTimeOrderReference[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const resolved = await params;
        const loadedItem = await getInventoryItemById(resolved.id);

        if (cancelled) {
          return;
        }

        setItem(loadedItem);

        const requests: Array<Promise<void>> = [
          listInventoryMovements({
            inventoryItemId: resolved.id,
          }).then((response) => {
            if (!cancelled) {
              setMovements(response);
            }
          }),
        ];

        if (loadedItem.capabilities.canCreateMovement) {
          requests.push(
            listInventoryObjectReferenceOptions().then((response) => {
              if (!cancelled) {
                setObjectOptions(response);
              }
            }),
            listInventoryOneTimeOrderReferenceOptions().then((response) => {
              if (!cancelled) {
                setOneTimeOrderOptions(response);
              }
            }),
          );
        }

        await Promise.all(requests);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(
              loadError,
              'Не удалось загрузить карточку расходника.',
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
  }, [params]);

  return (
    <>
      <PageTitle title={item ? item.name : 'Карточка расходника'} />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : item ? (
        <div className="page-stack">
          <div className="page-card hero-card" style={{ display: 'grid', gap: 18 }}>
            <div className="section-header">
              <div>
                <div className="hero-title">{item.name}</div>
                <div className="hero-meta">
                  {item.category} · {item.unit}
                </div>
              </div>
              <span
                className="status-pill"
                data-status={item.isActive ? 'active' : 'archived'}
              >
                {item.isActive ? 'Активна' : 'Неактивна'}
              </span>
            </div>

            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-label">Категория</div>
                <div className="detail-value">{item.category}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Единица измерения</div>
                <div className="detail-value">{item.unit}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Текущий остаток</div>
                <div className="detail-value">
                  {formatInventoryQuantity(item.currentStock, item.unit)}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Текущая цена</div>
                <div className="detail-value">
                  {item.currentUnitPrice === null
                    ? 'Нет прихода с ценой'
                    : `${item.currentUnitPrice.toLocaleString('ru-RU')} ₽`}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Оценка остатка</div>
                <div className="detail-value">
                  {item.currentEstimatedTotalValue.toLocaleString('ru-RU')} ₽
                </div>
              </div>
            </div>
            {item.notes ? (
              <div className="detail-field">
                <div className="detail-label">Примечание</div>
                <div className="detail-value">{item.notes}</div>
              </div>
            ) : null}
          </div>

          {item.capabilities.canCreateMovement ? (
            <InventoryMovementForm
              items={[item]}
              objectOptions={objectOptions}
              oneTimeOrderOptions={oneTimeOrderOptions}
              canCreateMovement={item.capabilities.canCreateMovement}
              canCreateReceipt={item.capabilities.canCreateReceipt}
              canIssueToObject={item.capabilities.canIssueToObject}
              canIssueToOneTimeOrder={item.capabilities.canIssueToOneTimeOrder}
              canReturn={item.capabilities.canReturn}
              canWriteoff={item.capabilities.canWriteoff}
              canAdjust={item.capabilities.canAdjust}
              defaultInventoryItemId={item.id}
              onSubmit={async ({ payload, evidenceFiles }) => {
                const created = await createInventoryMovement(payload);

                for (const file of evidenceFiles) {
                  await uploadFileToEntity({
                    entityType: 'inventory_movement',
                    entityId: created.id,
                    file,
                  });
                }

                const [updatedItem, updatedMovements] = await Promise.all([
                  getInventoryItemById(item.id),
                  listInventoryMovements({
                    inventoryItemId: item.id,
                  }),
                ]);

                setItem(updatedItem);
                setMovements(updatedMovements);
              }}
            />
          ) : null}

          <InventoryMovementList items={movements} />
        </div>
      ) : (
        <div className="page-card">Расходник не найден.</div>
      )}
    </>
  );
}
