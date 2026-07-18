'use client';

import React, { useEffect, useState } from 'react';

import { uploadFileToEntity } from '@/entities/file/api/file-client';
import {
  createInventoryMovement,
  getInventoryItemById,
  listInventoryMovements,
  listInventoryObjectReferenceOptions,
  listInventoryOneTimeOrderReferenceOptions,
  updateInventoryItem,
} from '@/entities/inventory/api/inventory-client';
import type {
  InventoryItem,
  InventoryMovement,
  InventoryObjectReference,
  InventoryOneTimeOrderReference,
} from '@/entities/inventory/model/inventory.types';
import { InventoryItemEditor } from '@/features/inventory-item-editor/ui/inventory-item-editor';
import { InventoryMovementForm } from '@/features/inventory-movement-form/ui/inventory-movement-form';
import { InventoryMovementList } from '@/features/inventory-movement-list/ui/inventory-movement-list';
import { ApiError } from '@/shared/api/fetcher';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatInventoryQuantity,
  INVENTORY_MOVEMENT_TYPE_OPTIONS,
} from '@/shared/lib/inventory-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getArchiveBlockerLabel(code: string): string {
  switch (code) {
    case 'non_zero_stock':
      return 'Остаток должен быть равен нулю.';
    case 'pending_movement':
      return 'Есть движения, ожидающие решения.';
    case 'pending_approval':
      return 'Есть незавершённые согласования.';
    default:
      return code;
  }
}

