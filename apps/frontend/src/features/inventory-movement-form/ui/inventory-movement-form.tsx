'use client';

import { PlusIcon } from '@/shared/ui/icons/icons';
import React, { useMemo, useState } from 'react';

import type {
  CreateInventoryMovementPayload,
  InventoryItem,
  InventoryMovement,
  InventoryObjectReference,
  InventoryOneTimeOrderReference,
} from '@/entities/inventory/model/inventory.types';
import { INVENTORY_MOVEMENT_TYPE_OPTIONS } from '@/shared/lib/inventory-presentation';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, Button, Field, Stack, Surface } from '@/shared/ui/foundation';

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
  onSubmit,
  onAttachEvidence,
  onRefresh,
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
  onSubmit: (params: {
    payload: CreateInventoryMovementPayload;
    evidenceFiles: File[];
  }) => Promise<InventoryMovement>;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const movementOptions = useMemo(
    () =>
      INVENTORY_MOVEMENT_TYPE_OPTIONS.filter((option) => {
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
    ],
  );
  const initialMovementType = movementOptions[0]?.value ?? 'receipt';

  const [inventoryItemId, setInventoryItemId] = useState(
    defaultInventoryItemId ?? items[0]?.id ?? '',
  );
  const [movementType, setMovementType] = useState(initialMovementType);
  const [quantity, setQuantity] = useState('1');
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
  const [isSaving, setIsSaving] = useState(false);

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

  return (
    <form
      className="ui-surface ui-surface--padded"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);
        void (async () => {
          let completed = 0;
          try {
            const basePayload = {
              movementType: movementType as CreateInventoryMovementPayload['movementType'],
              ...(movementType === 'receipt' ? { unitPrice: Number(unitPrice) } : {}),
              ...(movementType === 'adjustment' ? { adjustmentDirection } : {}),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
              evidenceRequired: isEvidenceMandatory || evidenceRequired,
              ...(movementType === 'issue_to_object' || (movementType !== 'adjustment' && movementType !== 'receipt' && relationScope === 'object' && relatedObjectId) ? { relatedObjectId } : {}),
              ...(movementType === 'issue_to_one_time_order' || (movementType !== 'adjustment' && movementType !== 'receipt' && relationScope === 'one_time_order' && relatedOneTimeOrderId) ? { relatedOneTimeOrderId } : {}),
            };

            if (supportsMultipleItems) {
              for (const line of issueLines) {
                let movementId = line.movementId;
                if (!movementId) {
                  const created = await onSubmit({
                    payload: { ...basePayload, inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity) },
                    evidenceFiles: [],
                  });
                  movementId = created.id;
                  setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, movementId } : entry));
                }
                if (pendingEvidence.length) await onAttachEvidence(movementId, pendingEvidence);
                setIssueLines((current) => current.filter((entry) => entry.key !== line.key));
                completed += 1;
              }
              setIssueLines([{ key: `${Date.now()}-next`, inventoryItemId: items[0]?.id ?? '', quantity: '1' }]);
            } else {
              const created = await onSubmit({
                payload: { ...basePayload, inventoryItemId, quantity: Number(quantity) },
                evidenceFiles: [],
              });
              if (pendingEvidence.length) await onAttachEvidence(created.id, pendingEvidence);
              setQuantity('1');
              setUnitPrice('');
            }

            setComment('');
            setPendingEvidence([]);
            await onRefresh();
          } catch (submitError) {
            setError(completed > 0
              ? `Создано движений: ${completed}. Оставшиеся позиции не потеряны в форме. ${getErrorMessage(submitError, 'Не удалось завершить операцию.')}`
              : getErrorMessage(submitError, 'Не удалось создать движение.'));
          } finally {
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
                    {!line.movementId && issueLines.length > 1 ? <Button disabled={isSaving} onClick={() => setIssueLines((current) => current.filter((entry) => entry.key !== line.key))}>Убрать</Button> : null}
                  </div>
                  {line.movementId ? <div className="ui-text-muted">Операция уже записана. Повторная отправка не создаст дубликат.</div> : (
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      <Field label="Номенклатура">
                        <Select value={line.inventoryItemId} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, inventoryItemId: event.target.value } : entry))} required disabled={isSaving}>
                          {items.filter((item) => item.id === line.inventoryItemId || !issueLines.some((other) => other.key !== line.key && other.inventoryItemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}
                        </Select>
                      </Field>
                      <Field label="Количество">
                        <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} required disabled={isSaving || Boolean(line.movementId)} />
                      </Field>
                      <div><div className="ui-text-muted">Цена</div><div>{selectedLineItem?.currentUnitPrice == null ? 'Не указана' : `${selectedLineItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedLineItem.unit}`}</div></div>
                    </div>
                  )}
                </Surface>
              );
            })}
            {items.some((item) => !issueLines.some((line) => line.inventoryItemId === item.id)) ? <Button onClick={addIssueLine} disabled={isSaving} icon={<PlusIcon />}>Добавить позицию</Button> : null}
            <div className="ui-text-muted">Каждая позиция будет проведена отдельным движением с собственной проверкой остатка и историей.</div>
          </div>
        ) : <Field label="Номенклатура">
   <Select
            value={inventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
            required
          >
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {movementType === 'return' || movementType === 'writeoff' ? (
            <Field label="Связанный контур">
              <Select
                value={relationScope}
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
                onChange={(event) => setRelatedObjectId(event.target.value)}
                required={movementType === 'issue_to_object' || movementType === 'return'}
              >
                <option value="">Выберите объект</option>
                {objectOptions.map((item) => (
                  <option key={item.id} value={item.id}>
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
                onChange={(event) => setRelatedOneTimeOrderId(event.target.value)}
                required={
                  movementType === 'issue_to_one_time_order' ||
                  movementType === 'return'
                }
              >
                <option value="">Выберите заказ</option>
                {oneTimeOrderOptions.map((item) => (
                  <option key={item.id} value={item.id}>
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

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      <div>
        <Button variant="primary" type="submit" disabled={isSaving || !canCreateMovement || (supportsMultipleItems && issueLines.some((line) => !line.inventoryItemId || (!line.movementId && Number(line.quantity) < 0.001)))}>
          {isSaving ? 'Сохраняем...' : supportsMultipleItems ? `Создать движений: ${issueLines.length}` : 'Создать движение'}
        </Button>
      </div>
    </form>
  );
}
