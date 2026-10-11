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
      className="page-card"
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
                <div key={line.key} className="record-card" style={{ display: 'grid', gap: 10 }}>
                  <div className="section-header">
                    <strong>Позиция {index + 1}{line.movementId ? ' · движение создано, ожидает подтверждения' : ''}</strong>
                    {!line.movementId && issueLines.length > 1 ? <button type="button" className="button-quiet" disabled={isSaving} onClick={() => setIssueLines((current) => current.filter((entry) => entry.key !== line.key))}>Убрать</button> : null}
                  </div>
                  {line.movementId ? <div className="page-muted">Операция уже записана. Повторная отправка не создаст дубликат.</div> : (
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      <label>
                        <div style={{ marginBottom: 6 }}>Номенклатура</div>
                        <select value={line.inventoryItemId} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, inventoryItemId: event.target.value } : entry))} style={{ width: '100%', padding: 10 }} required disabled={isSaving}>
                          {items.filter((item) => item.id === line.inventoryItemId || !issueLines.some((other) => other.key !== line.key && other.inventoryItemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}
                        </select>
                      </label>
                      <label>
                        <div style={{ marginBottom: 6 }}>Количество</div>
                        <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} style={{ width: '100%', padding: 10 }} required disabled={isSaving || Boolean(line.movementId)} />
                      </label>
                      <div><div className="page-muted">Цена</div><div>{selectedLineItem?.currentUnitPrice == null ? 'Не указана' : `${selectedLineItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedLineItem.unit}`}</div></div>
                    </div>
                  )}
                </div>
              );
            })}
            {items.some((item) => !issueLines.some((line) => line.inventoryItemId === item.id)) ? <button type="button" className="button-quiet" onClick={addIssueLine} disabled={isSaving}>+ Добавить позицию</button> : null}
            <div className="page-muted">Каждая позиция будет проведена отдельным движением с собственной проверкой остатка и историей.</div>
          </div>
        ) : <label>
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
        </label>}

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

        {!supportsMultipleItems ? <label>
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
        </label> : null}

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
            <div className="page-muted">
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
        <button type="submit" disabled={isSaving || !canCreateMovement || (supportsMultipleItems && issueLines.some((line) => !line.inventoryItemId || (!line.movementId && Number(line.quantity) < 0.001)))}>
          {isSaving ? 'Сохраняем...' : supportsMultipleItems ? `Создать движений: ${issueLines.length}` : 'Создать движение'}
        </button>
      </div>
    </form>
  );
}
