'use client';

import { PlusIcon } from '@/shared/ui/icons/icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  CreateInventoryMovementPayload,
  InventoryItem,
  InventoryMovementWriteResult,
  InventoryObjectReference,
  InventoryOneTimeOrderReference,
} from '@/entities/inventory/model/inventory.types';
import { getInventoryItemById, listInventoryObjectReferenceOptions } from '@/entities/inventory/api/inventory-client';
import { INVENTORY_MOVEMENT_TYPE_OPTIONS } from '@/shared/lib/inventory-presentation';
import { ApiError } from '@/shared/api/fetcher';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, Button, Field, Stack, Surface } from '@/shared/ui/foundation';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { itemAllowsMovement, strictMovementError, strictTypeAvailable, type StrictMovementScope, type MovementLine } from '../model/strict-scope';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

type RelationScope = 'object' | 'one_time_order' | 'none';

export function InventoryMovementForm({
  items,
  objectOptions,
  oneTimeOrderOptions,
  canCreateMovement,
  canCreateReceipt,
  canIssueToObject,
  canIssueToOneTimeOrder,
  canReturn,
  canWriteoff,
  canAdjust,
  defaultInventoryItemId,
  strictScope = false,
  scopeReady = true,
  onSelectedItemIdsChange,
  onSubmit,
  onAttachEvidence,
  onRefresh,
  onSavedWithoutAccess,
}: {
  items: InventoryItem[];
  objectOptions: InventoryObjectReference[];
  oneTimeOrderOptions: InventoryOneTimeOrderReference[];
  canCreateMovement: boolean;
  canCreateReceipt: boolean;
  canIssueToObject: boolean;
  canIssueToOneTimeOrder: boolean;
  canReturn: boolean;
  canWriteoff: boolean;
  canAdjust: boolean;
  defaultInventoryItemId?: string;
  strictScope?: boolean;
  scopeReady?: boolean;
  onSelectedItemIdsChange?: (ids: string[]) => void;
  onSubmit: (params: {
    payload: CreateInventoryMovementPayload;
    evidenceFiles: File[];
  }) => Promise<InventoryMovementWriteResult>;
  onSavedWithoutAccess?: (hasPendingFiles: boolean) => void;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const movementOptions = useMemo(
    () =>
      INVENTORY_MOVEMENT_TYPE_OPTIONS.filter((option) => {
        if (strictScope) return strictTypeAvailable({
          ready: scopeReady, items, objects: objectOptions, orders: oneTimeOrderOptions,
          movementType: 'receipt', relationScope: 'none', objectId: '', orderId: '',
        }, option.value);
        switch (option.value) {
          case 'receipt':
            return canCreateReceipt;
          case 'issue_to_object':
            return canIssueToObject;
          case 'issue_to_one_time_order':
            return canIssueToOneTimeOrder;
          case 'writeoff':
            return canWriteoff;
          case 'adjustment':
            return canAdjust;
          case 'return':
            return canReturn;
        }
      }),
    [
      canAdjust,
      canCreateMovement,
      canCreateReceipt,
      canIssueToObject,
      canIssueToOneTimeOrder,
      canReturn,
      canWriteoff,
      strictScope, scopeReady, items, objectOptions, oneTimeOrderOptions,
    ],
  );
  const initialMovementType = movementOptions[0]?.value ?? 'receipt';

  const [inventoryItemId, setInventoryItemId] = useState(
    defaultInventoryItemId ?? items[0]?.id ?? '',
  );
  const [movementType, setMovementType] = useState(initialMovementType);
  const [quantity, setQuantity] = useState('1');
  const [savedWithoutAccess, setSavedWithoutAccess] = useState<{ hasPendingFiles: boolean } | null>(null);
  const [unitPrice, setUnitPrice] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<
    'increase' | 'decrease'
  >('increase');
  const [relationScope, setRelationScope] = useState<RelationScope>('object');
  const [relatedObjectId, setRelatedObjectId] = useState('');
  const [relatedOneTimeOrderId, setRelatedOneTimeOrderId] = useState('');
  const [comment, setComment] = useState('');
  const [evidenceRequired, setEvidenceRequired] = useState(() =>
    movementType === 'issue_to_object' ||
    movementType === 'issue_to_one_time_order' ||
    movementType === 'writeoff',
  );
  const [pendingEvidence, setPendingEvidence] = useState<File[]>([]);
  const [issueLines, setIssueLines] = useState<Array<{ key: string; inventoryItemId: string; quantity: string; movementId?: string }>>([
    { key: 'initial', inventoryItemId: defaultInventoryItemId ?? items[0]?.id ?? '', quantity: '1' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [accessDenial, setAccessDenial] = useState<string | null>(null);
  const [accessCheckError, setAccessCheckError] = useState<string | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [accessRestored, setAccessRestored] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [singleMovementId, setSingleMovementId] = useState<string | undefined>();
  const submitLock = useRef(false);
  useEffect(() => { if (strictScope && scopeReady) setError(null); }, [strictScope, scopeReady]);

  const supportsObjectRelation =
    movementType === 'issue_to_object' ||
    movementType === 'return' ||
    movementType === 'writeoff';
  const supportsOrderRelation =
    movementType === 'issue_to_one_time_order' ||
    movementType === 'return' ||
    movementType === 'writeoff';
  const selectedItem = items.find((item) => item.id === inventoryItemId) ?? null;
  const isEvidenceMandatory =
    movementType === 'issue_to_object' ||
    movementType === 'issue_to_one_time_order' ||
    movementType === 'writeoff' ||
    (movementType === 'adjustment' && adjustmentDirection === 'decrease');
  const supportsMultipleItems = ['issue_to_object', 'issue_to_one_time_order', 'writeoff'].includes(movementType);
  const selectionKey = JSON.stringify([...new Set(supportsMultipleItems ? issueLines.map((line) => line.inventoryItemId).filter(Boolean) : [inventoryItemId].filter(Boolean))].sort());
  useEffect(() => { onSelectedItemIdsChange?.(JSON.parse(selectionKey) as string[]); }, [selectionKey, onSelectedItemIdsChange]);
  const scope: StrictMovementScope = {
    ready: scopeReady, items, objects: objectOptions, orders: oneTimeOrderOptions,
    movementType, relationScope, objectId: relatedObjectId, orderId: relatedOneTimeOrderId,
  };
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const lines = supportsMultipleItems ? issueLines : [{ inventoryItemId, quantity, movementId: singleMovementId }];
  const scopeError = strictScope ? strictMovementError(scope, lines) : null;
  const hasCreatedRows = Boolean(singleMovementId) || issueLines.some((line) => Boolean(line.movementId));
  const fieldsLocked = isSaving || isCheckingAccess || hasCreatedRows;
  const canCheckObjectIssue = strictScope && movementType === 'issue_to_object';
  const canCheckAccess = movementType === 'receipt' || canCheckObjectIssue;

  const checkMovementAccess = async (): Promise<void> => {
    if (isCheckingAccess || !accessDenial || !canCheckAccess) return;
    setIsCheckingAccess(true);
    setAccessCheckError(null);
    const unavailable = 'Доступ пока закрыт. Черновик остался в форме.';
    try {
      if (canCheckObjectIssue) {
        const pending = lines.filter((line) => !line.movementId);
        if (!pending.length || !scope.objectId || pending.some((line) => !line.inventoryItemId)) {
          setAccessCheckError('Выберите объект и расходники для оставшихся позиций.');
          return;
        }
        const [freshItems, freshObjects] = await Promise.all([
          Promise.all(pending.map((line) => getInventoryItemById(line.inventoryItemId))),
          listInventoryObjectReferenceOptions(),
        ]);
        const denial = strictMovementError({ ...scope, ready: true, items: freshItems, objects: freshObjects }, pending);
        if (denial) {
          setAccessCheckError(denial);
          return;
        }
        // Refresh the registry snapshots used by the submit guard as well.
        await onRefresh();
      } else {
        if (!inventoryItemId || !itemAllowsMovement(await getInventoryItemById(inventoryItemId), 'receipt')) {
          setAccessCheckError(unavailable);
          return;
        }
      }
      setAccessDenial(null);
      setAccessRestored(true);
    } catch (cause) {
      setAccessCheckError(cause instanceof ApiError && [403, 404].includes(cause.statusCode)
        ? unavailable
        : 'Не удалось проверить доступ. Черновик остался в форме. Повторите проверку.');
    } finally {
      setIsCheckingAccess(false);
    }
  };

  const addIssueLine = (): void => {
    const selected = new Set(issueLines.map((line) => line.inventoryItemId));
    const next = items.find((item) => !selected.has(item.id));
    if (!next) return;
    setIssueLines((current) => [...current, {
      key: `${Date.now()}-${current.length}`,
      inventoryItemId: next.id,
      quantity: '1',
    }]);
  };

  if (savedWithoutAccess) return (
    <Alert tone="success" title="Движение записано" role="status">
      Доступ к позиции изменился.
      {savedWithoutAccess.hasPendingFiles ? ' Выбранные файлы не прикрепились.' : ''}
    </Alert>
  );

  return (
    <form
      className="ui-surface ui-surface--padded"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitLock.current || isSaving || isCheckingAccess || accessDenial || (strictScope ? scopeError !== null : !canCreateMovement)) return;
        submitLock.current = true;
        const accessGeneration = getAccessGeneration();
        setIsSaving(true);
        setError(null);
        setAccessRestored(false);
        void (async () => {
          let completed = 0;
          let creatingMovement = false;
          let attachingEvidence = false;
          try {
            const checkNewPost = (pendingLines: MovementLine[]): void => {
              if (!strictScope) return;
              if (!isAccessGenerationCurrent(accessGeneration)) throw new Error('Права изменились. Черновик сохранён; дождитесь повторной проверки.');
              const denial = strictMovementError(currentScope.current, pendingLines);
              if (denial) throw new Error(denial);
            };
            checkNewPost(lines); // Validate the entire pending batch before its first write.
            const basePayload = {
              movementType: movementType as CreateInventoryMovementPayload['movementType'],
              ...(movementType === 'receipt' ? { unitPrice: Number(unitPrice) } : {}),
              ...(movementType === 'adjustment' ? { adjustmentDirection } : {}),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
              evidenceRequired: isEvidenceMandatory || evidenceRequired,
              ...(movementType === 'issue_to_object' || (movementType !== 'adjustment' && movementType !== 'receipt' && relationScope === 'object' && relatedObjectId) ? { relatedObjectId } : {}),
              ...(movementType === 'issue_to_one_time_order' || (movementType !== 'adjustment' && movementType !== 'receipt' && relationScope === 'one_time_order' && relatedOneTimeOrderId) ? { relatedOneTimeOrderId } : {}),
            };

            const confirmSavedWithoutAccess = (): void => {
              const hasPendingFiles = pendingEvidence.length > 0;
              setSavedWithoutAccess({ hasPendingFiles });
              onSavedWithoutAccess?.(hasPendingFiles);
            };

            if (supportsMultipleItems) {
              for (const line of issueLines) {
                let movementId = line.movementId;
                if (!movementId) {
                  checkNewPost([line]);
                  creatingMovement = true;
                  const created = await onSubmit({
                    payload: { ...basePayload, inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity) },
                    evidenceFiles: [],
                  });
                  creatingMovement = false;
                  if ('outcome' in created) {
                    confirmSavedWithoutAccess();
                    return;
                  }
                  movementId = created.id;
                  setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, movementId } : entry));
                }
                if (pendingEvidence.length) {
                  attachingEvidence = true;
                  await onAttachEvidence(movementId, pendingEvidence);
                  attachingEvidence = false;
                }
                setIssueLines((current) => current.filter((entry) => entry.key !== line.key));
                completed += 1;
              }
              setIssueLines([{ key: `${Date.now()}-next`, inventoryItemId: items[0]?.id ?? '', quantity: '1' }]);
            } else {
              let movementId = singleMovementId;
              if (!movementId) {
                checkNewPost([{ inventoryItemId, quantity }]);
                creatingMovement = true;
                const created = await onSubmit({
                  payload: { ...basePayload, inventoryItemId, quantity: Number(quantity) }, evidenceFiles: [],
                });
                creatingMovement = false;
                if ('outcome' in created) {
                  confirmSavedWithoutAccess();
                  return;
                }
                movementId = created.id;
                setSingleMovementId(movementId);
              }
              if (pendingEvidence.length) {
                attachingEvidence = true;
                await onAttachEvidence(movementId, pendingEvidence);
                attachingEvidence = false;
              }
              setSingleMovementId(undefined);
              setQuantity('1');
              setUnitPrice('');
            }

            setComment('');
            setPendingEvidence([]);
            await onRefresh();
          } catch (submitError) {
            if (attachingEvidence && submitError instanceof ApiError && [403, 404].includes(submitError.statusCode)) {
              setError('Движение уже записано. Прикрепить файлы к нему не удалось из-за ограничений доступа. Выбранные файлы остались в форме.');
              return;
            }
            if (creatingMovement && submitError instanceof ApiError && submitError.statusCode === 403) {
              const reason = movementType === 'receipt'
                ? 'Недостаточно прав, чтобы оформить приход на склад.'
                : 'Недостаточно прав, чтобы создать движение по выбранным данным.';
              const draft = 'Введённые данные остались в форме. Уточните доступ у учредителя.';
              setAccessDenial(completed > 0 ? `Создано движений: ${completed}. ${reason} ${draft}` : `${reason} ${draft}`);
              return;
            }
            setError(completed > 0
              ? `Создано движений: ${completed}. Оставшиеся позиции не потеряны в форме. ${getErrorMessage(submitError, 'Не удалось завершить операцию.')}`
              : getErrorMessage(submitError, 'Не удалось создать движение.'));
          } finally {
            submitLock.current = false;
            setIsSaving(false);
          }
        })();
      }}
    >
      <div style={{ fontWeight: 600 }}>Новое движение</div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        }}
      >
        {supportsMultipleItems ? (
          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>
            {issueLines.map((line, index) => {
              const selectedLineItem = items.find((item) => item.id === line.inventoryItemId);
              return (
                <Surface padding="sm" key={line.key} style={{ display: 'grid', gap: 10 }}>
                  <div className="ui-section-header">
                    <strong>Позиция {index + 1}{line.movementId ? ' · движение создано, ожидает подтверждения' : ''}</strong>
                    {!line.movementId && issueLines.length > 1 ? <Button disabled={isSaving || isCheckingAccess} onClick={() => setIssueLines((current) => current.filter((entry) => entry.key !== line.key))}>Убрать</Button> : null}
                  </div>
                  {line.movementId ? <div className="ui-text-muted">Операция уже записана. Повторная отправка не создаст дубликат.</div> : (
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
                      <Field label="Номенклатура">
                        <Select value={line.inventoryItemId} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, inventoryItemId: event.target.value } : entry))} required disabled={isSaving || isCheckingAccess}>
                          {!items.some((item) => item.id === line.inventoryItemId) ? <option value={line.inventoryItemId}>{line.inventoryItemId ? 'Выбранная позиция недоступна' : 'Выберите позицию'}</option> : null}
                          {items.filter((item) => item.id === line.inventoryItemId || !issueLines.some((other) => other.key !== line.key && other.inventoryItemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}
                        </Select>
                      </Field>
                      <Field label="Количество">
                        <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} required disabled={isSaving || isCheckingAccess || Boolean(line.movementId)} />
                      </Field>
                      <div><div className="ui-text-muted">Цена</div><div>{selectedLineItem?.currentUnitPrice == null ? 'Не указана' : `${selectedLineItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedLineItem.unit}`}</div></div>
                    </div>
                  )}
                </Surface>
              );
            })}
            {items.some((item) => !issueLines.some((line) => line.inventoryItemId === item.id)) ? <Button onClick={addIssueLine} disabled={isSaving || isCheckingAccess} icon={<PlusIcon />}>Добавить позицию</Button> : null}
            <div className="ui-text-muted">Каждая позиция будет проведена отдельным движением с собственной проверкой остатка и историей.</div>
          </div>
        ) : <Field label="Номенклатура">
   <Select
            value={inventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
            disabled={fieldsLocked}
            required
          >
            {!items.some((item) => item.id === inventoryItemId) ? <option value={inventoryItemId}>{inventoryItemId ? 'Выбранная позиция недоступна' : 'Выберите позицию'}</option> : null}
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} • {item.category}
              </option>
            ))}
          </Select>
 </Field>}

        <Field label="Тип движения">
          <Select
            value={movementType}
            disabled={fieldsLocked}
            onChange={(event) => {
              const nextType =
                event.target.value as CreateInventoryMovementPayload['movementType'];
              setMovementType(nextType);
              setEvidenceRequired(
                nextType === 'issue_to_object' ||
                  nextType === 'issue_to_one_time_order' ||
                  nextType === 'writeoff',
              );
              if (nextType === 'issue_to_object') {
                setRelationScope('object');
              } else if (nextType === 'issue_to_one_time_order') {
                setRelationScope('one_time_order');
              } else if (nextType === 'adjustment' || nextType === 'receipt') {
                setRelationScope('none');
              }
            }}
          >
            {!movementOptions.some((option) => option.value === movementType) ? <option value={movementType} disabled>{INVENTORY_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === movementType)?.label} · недоступно</option> : null}
            {movementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {!supportsMultipleItems ? <Field label="Количество">
   <input
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            disabled={fieldsLocked}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
 </Field> : null}

        {movementType === 'receipt' ? (
          <Field label="Цена за единицу">
            <input
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              disabled={fieldsLocked}
              onChange={(event) => setUnitPrice(event.target.value)}
              required
            />
          </Field>
        ) : (
          <div>
            <div className="ui-text-muted">
              Максимальная цена применённых приходов
            </div>
            <div>
              {selectedItem?.currentUnitPrice === null ||
              selectedItem?.currentUnitPrice === undefined
                ? 'Сначала нужен приход с ценой'
                : `${selectedItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedItem.unit}`}
            </div>
          </div>
        )}
      </div>

      {movementType === 'adjustment' ? (
        <Field label="Направление корректировки">
          <Select
            value={adjustmentDirection}
            disabled={fieldsLocked}
            onChange={(event) =>
              setAdjustmentDirection(
                event.target.value as 'increase' | 'decrease',
              )
            }
          >
            <option value="increase">Увеличить остаток</option>
            <option value="decrease">Уменьшить остаток</option>
          </Select>
        </Field>
      ) : null}

      {supportsObjectRelation || supportsOrderRelation ? (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          }}
        >
          {movementType === 'return' || movementType === 'writeoff' ? (
            <Field label="Связанный контур">
              <Select
                value={relationScope}
                disabled={fieldsLocked}
                onChange={(event) =>
                  setRelationScope(event.target.value as RelationScope)
                }
              >
                {supportsObjectRelation ? (
                  <option value="object">Объект</option>
                ) : null}
                {supportsOrderRelation ? (
                  <option value="one_time_order">Разовый заказ</option>
                ) : null}
                {movementType === 'writeoff' ? (
                  <option value="none">Без связанного контура</option>
                ) : null}
              </Select>
            </Field>
          ) : null}

          {(movementType === 'issue_to_object' ||
            relationScope === 'object') && supportsObjectRelation ? (
            <Field label="Объект">
              <Select
                value={relatedObjectId}
                disabled={fieldsLocked}
                onChange={(event) => setRelatedObjectId(event.target.value)}
                required={movementType === 'issue_to_object' || movementType === 'return'}
              >
                <option value="">Выберите объект</option>
                {relatedObjectId && !objectOptions.some((item) => item.id === relatedObjectId) ? <option value={relatedObjectId}>Выбранный объект недоступен</option> : null}
                {objectOptions.map((item) => (
                  <option key={item.id} value={item.id} disabled={strictScope && movementType === 'issue_to_object' && item.capabilities?.canIssueToObject !== true}>
                    {item.name} • {item.status}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {(movementType === 'issue_to_one_time_order' ||
            relationScope === 'one_time_order') && supportsOrderRelation ? (
            <Field label="Разовый заказ">
              <Select
                value={relatedOneTimeOrderId}
                disabled={fieldsLocked}
                onChange={(event) => setRelatedOneTimeOrderId(event.target.value)}
                required={
                  movementType === 'issue_to_one_time_order' ||
                  movementType === 'return'
                }
              >
                <option value="">Выберите заказ</option>
                {relatedOneTimeOrderId && !oneTimeOrderOptions.some((item) => item.id === relatedOneTimeOrderId) ? <option value={relatedOneTimeOrderId}>Выбранный заказ недоступен</option> : null}
                {oneTimeOrderOptions.map((item) => (
                  <option key={item.id} value={item.id} disabled={strictScope && (movementType === 'issue_to_one_time_order' ? item.capabilities?.canIssueToOneTimeOrder !== true : item.capabilities?.canLinkMovement !== true)}>
                    {item.title} • {item.status}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}

      <Field label="Комментарий">
        <textarea
          value={comment}
          disabled={fieldsLocked}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
        />
      </Field>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isEvidenceMandatory || evidenceRequired}
          disabled={isEvidenceMandatory}
          onChange={(event) => setEvidenceRequired(event.target.checked)}
        />
        {isEvidenceMandatory
          ? 'Фото/файл обязателен для этого типа движения'
          : 'Для движения требуется фото/файл подтверждения'}
      </label>

      <Stack gap="sm">
        <div style={{ fontWeight: 600 }}>Подтверждающие файлы</div>
        <MediaActionPicker
          onPick={async (file) => {
            setPendingEvidence((current) => [...current, file]);
          }}
        />
        <PendingMediaList
          files={pendingEvidence}
          onRemove={(index) =>
            setPendingEvidence((current) =>
              current.filter((_, fileIndex) => fileIndex !== index),
            )
          }
          emptyText="Подтверждения пока не добавлены."
        />
      </Stack>

      {accessDenial || error ? <Alert tone="danger" role="alert">{accessDenial || error}</Alert> : null}
      {accessCheckError ? <Alert tone="warning" role="status">{accessCheckError}</Alert> : null}
      {accessRestored ? <Alert tone="success" role="status">{canCheckObjectIssue ? 'Доступ к выдаче восстановлен. Проверьте оставшиеся позиции и сохраните их.' : 'Доступ к приходу восстановлен. Чтобы записать приход, нажмите «Создать движение».'}</Alert> : null}
      {scopeError ? <Alert tone="info">{scopeError}</Alert> : null}

      <div className="ui-section-header">
        {accessDenial && canCheckAccess ? (
          <Button type="button" pending={isCheckingAccess} pendingLabel="Проверяем доступ…" onClick={() => void checkMovementAccess()}>
            Проверить доступ
          </Button>
        ) : null}
        <Button variant="primary" type="submit" disabled={isSaving || isCheckingAccess || Boolean(accessDenial) || (strictScope ? scopeError !== null : !canCreateMovement) || (supportsMultipleItems && issueLines.some((line) => !line.inventoryItemId || (!line.movementId && Number(line.quantity) < 0.001)))}>
          {isSaving ? 'Сохраняем...' : supportsMultipleItems ? `Создать движений: ${issueLines.length}` : 'Создать движение'}
        </Button>
      </div>
    </form>
  );
}
