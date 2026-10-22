'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { uploadFileToEntity } from '@/entities/file/api/file-client';
import {
  createInventoryMovement,
  deleteInventoryItem,
  getInventoryItemById,
  listInventoryMovements,
  listInventoryObjectReferenceOptions,
  listInventoryOneTimeOrderReferenceOptions,
  restoreInventoryItem,
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
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatInventoryQuantity,
  INVENTORY_MOVEMENT_TYPE_OPTIONS,
} from '@/shared/lib/inventory-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, Button, StatusBadge, Surface } from '@/shared/ui/foundation';
import inventoryStyles from '@/app/(app)/inventory/inventory-workspace.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getDeleteBlockerLabel(code: string): string {
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
  const router = useRouter();
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
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] =
    useState(false);
  const [isItemActionPending, setIsItemActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [itemActionError, setItemActionError] = useState<string | null>(null);
  const canCreateMovement =
    (item?.isActive ?? false) && (item?.capabilities.canCreateMovement ?? false);
  const canViewMovementHistory = item?.capabilities.canViewReports ?? false;

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

    void getInventoryItemById(itemId)
      .then((loadedItem) => {
        if (!cancelled) {
          setItem(loadedItem);
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
    if (!canCreateMovement) {
      setObjectOptions([]);
      setOneTimeOrderOptions([]);
      return;
    }

    let cancelled = false;
    void Promise.all([
      listInventoryObjectReferenceOptions(),
      listInventoryOneTimeOrderReferenceOptions(),
    ])
      .then(([loadedObjects, loadedOrders]) => {
        if (!cancelled) {
          setObjectOptions(loadedObjects);
          setOneTimeOrderOptions(loadedOrders);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setObjectOptions([]);
          setOneTimeOrderOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canCreateMovement]);

  useEffect(() => {
    if (item && window.location.hash === '#edit') {
      setIsEditing(true);
    }
  }, [item]);

  useEffect(() => {
    if (!itemId || !canViewMovementHistory) {
      setMovements([]);
      setMovementTotal(0);
      setMovementTotalPages(0);
      setMovementError(null);
      setIsMovementsLoading(false);
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
    canViewMovementHistory,
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

  const handleRestore = async (): Promise<void> => {
    if (!item) {
      return;
    }

    setIsItemActionPending(true);
    setItemActionError(null);

    try {
      const restored = await restoreInventoryItem(item.id, item.version);
      setItem(restored);
      setIsDeleteConfirmationOpen(false);
    } catch (actionError) {
      setItemActionError(
        getErrorMessage(actionError, 'Не удалось восстановить позицию.'),
      );
    } finally {
      setIsItemActionPending(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!item) {
      return;
    }

    setIsItemActionPending(true);
    setItemActionError(null);

    try {
      const result = await deleteInventoryItem(item.id);
      if (result.mode === 'hard') {
        router.push('/inventory');
        router.refresh();
        return;
      }

      const updated = await getInventoryItemById(item.id);
      setItem(updated);
      setIsDeleteConfirmationOpen(false);
    } catch (actionError) {
      setItemActionError(
        getErrorMessage(actionError, 'Не удалось удалить позицию.'),
      );
    } finally {
      setIsItemActionPending(false);
    }
  };

  return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <PageTitle title={item ? item.name : 'Карточка расходника'} />

      {isLoading ? (
        <Surface padding="md">Загрузка...</Surface>
      ) : error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : item ? (
        <div className="ui-stack ui-stack--lg">
          <Surface padding="md" className="hero-card" style={{ display: 'grid', gap: 18 }}>
            <div className="ui-section-header">
              <div>
                <div className="hero-title">{item.name}</div>
                <div className="hero-meta">
                  {item.category} · {item.unit} · версия {item.version}
                </div>
              </div>
              <div className="ui-inline">
                <StatusBadge
                  status={item.isActive ? 'active' : 'archived'}
                >
                  {item.isActive ? 'Активна' : 'Удалена'}
                </StatusBadge>
                {item.capabilities.canEditCatalog && item.isActive ? (
                  <Button
                    onClick={() => setIsEditing((value) => !value)}
                  >
                    {isEditing ? 'Закрыть редактор' : 'Редактировать'}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="ui-detail-grid">
              <div className="ui-detail-field">
                <div className="ui-detail-label">Текущий остаток</div>
                <div className="ui-detail-value">
                  {formatInventoryQuantity(item.currentStock, item.unit)}
                </div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Максимальная цена поставки</div>
                <div className="ui-detail-value">
                  {item.currentUnitPrice === null
                    ? 'Нет применённых приходов'
                    : `${item.currentUnitPrice.toLocaleString('ru-RU')} ₽`}
                </div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Оценка остатка</div>
                <div className="ui-detail-value">
                  {item.currentEstimatedTotalValue.toLocaleString('ru-RU')} ₽
                </div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Создал</div>
                <div className="ui-detail-value">
                  {getUserDisplayName(item.createdBy)}
                </div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Создано</div>
                <div className="ui-detail-value">
                  {new Date(item.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="ui-detail-field">
                <div className="ui-detail-label">Изменено</div>
                <div className="ui-detail-value">
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

            <div className="ui-detail-field">
              <div className="ui-detail-label">Примечание</div>
              <div className="ui-detail-value">{item.notes || 'Не указано'}</div>
            </div>
          </Surface>

          {isEditing && item.isActive && item.capabilities.canEditCatalog ? (
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

          {item.capabilities.canEditCatalog || item.capabilities.canDelete ? (
            <Surface padding="md" style={{ display: 'grid', gap: 12 }}>
              <div className="ui-section-header">
                <div>
                  <div className="ui-section-title">Управление карточкой</div>
                  <div className="ui-text-muted">
                    {item.isActive
                      ? 'Удаление доступно только при нулевом остатке и без незавершённых операций.'
                      : item.deletedAt
                        ? `Удалена ${new Date(item.deletedAt).toLocaleString('ru-RU')}. История движений сохранена.`
                        : 'Позиция недоступна для новых складских операций.'}
                  </div>
                </div>
                {item.isActive ? (
                  item.capabilities.canDelete ? (
                    <Button variant="danger"
                      onClick={() => setIsDeleteConfirmationOpen(true)}
                    >
                      Удалить
                    </Button>
                  ) : null
                ) : (
                  item.capabilities.canDelete ? (
                    <Button
                      disabled={isItemActionPending}
                      onClick={() => void handleRestore()}
                    >
                      {isItemActionPending ? 'Восстанавливаем...' : 'Восстановить'}
                    </Button>
                  ) : null
                )}
              </div>

              {isDeleteConfirmationOpen && item.isActive ? (
                <Alert tone="warning">
                  <strong>Удалить «{item.name}»?</strong>
                  {item.deletionState.mode === 'hard' ? (
                    <div>
                      Карточка ещё не использовалась и будет удалена безвозвратно.
                    </div>
                  ) : (
                    <div>
                      Позиция исчезнет из рабочего каталога. История из{' '}
                      {item.summary.movementsCount} движений сохранится.
                    </div>
                  )}
                  <div>
                    Остаток: {formatInventoryQuantity(item.currentStock, item.unit)}
                  </div>
                  {item.deletionState.blockerCodes.map((code) => (
                    <div key={code}>{getDeleteBlockerLabel(code)}</div>
                  ))}
                  <div className="ui-inline">
                    <Button variant="danger"
                      disabled={!item.deletionState.canDelete || isItemActionPending}
                      onClick={() => void handleDelete()}
                    >
                      {isItemActionPending ? 'Удаляем...' : 'Удалить'}
                    </Button>
                    <Button
                      onClick={() => setIsDeleteConfirmationOpen(false)}
                      disabled={isItemActionPending}
                    >
                      Отмена
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {item.isActive && item.deletionState.blockerCodes.length > 0 ? (
                <div className="ui-text-muted">
                  Удаление сейчас недоступно: {' '}
                  {item.deletionState.blockerCodes
                    .map((code) => getDeleteBlockerLabel(code))
                    .join(' ')}
                </div>
              ) : null}

              {itemActionError ? (
                <div className="form-error">
                  {itemActionError}{' '}
                  <Button

                    onClick={() => {
                      void getInventoryItemById(item.id).then(setItem);
                    }}
                  >
                    Загрузить актуальные данные
                  </Button>
                </div>
              ) : null}
            </Surface>
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
                const updatedItem = await getInventoryItemById(item.id);
                setItem(updatedItem);
                setMovementPage(1);
                setMovementReloadKey((value) => value + 1);
              }}
            />
          ) : null}

          {canViewMovementHistory ? (
            <>
              <Surface padding="md" style={{ display: 'grid', gap: 14 }}>
                <div className="ui-section-header">
                  <div>
                    <div className="ui-section-title">История движений</div>
                    <div className="ui-text-muted">Найдено записей: {movementTotal}</div>
                  </div>
                </div>
                <div className="ui-detail-grid">
                  <label>
                    <div className="ui-detail-label">Тип</div>
                    <Select
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
                    </Select>
                  </label>
                  <label>
                    <div className="ui-detail-label">Статус</div>
                    <Select
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
                    </Select>
                  </label>
                  <label>
                    <div className="ui-detail-label">Объект</div>
                    <Select
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
                    </Select>
                  </label>
                  <label>
                    <div className="ui-detail-label">Разовый заказ</div>
                    <Select
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
                    </Select>
                  </label>
                  <label>
                    <div className="ui-detail-label">С даты</div>
                    <DatePicker value={dateFrom} onChange={(nextValue) => {
                        setDateFrom(nextValue);
                        setMovementPage(1);
                      }} />
                  </label>
                  <label>
                    <div className="ui-detail-label">По дату</div>
                    <DatePicker value={dateTo} onChange={(nextValue) => {
                        setDateTo(nextValue);
                        setMovementPage(1);
                      }} />
                  </label>
                </div>
              </Surface>

              {isMovementsLoading ? (
                <Surface padding="md">Загрузка истории...</Surface>
              ) : movementError ? (
                <Surface padding="md" className="form-error">{movementError}</Surface>
              ) : (
                <InventoryMovementList items={movements} />
              )}

              {!isMovementsLoading && !movementError ? <TablePagination page={movementPage} totalPages={movementTotalPages} pending={isMovementsLoading} label="Страницы истории движений"
                summary={movementTotal > 0 ? `Показано ${(movementPage - 1) * 20 + 1}–${Math.min(movementPage * 20, movementTotal)} из ${movementTotal}` : 'Движения не найдены'}
                onPageChange={setMovementPage} /> : null}
            </>
          ) : null}
        </div>
      ) : (
        <Surface padding="md">Расходник не найден.</Surface>
      )}
    </div>
  );
}