export default function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [itemId, setItemId] = useState<string | null>(null);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [objectOptions, setObjectOptions] = useState<InventoryObjectReference[]>(
    [],
  );
  const [oneTimeOrderOptions, setOneTimeOrderOptions] = useState<
    InventoryOneTimeOrderReference[]
  >([]);
  const [movementType, setMovementType] = useState('');
  const [movementStatus, setMovementStatus] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [movementPage, setMovementPage] = useState(1);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementTotalPages, setMovementTotalPages] = useState(0);
  const [movementReloadKey, setMovementReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMovementsLoading, setIsMovementsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isArchiveConfirmationOpen, setIsArchiveConfirmationOpen] =
    useState(false);
  const [isItemActionPending, setIsItemActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [itemActionError, setItemActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void params.then((resolved) => {
      if (!cancelled) {
        setItemId(resolved.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!itemId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void Promise.all([
      getInventoryItemById(itemId),
      listInventoryObjectReferenceOptions(),
      listInventoryOneTimeOrderReferenceOptions(),
    ])
      .then(([loadedItem, loadedObjects, loadedOrders]) => {
        if (!cancelled) {
          setItem(loadedItem);
          setObjectOptions(loadedObjects);
          setOneTimeOrderOptions(loadedOrders);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось загрузить карточку расходника.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    if (item && window.location.hash === '#edit') {
      setIsEditing(true);
    }
  }, [item]);

  useEffect(() => {
    if (!itemId) {
      return;
    }

    let cancelled = false;
    setIsMovementsLoading(true);
    setMovementError(null);

    void listInventoryMovements({
      inventoryItemId: itemId,
      ...(movementType ? { movementType } : {}),
      ...(movementStatus ? { status: movementStatus } : {}),
      ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
      ...(selectedOrderId ? { oneTimeOrderId: selectedOrderId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      page: movementPage,
      limit: 20,
    })
      .then((response) => {
        if (!cancelled) {
          setMovements(response.items);
          setMovementTotal(response.total);
          setMovementTotalPages(response.totalPages);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setMovementError(
            getErrorMessage(loadError, 'Не удалось загрузить историю движений.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsMovementsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    dateFrom,
    dateTo,
    itemId,
    movementPage,
    movementReloadKey,
    movementStatus,
    movementType,
    selectedObjectId,
    selectedOrderId,
  ]);

  const updateActiveState = async (isActive: boolean): Promise<void> => {
    if (!item) {
      return;
    }

    setIsItemActionPending(true);
    setItemActionError(null);

    try {
      const updated = await updateInventoryItem(item.id, {
        expectedVersion: item.version,
        isActive,
      });
      setItem(updated);
      setIsArchiveConfirmationOpen(false);
    } catch (actionError) {
      if (
        actionError instanceof ApiError &&
        actionError.code === 'INVENTORY_ITEM_VERSION_CONFLICT'
      ) {
        setItemActionError('Карточка была изменена другим пользователем.');
      } else {
        setItemActionError(
          getErrorMessage(actionError, 'Не удалось изменить статус позиции.'),
        );
      }
    } finally {
      setIsItemActionPending(false);
    }
  };

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
                  {item.category} · {item.unit} · версия {item.version}
                </div>
              </div>
              <div className="action-row">
                <span
                  className="status-pill"
                  data-status={item.isActive ? 'active' : 'archived'}
                >
                  {item.isActive ? 'Активна' : 'В архиве'}
                </span>
                {item.capabilities.canEditCatalog ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setIsEditing((value) => !value)}
                  >
                    {isEditing ? 'Закрыть редактор' : 'Редактировать'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-label">Текущий остаток</div>
                <div className="detail-value">
                  {formatInventoryQuantity(item.currentStock, item.unit)}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Максимальная цена поставки</div>
                <div className="detail-value">
                  {item.currentUnitPrice === null
                    ? 'Нет применённых приходов'
                    : `${item.currentUnitPrice.toLocaleString('ru-RU')} ₽`}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Оценка остатка</div>
                <div className="detail-value">
                  {item.currentEstimatedTotalValue.toLocaleString('ru-RU')} ₽
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Создал</div>
                <div className="detail-value">
                  {getUserDisplayName(item.createdBy)}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Создано</div>
                <div className="detail-value">
                  {new Date(item.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Изменено</div>
                <div className="detail-value">
                  {new Date(item.updatedAt).toLocaleString('ru-RU')}
                </div>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span>Все движения</span>
                <strong>{item.summary.movementsCount}</strong>
              </div>
              <div className="summary-card">
                <span>Приходы</span>
                <strong>{item.summary.receiptsCount}</strong>
              </div>
              <div className="summary-card">
                <span>Выдачи</span>
                <strong>{item.summary.issuesCount}</strong>
              </div>
              <div className="summary-card">
                <span>Возвраты</span>
                <strong>{item.summary.returnsCount}</strong>
              </div>
              <div className="summary-card">
                <span>Списания</span>
                <strong>{item.summary.writeoffsCount}</strong>
              </div>
              <div className="summary-card">
                <span>Корректировки</span>
                <strong>{item.summary.adjustmentsCount}</strong>
              </div>
            </div>

            <div className="detail-field">
              <div className="detail-label">Примечание</div>
              <div className="detail-value">{item.notes || 'Не указано'}</div>
            </div>
          </div>

          {isEditing && item.capabilities.canEditCatalog ? (
            <InventoryItemEditor
              key={`${item.id}:${item.version}`}
              item={item}
              onSaved={(updated) => {
                setItem(updated);
                setItemActionError(null);
              }}
              onClose={() => setIsEditing(false)}
            />
          ) : null}

          {item.capabilities.canEditCatalog ? (
            <div className="page-card" style={{ display: 'grid', gap: 12 }}>
              <div className="section-header">
                <div>
                  <div className="section-title">Статус позиции</div>
                  <div className="page-muted">
                    Архивная позиция остаётся в истории, но недоступна для новых
                    движений.
                  </div>
                </div>
                {item.isActive ? (
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => setIsArchiveConfirmationOpen(true)}
                  >
                    Архивировать
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isItemActionPending}
                    onClick={() => void updateActiveState(true)}
                  >
                    Восстановить
                  </button>
                )}
              </div>

              {isArchiveConfirmationOpen && item.isActive ? (
                <div className="inline-notice inline-notice--warning">
                  <strong>Проверка перед архивированием</strong>
                  <div>
                    Остаток: {formatInventoryQuantity(item.currentStock, item.unit)}
                  </div>
                  <div>
                    Движений на согласовании:{' '}
                    {item.archiveState.pendingMovementsCount}; согласований:{' '}
                    {item.archiveState.pendingApprovalsCount}
                  </div>
                  {item.archiveState.blockerCodes.map((code) => (
                    <div key={code}>{getArchiveBlockerLabel(code)}</div>
                  ))}
                  <div className="action-row">
                    <button
                      type="button"
                      className="button-danger"
                      disabled={
                        !item.archiveState.canArchive || isItemActionPending
                      }
                      onClick={() => void updateActiveState(false)}
                    >
                      Подтвердить архивирование
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setIsArchiveConfirmationOpen(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : null}

              {itemActionError ? (
                <div className="form-error">
                  {itemActionError}{' '}
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => {
                      void getInventoryItemById(item.id).then(setItem);
                    }}
                  >
                    Загрузить актуальные данные
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {item.isActive && item.capabilities.canCreateMovement ? (
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

                const updatedItem = await getInventoryItemById(item.id);
                setItem(updatedItem);
                setMovementPage(1);
                setMovementReloadKey((value) => value + 1);
              }}
            />
          ) : null}

          <div className="page-card" style={{ display: 'grid', gap: 14 }}>
            <div className="section-header">
              <div>
                <div className="section-title">История движений</div>
                <div className="page-muted">Найдено записей: {movementTotal}</div>
              </div>
            </div>
            <div className="detail-grid">
              <label>
                <div className="detail-label">Тип</div>
                <select
                  value={movementType}
                  onChange={(event) => {
                    setMovementType(event.target.value);
                    setMovementPage(1);
                  }}
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
                <div className="detail-label">Статус</div>
                <select
                  value={movementStatus}
                  onChange={(event) => {
                    setMovementStatus(event.target.value);
                    setMovementPage(1);
                  }}
                >
                  <option value="">Все статусы</option>
                  <option value="applied">Применено</option>
                  <option value="pending_approval">Ожидает согласования</option>
                  <option value="rejected">Отклонено</option>
                  <option value="cancelled">Отменено</option>
                </select>
              </label>
              <label>
                <div className="detail-label">Объект</div>
                <select
                  value={selectedObjectId}
                  onChange={(event) => {
                    setSelectedObjectId(event.target.value);
                    setMovementPage(1);
                  }}
                >
                  <option value="">Все объекты</option>
                  {objectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="detail-label">Разовый заказ</div>
                <select
                  value={selectedOrderId}
                  onChange={(event) => {
                    setSelectedOrderId(event.target.value);
                    setMovementPage(1);
                  }}
                >
                  <option value="">Все заказы</option>
                  {oneTimeOrderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="detail-label">С даты</div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setMovementPage(1);
                  }}
                />
              </label>
              <label>
                <div className="detail-label">По дату</div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setMovementPage(1);
                  }}
                />
              </label>
            </div>
          </div>

          {isMovementsLoading ? (
            <div className="page-card">Загрузка истории...</div>
          ) : movementError ? (
            <div className="page-card form-error">{movementError}</div>
          ) : (
            <InventoryMovementList items={movements} />
          )}

          {movementTotalPages > 1 ? (
            <div className="page-card pagination-row">
              <button
                type="button"
                className="button-secondary"
                disabled={movementPage <= 1 || isMovementsLoading}
                onClick={() =>
                  setMovementPage((current) => Math.max(1, current - 1))
                }
              >
                Назад
              </button>
              <span className="page-muted">
                Страница {movementPage} из {movementTotalPages}
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={
                  movementPage >= movementTotalPages || isMovementsLoading
                }
                onClick={() => setMovementPage((current) => current + 1)}
              >
                Далее
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="page-card">Расходник не найден.</div>
      )}
    </>
  );
}
