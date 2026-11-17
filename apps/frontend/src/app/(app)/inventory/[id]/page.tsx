'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccessSessionGeneration } from '@/shared/auth/access-generation';
import { ApiError } from '@/shared/api/fetcher';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

import { uploadFileToEntity, uploadFileToEntityAcknowledged } from '@/entities/file/api/file-client';
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
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, BackLink, Button, FactStrip, LoadingState, StatusBadge, Surface } from '@/shared/ui/foundation';
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
  const accessRevision = useAccessRevision();
  const { user } = useAuth();
  const [photoAcknowledgement, setPhotoAcknowledgement] = useState<{ params: typeof params; actorId: string | undefined; session: number; terminal: boolean } | null>(null);
  const photoContext = { params, actorId: user?.id, session: getAccessSessionGeneration() };
  const latestPhotoContext = useRef(photoContext);
  latestPhotoContext.current = photoContext;
  const photoContextIsCurrent = (): boolean => !!photoContext.actorId && latestPhotoContext.current.params === params && latestPhotoContext.current.actorId === photoContext.actorId && latestPhotoContext.current.session === photoContext.session && getAccessSessionGeneration() === photoContext.session;
  const acknowledgePhoto = (terminal: boolean): void => {
    if (!photoContextIsCurrent()) return;
    setPhotoAcknowledgement((previous) => previous?.params === params && previous.actorId === photoContext.actorId && previous.session === photoContext.session && previous.terminal
      ? previous : { ...photoContext, terminal });
  };
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [accessRetry, setAccessRetry] = useState(0);
  const router = useRouter();
  const [itemId, setItemId] = useState<string | null>(null);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [savedReceipt, setSavedReceipt] = useState<{ params: typeof params; hasPendingFiles: boolean } | null>(null);
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
  const [directEdit, setDirectEdit] = useState(false);
  const [confirmation, setConfirmation] = useState<{ action: 'delete' | 'restore'; revision: string | null; version: number } | null>(null);
  const [savedCatalogAction, setSavedCatalogAction] = useState<{ params: typeof params; title: string } | null>(null);
  const confirmedAction = confirmation && confirmation.revision === loadedAccessRevision && loadedAccessRevision === accessRevision
    ? confirmation.action
    : null;
  useOpenAccessRefresh(Boolean(item));
  const [isItemActionPending, setIsItemActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [referencesError, setReferencesError] = useState(false);
  const [itemActionError, setItemActionError] = useState<string | null>(null);
  const canCreateMovement =
    (item?.isActive ?? false) && (item?.capabilities.canCreateMovement ?? false);
  const canViewMovementHistory = item?.capabilities.canViewMovements ?? false;

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
    setError(null);

    void getInventoryItemById(itemId)
      .then((loadedItem) => {
        if (!cancelled) {
          setItem(loadedItem);
          setLoadedAccessRevision(accessRevision);
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
  }, [itemId, accessRevision, accessRetry]);

  useEffect(() => {
    if (!canCreateMovement) {
      setReferencesError(false);
      setObjectOptions([]);
      setOneTimeOrderOptions([]);
      return;
    }

    let cancelled = false;
    setReferencesError(false);
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
          setReferencesError(true);
          setObjectOptions([]);
          setOneTimeOrderOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canCreateMovement, accessRevision]);

  useEffect(() => {
    setDirectEdit(window.location.hash === '#edit');
  }, [params]);

  useEffect(() => {
    if (directEdit && item?.capabilities.canEditCatalog) {
      setIsEditing(true);
    }
  }, [directEdit, item?.capabilities.canEditCatalog]);

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
    accessRevision,
  ]);

  const handleRestore = async (): Promise<void> => {
    if (confirmedAction !== 'restore' || !confirmation || !item || !(item.capabilities.canRestore ?? item.capabilities.canDelete) || isItemActionPending) {
      return;
    }

    setIsItemActionPending(true);
    setItemActionError(null);

    try {
      const restored = await restoreInventoryItem(item.id, confirmation.version);
      if (isSavedWithoutAccess(restored)) {
        showSavedCatalogAction('Позиция восстановлена');
        return;
      }
      setItem(restored);
      setConfirmation(null);
    } catch (actionError) {
      setItemActionError(
        getErrorMessage(actionError, 'Не удалось восстановить позицию.'),
      );
    } finally {
      setIsItemActionPending(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (confirmedAction !== 'delete' || !confirmation || !item?.capabilities.canDelete || !item.deletionState.canDelete || isItemActionPending) {
      return;
    }

    setIsItemActionPending(true);
    setItemActionError(null);

    try {
      const result = await deleteInventoryItem(item.id, confirmation.version);
      if (isSavedWithoutAccess(result)) {
        showSavedCatalogAction('Позиция удалена');
        return;
      }
      if (result.mode === 'hard') {
        router.push('/inventory');
        router.refresh();
        return;
      }

      const updated = await getInventoryItemById(item.id).catch((loadError: unknown) => {
        if (loadError instanceof ApiError &&
          ([403, 404].includes(loadError.statusCode) || loadError.code === 'ACCESS_VERSION_CHANGED')) return null;
        throw loadError;
      });
      if (!updated) {
        showSavedCatalogAction('Позиция удалена');
        return;
      }
      setItem(updated);
      setConfirmation(null);
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.code === 'INVENTORY_ITEM_VERSION_CONFLICT') setConfirmation(null);
      setItemActionError(
        getErrorMessage(actionError, 'Не удалось удалить позицию.'),
      );
    } finally {
      setIsItemActionPending(false);
    }
  };

  function showSavedCatalogAction(title: string): void {
    setSavedCatalogAction({ params, title });
    setConfirmation(null);
    setIsEditing(false);
  }

  const visiblePhotoAcknowledgement = photoAcknowledgement?.params === params && photoAcknowledgement.actorId === user?.id && photoAcknowledgement.session === getAccessSessionGeneration();
  if (visiblePhotoAcknowledgement && photoAcknowledgement?.terminal) return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <BackLink href="/inventory">К списку расходников</BackLink>
      <Alert tone="success" role="status" title="Фото прикреплено">Доступ к записи изменился. Повторная загрузка не требуется.</Alert>
    </div>
  );

  if (savedCatalogAction?.params === params) return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <BackLink href="/inventory">К списку расходников</BackLink>
      <Alert tone="success" role="status" title={savedCatalogAction.title}>
        Доступ к карточке изменился.
      </Alert>
    </div>
  );

  if (savedReceipt?.params === params) return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <BackLink href="/inventory">К списку расходников</BackLink>
      <Alert tone="success" role="status" title="Приход записан">
        Доступ к позиции изменился.
        {savedReceipt.hasPendingFiles ? ' Выбранные файлы не прикрепились.' : ''}
      </Alert>
    </div>
  );

  return (
    <div className={`ui-page ${inventoryStyles.inventoryWorkspace}`}>
      <BackLink href="/inventory">Расходники</BackLink>
      {visiblePhotoAcknowledgement ? <Alert tone="success" role="status" title="Фото прикреплено">Повторная загрузка не требуется.</Alert> : null}
      {loadedAccessRevision !== accessRevision && !error ? <LoadingState label="Проверка доступа к расходнику…" /> : null}
      {error ? <Alert tone="danger" action={<Button onClick={() => setAccessRetry((value) => value + 1)}>Повторить проверку доступа</Button>}>{error}</Alert> : null}
      <AccessSnapshotBoundary blocked={Boolean(error) || loadedAccessRevision !== accessRevision}>

      {isLoading ? (
        <LoadingState label="Загружаем позицию…" />
      ) : item ? (
        <div className="ui-stack ui-stack--lg">
          <Surface padding="md" className="hero-card ui-stack ui-stack--lg">
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

            {item.summary ? <FactStrip
              aria-label="Движения по позиции"
              items={[
                { key: 'all', label: 'Все движения', value: item.summary.movementsCount },
                { key: 'receipts', label: 'Приходы', value: item.summary.receiptsCount },
                { key: 'issues', label: 'Выдачи', value: item.summary.issuesCount },
                { key: 'returns', label: 'Возвраты', value: item.summary.returnsCount },
                { key: 'writeoffs', label: 'Списания', value: item.summary.writeoffsCount },
                { key: 'adjustments', label: 'Корректировки', value: item.summary.adjustmentsCount },
              ]}
            /> : null}

            <div className="ui-detail-field">
              <div className="ui-detail-label">Примечание</div>
              <div className="ui-detail-value">{item.notes || 'Не указано'}</div>
            </div>
          </Surface>

          {directEdit && !isEditing && item.isActive && !item.capabilities.canEditCatalog ? (
            <Alert tone="warning" role="status">У вас нет права редактировать позицию.</Alert>
          ) : null}

          {confirmation?.action === 'delete' && !item.capabilities.canDelete ? (
            <Alert tone="warning" role="status">У вас больше нет права удалить эту позицию.</Alert>
          ) : null}
          {confirmation?.action === 'restore' && !(item.capabilities.canRestore ?? item.capabilities.canDelete) ? (
            <Alert tone="warning" role="status">У вас больше нет права восстановить эту позицию.</Alert>
          ) : null}

          {isEditing && item.isActive ? (
            <InventoryItemEditor
              key={`${item.id}:${item.version}`}
              item={item}
              canSave={item.capabilities.canEditCatalog && loadedAccessRevision === accessRevision && !error}
              onSaved={(updated) => {
                if (isSavedWithoutAccess(updated)) {
                  showSavedCatalogAction('Изменения сохранены');
                  return;
                }
                setItem(updated);
                setItemActionError(null);
              }}
              onClose={() => setIsEditing(false)}
            />
          ) : null}

          {item.capabilities.canEditCatalog || item.capabilities.canDelete || (item.capabilities.canRestore ?? item.capabilities.canDelete) ? (
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
                      onClick={() => setConfirmation({ action: 'delete', revision: loadedAccessRevision, version: item.version })}
                    >
                      Удалить
                    </Button>
                  ) : null
                ) : (
                  (item.capabilities.canRestore ?? item.capabilities.canDelete) ? (
                    <Button
                      disabled={isItemActionPending}
                      onClick={() => setConfirmation({ action: 'restore', revision: loadedAccessRevision, version: item.version })}
                    >
                      {isItemActionPending ? 'Восстанавливаем...' : 'Восстановить'}
                    </Button>
                  ) : null
                )}
              </div>

              {confirmedAction === 'delete' && item.isActive && item.capabilities.canDelete ? (
                <Alert tone="warning">
                  <strong>Удалить «{item.name}»?</strong>
                  {item.deletionState.mode === 'hard' ? (
                    <div>
                      Карточка ещё не использовалась и будет удалена безвозвратно.
                    </div>
                  ) : (
                    <div>
                      Позиция исчезнет из рабочего каталога. История движений сохранится.
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
                      onClick={() => setConfirmation(null)}
                      disabled={isItemActionPending}
                    >
                      Отмена
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {confirmedAction === 'restore' && !item.isActive && (item.capabilities.canRestore ?? item.capabilities.canDelete) ? (
                <Alert tone="warning">
                  <strong>Восстановить «{item.name}»?</strong>
                  <div className="ui-inline">
                    <Button variant="primary" disabled={isItemActionPending} onClick={() => void handleRestore()}>
                      Восстановить позицию
                    </Button>
                    <Button disabled={isItemActionPending} onClick={() => setConfirmation(null)}>Отмена</Button>
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

          {referencesError ? <Alert tone="warning" role="alert">Списки объектов и заказов не загрузились. Обновите страницу перед выбором назначения движения.</Alert> : null}

          {item.isActive ? <AccessSnapshotBoundary blocked={!item.capabilities.canCreateMovement}>
            <InventoryMovementForm
              key={item.id}
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
              onSavedWithoutAccess={(hasPendingFiles) => setSavedReceipt({ params, hasPendingFiles })}
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
          </AccessSnapshotBoundary> : null}

          {canViewMovementHistory ? (
            <>
              <Surface padding="md" style={{ display: 'grid', gap: 14 }}>
                <div className="ui-section-header">
                  <div>
                    <div className="ui-section-title">История движений</div>
                    <div className="ui-text-muted">{isMovementsLoading ? 'Обновляем историю…' : `Найдено записей: ${movementTotal}`}</div>
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
                <Alert tone="danger" role="alert">{movementError}</Alert>
              ) : (
                <InventoryMovementList
                  items={movements}
                  onAttachStandalonePhoto={async (movementId, file) => {
                    if (!photoContextIsCurrent()) throw new ApiError('Сессия или страница изменились. Обновите данные.', 409, 'ACCESS_VERSION_CHANGED');
                    setPhotoAcknowledgement(null);
                    const result = await uploadFileToEntityAcknowledged({ entityType: 'inventory_movement', entityId: movementId, file });
                    if (isSavedWithoutAccess(result)) acknowledgePhoto(true);
                  }}
                  onPhotoAcknowledgedWithoutView={() => acknowledgePhoto(false)}
                  onRefresh={async () => { setMovementReloadKey((value) => value + 1); }}
                />
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
      </AccessSnapshotBoundary>
    </div>
  );
}
