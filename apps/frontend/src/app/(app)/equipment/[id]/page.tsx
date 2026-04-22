'use client';

import React, { useEffect, useState } from 'react';

import {
  createEquipmentMovement,
  getEquipmentUnitById,
  listEquipmentMovements,
} from '@/entities/equipment/api/equipment-client';
import type {
  EquipmentMovement,
  EquipmentUnit,
} from '@/entities/equipment/model/equipment.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { EquipmentMovementPanel } from '@/features/equipment-card/ui/equipment-movement-panel';
import {
  getEquipmentStatusLabel,
} from '@/shared/lib/equipment-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [unit, setUnit] = useState<EquipmentUnit | null>(null);
  const [movements, setMovements] = useState<EquipmentMovement[]>([]);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async (id: string, cancelled = false): Promise<void> => {
    const loadedUnit = await getEquipmentUnitById(id);

    if (cancelled) {
      return;
    }

    setUnit(loadedUnit);

    const requests: Array<Promise<void>> = [
      listEquipmentMovements(id).then((response) => {
        if (!cancelled) {
          setMovements(response);
        }
      }),
    ];

    if (loadedUnit.capabilities.canCreateMovement) {
      requests.push(
        listObjects().then((response) => {
          if (!cancelled) {
            setObjects(response);
          }
        }),
        listOneTimeOrders().then((response) => {
          if (!cancelled) {
            setOrders(response);
          }
        }),
      );
    } else if (!cancelled) {
      setObjects([]);
      setOrders([]);
    }

    await Promise.all(requests);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const resolved = await params;
        await loadAll(resolved.id, cancelled);
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'Не удалось загрузить оборудование.'));
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
      <PageTitle
        title={unit ? `${unit.catalogItem.name} · ${unit.inventoryNumber}` : 'Оборудование'}
      />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : unit ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 24 }}>
              {unit.catalogItem.name}
            </div>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              <div>
                <div className="page-muted">Категория</div>
                <div>{unit.catalogItem.category}</div>
              </div>
              <div>
                <div className="page-muted">Инвентарный номер</div>
                <div>{unit.inventoryNumber}</div>
              </div>
              <div>
                <div className="page-muted">Серийный номер</div>
                <div>{unit.serialNumber ?? '—'}</div>
              </div>
              <div>
                <div className="page-muted">Статус</div>
                <div>{getEquipmentStatusLabel(unit.status)}</div>
              </div>
              <div>
                <div className="page-muted">Текущая привязка</div>
                <div>
                  {unit.currentObject
                    ? unit.currentObject.name
                    : unit.currentOneTimeOrder
                      ? unit.currentOneTimeOrder.title
                      : 'Склад / без привязки'}
                </div>
              </div>
            </div>
            {unit.notes ? (
              <div>
                <div className="page-muted">Заметки</div>
                <div>{unit.notes}</div>
              </div>
            ) : null}
          </div>

          <EquipmentMovementPanel
            unit={unit}
            movements={movements}
            objects={objects}
            orders={orders}
            onCreateMovement={async ({ payload, evidenceFiles }) => {
              const created = await createEquipmentMovement(unit.id, payload);

              await Promise.all(
                evidenceFiles.map((file) =>
                  uploadFileToEntity({
                    entityType: 'equipment_movement',
                    entityId: created.id,
                    file,
                  }),
                ),
              );

              await loadAll(unit.id);
            }}
          />
        </div>
      ) : (
        <div className="page-card">Оборудование не найдено.</div>
      )}
    </>
  );
}
