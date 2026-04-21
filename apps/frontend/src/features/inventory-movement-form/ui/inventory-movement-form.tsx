'use client';

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
  }) => Promise<InventoryMovement | void>;
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

  return (
    <form
      className="page-card"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);

        const payload: CreateInventoryMovementPayload = {
          inventoryItemId,
          movementType: movementType as CreateInventoryMovementPayload['movementType'],
          quantity: Number(quantity),
          ...(movementType === 'receipt' ? { unitPrice: Number(unitPrice) } : {}),
          ...(movementType === 'adjustment'
            ? { adjustmentDirection }
            : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          evidenceRequired: isEvidenceMandatory || evidenceRequired,
          ...(movementType === 'issue_to_object' ||
          (movementType !== 'adjustment' &&
            movementType !== 'receipt' &&
            relationScope === 'object' &&
            relatedObjectId)
            ? { relatedObjectId }
            : {}),
          ...(movementType === 'issue_to_one_time_order' ||
          (movementType !== 'adjustment' &&
            movementType !== 'receipt' &&
            relationScope === 'one_time_order' &&
            relatedOneTimeOrderId)
            ? { relatedOneTimeOrderId }
            : {}),
        };

        void onSubmit({
          payload,
          evidenceFiles: pendingEvidence,
        })
          .then(() => {
            setQuantity('1');
            setUnitPrice('');
            setComment('');
            setPendingEvidence([]);
          })
          .catch((submitError) => {
            setError(
              getErrorMessage(submitError, 'Не удалось создать движение.'),
            );
          })
          .finally(() => {
            setIsSaving(false);
          });
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
        <label>
          <div style={{ marginBottom: 6 }}>Номенклатура</div>
          <select
            value={inventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
            style={{ width: '100%', padding: 10 }}
            required
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} • {item.category}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Тип движения</div>
          <select
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
            style={{ width: '100%', padding: 10 }}
          >
            {movementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Количество</div>
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            style={{ width: '100%', padding: 10 }}
            required
          />
        </label>

        {movementType === 'receipt' ? (
          <label>
            <div style={{ marginBottom: 6 }}>Цена за единицу</div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>
        ) : (
          <div>
            <div className="page-muted">Цена из последнего прихода</div>
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
        <label>
          <div style={{ marginBottom: 6 }}>Направление корректировки</div>
          <select
            value={adjustmentDirection}
            onChange={(event) =>
              setAdjustmentDirection(
                event.target.value as 'increase' | 'decrease',
              )
            }
            style={{ width: '100%', padding: 10 }}
          >
            <option value="increase">Увеличить остаток</option>
            <option value="decrease">Уменьшить остаток</option>
          </select>
        </label>
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
            <label>
              <div style={{ marginBottom: 6 }}>Связанный контур</div>
              <select
                value={relationScope}
                onChange={(event) =>
                  setRelationScope(event.target.value as RelationScope)
                }
                style={{ width: '100%', padding: 10 }}
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
              </select>
            </label>
          ) : null}

          {(movementType === 'issue_to_object' ||
            relationScope === 'object') && supportsObjectRelation ? (
            <label>
              <div style={{ marginBottom: 6 }}>Объект</div>
              <select
                value={relatedObjectId}
                onChange={(event) => setRelatedObjectId(event.target.value)}
                style={{ width: '100%', padding: 10 }}
                required={movementType === 'issue_to_object' || movementType === 'return'}
              >
                <option value="">Выберите объект</option>
                {objectOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} • {item.status}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {(movementType === 'issue_to_one_time_order' ||
            relationScope === 'one_time_order') && supportsOrderRelation ? (
            <label>
              <div style={{ marginBottom: 6 }}>Разовый заказ</div>
              <select
                value={relatedOneTimeOrderId}
                onChange={(event) => setRelatedOneTimeOrderId(event.target.value)}
                style={{ width: '100%', padding: 10 }}
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
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <label>
        <div style={{ marginBottom: 6 }}>Комментарий</div>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          style={{ width: '100%', padding: 10 }}
        />
      </label>

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

      <div style={{ display: 'grid', gap: 8 }}>
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
      </div>

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

      <div>
        <button type="submit" disabled={isSaving || !canCreateMovement}>
          {isSaving ? 'Сохраняем...' : 'Создать движение'}
        </button>
      </div>
    </form>
  );
}
