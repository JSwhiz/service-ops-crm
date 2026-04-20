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
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 24 }}>{item.name}</div>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              <div>
                <div className="page-muted">Категория</div>
                <div>{item.category}</div>
              </div>
              <div>
                <div className="page-muted">Единица измерения</div>
                <div>{item.unit}</div>
              </div>
              <div>
                <div className="page-muted">Текущий остаток</div>
                <div>{formatInventoryQuantity(item.currentStock, item.unit)}</div>
              </div>
              <div>
                <div className="page-muted">Статус</div>
                <div>{item.isActive ? 'Активна' : 'Неактивна'}</div>
              </div>
            </div>
            {item.notes ? (
              <div>
                <div className="page-muted">Примечание</div>
                <div>{item.notes}</div>
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
