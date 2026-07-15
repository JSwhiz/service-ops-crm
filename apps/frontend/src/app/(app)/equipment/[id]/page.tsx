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
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
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
  const [orders, setOrders] = useState<OneTimeOrderListItem[]>([]);
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
        listOneTimeOrders({
          limit: 100,
          sortBy: 'title',
          sortDirection: 'asc',
        }).then((response) => {
          if (!cancelled) {
            setOrders(response.items);
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
        <div className="page-stack">
          <div className="page-card hero-card" style={{ display: 'grid', gap: 18 }}>
            <div className="section-header">
              <div>
                <div className="hero-title">{unit.catalogItem.name}</div>
                <div className="hero-meta">
                  {unit.inventoryNumber}
                  {unit.serialNumber ? ` · ${unit.serialNumber}` : ''}
                </div>
              </div>
              <span className="status-pill" data-status={unit.status}>
                {getEquipmentStatusLabel(unit.status)}
              </span>
            </div>

            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-label">Категория</div>
                <div className="detail-value">{unit.catalogItem.category}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Инвентарный номер</div>
                <div className="detail-value">{unit.inventoryNumber}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Серийный номер</div>
                <div className="detail-value">{unit.serialNumber ?? '—'}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Текущая привязка</div>
                <div className="detail-value">
                  {unit.currentObject
                    ? unit.currentObject.name
                    : unit.currentOneTimeOrder
                      ? unit.currentOneTimeOrder.title
                      : 'Склад / без привязки'}
                </div>
              </div>
            </div>
            {unit.notes ? (
              <div className="detail-field">
                <div className="detail-label">Заметки</div>
                <div className="detail-value">{unit.notes}</div>
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
