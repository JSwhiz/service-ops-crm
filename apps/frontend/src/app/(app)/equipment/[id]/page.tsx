'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { ApiError } from '@/shared/api/fetcher';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';

import {
  createEquipmentMovement,
  deleteEquipmentUnit,
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
import { Alert, BackLink, Button, LoadingState, StatusBadge, Surface } from '@/shared/ui/foundation';
import inventoryStyles from '@/app/(app)/inventory/inventory-workspace.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function getDeleteBlockerLabel(code: string): string {
  switch (code) {
    case 'movement_history':
      return 'По оборудованию уже есть история операций. Для выбытия используйте списание.';
    case 'assigned':
      return 'Сначала верните оборудование с объекта или заказа.';
    case 'not_in_storage':
      return 'Удалить можно только оборудование в статусе «На складе».';
    default:
      return code;
  }
}

export default function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const accessRevision = useAccessRevision();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [accessRetry, setAccessRetry] = useState(0);
  const [unit, setUnit] = useState<EquipmentUnit | null>(null);
  const [movements, setMovements] = useState<EquipmentMovement[]>([]);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedWithoutAccess, setSavedWithoutAccess] = useState<{ hasPendingFiles: boolean } | null>(null);
  useOpenAccessRefresh(unit !== null);

  const loadAll = async (id: string, isCancelled: () => boolean = () => false): Promise<void> => {
    const loadedUnit = await getEquipmentUnitById(id);

    if (isCancelled()) {
      return;
    }

    setUnit(loadedUnit);

    const requests: Array<Promise<void>> = loadedUnit.capabilities.canViewHistory ? [
      listEquipmentMovements(id).then((response) => {
        if (!isCancelled()) {
          setMovements(response);
        }
      }),
    ] : [];
    if (!loadedUnit.capabilities.canViewHistory && !isCancelled()) setMovements([]);

    if (loadedUnit.capabilities.canAssignToObject) {
      requests.push(
        listObjects().then((response) => {
          if (!isCancelled()) {
            setObjects(response);
          }
        }),
      );
    } else if (!isCancelled()) {
      setObjects([]);
    }
    if (loadedUnit.capabilities.canAssignToOneTimeOrder) {
      requests.push(listOneTimeOrders({
          limit: 100,
          sortBy: 'title',
          sortDirection: 'asc',
        }).then((response) => {
          if (!isCancelled()) {
            setOrders(response.items);
          }
        }));
    } else if (!isCancelled()) {
      setOrders([]);
    }

    await Promise.all(requests);
    if (!isCancelled()) setLoadedAccessRevision(accessRevision);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setError(null);

      try {
        const resolved = await params;
        await loadAll(resolved.id, () => cancelled);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof ApiError && (loadError.statusCode === 403 || loadError.statusCode === 404)
            ? 'Оборудование не найдено или недоступно.'
            : 'Не удалось загрузить карточку оборудования.');
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
  }, [params, accessRevision, accessRetry]);

  if (savedWithoutAccess) return (
    <div className={`ui-page ${inventoryStyles.equipmentWorkspace}`}>
      <BackLink href="/equipment">Оборудование</BackLink>
      <Alert tone="success" role="status">
        Операция сохранена. Доступ к карточке изменился.
        {savedWithoutAccess.hasPendingFiles ? ' Выбранные файлы не прикрепились.' : ''}
      </Alert>
      <Button onClick={() => {
        setSavedWithoutAccess(null);
        setUnit(null);
        setIsLoading(true);
        setError(null);
        setLoadedAccessRevision(null);
        setAccessRetry((value) => value + 1);
      }}>Проверить доступ</Button>
    </div>
  );

  return (
    <div className={`ui-page ${inventoryStyles.equipmentWorkspace}`}>
      <BackLink href="/equipment">Оборудование</BackLink>
      {loadedAccessRevision !== accessRevision && !error ? <LoadingState label="Проверка доступа к оборудованию…" /> : null}
      {loadedAccessRevision !== accessRevision && error ? <Alert tone="danger" action={<Button onClick={() => setAccessRetry((value) => value + 1)}>Повторить проверку доступа</Button>}>{error}</Alert> : null}
      <AccessSnapshotBoundary blocked={loadedAccessRevision !== accessRevision}>

      {isLoading ? (
        <LoadingState label="Загружаем оборудование…" />
      ) : error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : unit ? (
        <div className="ui-stack ui-stack--lg">
          <Surface padding="md" className="hero-card ui-stack ui-stack--lg">
            <div className="ui-section-header">
              <div>
                <div className="hero-title">{unit.catalogItem.name}</div>
                <div className="hero-meta">
                  {unit.inventoryNumber}
                  {unit.serialNumber ? ` · ${unit.serialNumber}` : ''}
                </div>
              </div>
              <StatusBadge status={unit.status}>
                {getEquipmentStatusLabel(unit.status)}
              </StatusBadge>
            </div>

            <div className="ui-detail-grid">
              <div className="ui-detail-field">
                <div className="ui-detail-label">Категория</div>
                <div className="ui-detail-value">{unit.catalogItem.category}</div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Инвентарный номер</div>
                <div className="ui-detail-value">{unit.inventoryNumber}</div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Серийный номер</div>
                <div className="ui-detail-value">{unit.serialNumber ?? '—'}</div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Текущая привязка</div>
                <div className="ui-detail-value">
                  {unit.currentObject
                    ? unit.currentObject.name
                    : unit.currentOneTimeOrder
                      ? unit.currentOneTimeOrder.title
                      : 'Склад / без привязки'}
                </div>
              </div>
            </div>
            {unit.notes ? (
              <div className="ui-detail-field">
                <div className="ui-detail-label">Заметки</div>
                <div className="ui-detail-value">{unit.notes}</div>
              </div>
            ) : null}
          </Surface>

          {isDeleteConfirmationOpen && !unit.capabilities.canDelete ? (
            <Alert tone="warning" role="status">Удаление оборудования недоступно. Карточка не удалена. После возврата доступа подтвердите удаление вручную.</Alert>
          ) : null}
          {unit.capabilities.canDelete ? (
            <Surface padding="md" style={{ display: 'grid', gap: 12 }}>
              <div className="ui-section-header">
                <div>
                  <div className="ui-section-title">Удаление карточки</div>
                  <div className="ui-text-muted">
                    Доступно только для ошибочно заведённого оборудования без истории операций.
                  </div>
                </div>
                <Button variant="danger"
                  disabled={!unit.deletionState.canDelete}
                  onClick={() => setIsDeleteConfirmationOpen(true)}
                >
                  Удалить
                </Button>
              </div>

              {!unit.deletionState.canDelete && unit.deletionState.blockerCodes.length > 0 ? (
                <div className="ui-text-muted">
                  {unit.deletionState.blockerCodes
                    .map((code) => getDeleteBlockerLabel(code))
                    .join(' ')}
                </div>
              ) : null}

              {isDeleteConfirmationOpen && unit.deletionState.canDelete ? (
                <Alert tone="warning">
                  <strong>Удалить «{unit.catalogItem.name} · {unit.inventoryNumber}»?</strong>
                  <div>Карточка будет удалена безвозвратно, так как по ней ещё не было операций.</div>
                  <div className="ui-inline">
                    <Button variant="danger"
                      disabled={isDeleting}
                      onClick={() => {
                        setIsDeleting(true);
                        setDeleteError(null);
                        void deleteEquipmentUnit(unit.id)
                          .then(() => {
                            router.push('/equipment');
                            router.refresh();
                          })
                          .catch((deleteFailure: unknown) => {
                            setDeleteError(
                              getErrorMessage(deleteFailure, 'Не удалось удалить оборудование.'),
                            );
                          })
                          .finally(() => setIsDeleting(false));
                      }}
                    >
                      {isDeleting ? 'Удаляем...' : 'Удалить'}
                    </Button>
                    <Button
                      disabled={isDeleting}
                      onClick={() => setIsDeleteConfirmationOpen(false)}
                    >
                      Отмена
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {deleteError ? <div className="form-error">{deleteError}</div> : null}
            </Surface>
          ) : null}

          <EquipmentMovementPanel
            unit={unit}
            movements={movements}
            objects={objects}
            orders={orders}
            onCreateMovement={async ({ payload, evidenceFiles }) => {
              const created = await createEquipmentMovement(unit.id, payload);

              if (isSavedWithoutAccess(created)) {
                setUnit(null);
                setMovements([]);
                setObjects([]);
                setOrders([]);
                setLoadedAccessRevision(null);
                setError(null);
                setSavedWithoutAccess({ hasPendingFiles: evidenceFiles.length > 0 });
                return;
              }

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
        <Surface padding="md">Оборудование не найдено.</Surface>
      )}
      </AccessSnapshotBoundary>
    </div>
  );
}
