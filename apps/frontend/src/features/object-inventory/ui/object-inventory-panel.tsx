'use client';

import React, { useState } from 'react';
import Link from 'next/link';

import type {
  InventoryItem,
  InventoryMovement,
} from '@/entities/inventory/model/inventory.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export function ObjectInventoryPanel({
  movements,
  availableItems,
  canIssueInventoryToObject,
  onIssue,
}: {
  movements: InventoryMovement[];
  availableItems: InventoryItem[];
  canIssueInventoryToObject: boolean;
  onIssue: (params: {
    inventoryItemId: string;
    quantity: number;
    comment?: string;
    evidenceFiles: File[];
  }) => Promise<void>;
}): React.JSX.Element {
  const [inventoryItemId, setInventoryItemId] = useState(
    availableItems[0]?.id ?? '',
  );
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedItem =
    availableItems.find((item) => item.id === inventoryItemId) ?? null;

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Расходники объекта</div>
          <div className="page-muted">
            Это финальное списание с центрального склада на объект, не мини-склад
            объекта.
          </div>
        </div>
      </div>

      {canIssueInventoryToObject ? (
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            setIsSaving(true);
            setError(null);

            void onIssue({
              inventoryItemId,
              quantity: Number(quantity),
              ...(comment.trim() ? { comment: comment.trim() } : {}),
              evidenceFiles,
            })
              .then(() => {
                setQuantity('1');
                setComment('');
                setEvidenceFiles([]);
              })
              .catch((submitError) => {
                setError(
                  getErrorMessage(
                    submitError,
                    'Не удалось списать расходник на объект.',
                  ),
                );
              })
              .finally(() => {
                setIsSaving(false);
              });
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <label>
              <div style={{ marginBottom: 6 }}>Расходник</div>
              <select
                value={inventoryItemId}
                onChange={(event) => setInventoryItemId(event.target.value)}
                style={{ width: '100%', padding: 10 }}
                required
              >
                {availableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} • {formatInventoryQuantity(item.currentStock, item.unit)}
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

            <div>
              <div className="page-muted">Цена</div>
              <div>
                {selectedItem?.currentUnitPrice === null ||
                selectedItem?.currentUnitPrice === undefined
                  ? 'Сначала нужен приход с ценой'
                  : `${selectedItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedItem.unit}`}
              </div>
            </div>
          </div>

          <label>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
              style={{ width: '100%', padding: 10 }}
              placeholder="Куда и зачем списали расходник"
            />
          </label>

          <div>
            <div style={{ marginBottom: 6 }}>Фото подтверждения</div>
            <MediaActionPicker
              allowGenericFile={false}
              onPick={async (file) => {
                setEvidenceFiles((current) => [...current, file]);
              }}
            />
            <PendingMediaList
              files={evidenceFiles}
              onRemove={(index) =>
                setEvidenceFiles((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            />
          </div>

          {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

          <button type="submit" disabled={isSaving || !inventoryItemId}>
            {isSaving ? 'Списываем...' : 'Списать на объект'}
          </button>
        </form>
      ) : null}

      <div className="record-list local-scroll">
        {movements.length === 0 ? (
          <div className="page-muted">По объекту пока нет списаний.</div>
        ) : (
          movements.map((movement) => (
            <div
              key={movement.id}
              className="record-card"
              style={{
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 600 }}>{movement.inventoryItem.name}</div>
              <div className="page-muted">
                {formatInventoryQuantity(
                  movement.quantity,
                  movement.inventoryItem.unit,
                )}{' '}
                • {movement.unitPriceSnapshot.toLocaleString('ru-RU')} ₽ /{' '}
                {movement.inventoryItem.unit} •{' '}
                {movement.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
              </div>
              <div className="page-muted">
                Списал: {getUserDisplayName(movement.createdBy)} •{' '}
                {new Date(movement.createdAt).toLocaleString('ru-RU')}
              </div>
              <div>
                {movement.projection.hasEvidence ? (
                  'Фото приложено'
                ) : movement.approvalRequest ? (
                  'Ожидает shared approval'
                ) : movement.projection.approvalBridgeResolvedAt ? (
                  <>
                    Подтверждено директором без фото
                    {movement.projection.approvalBridgeResolvedBy
                      ? `: ${getUserDisplayName(
                          movement.projection.approvalBridgeResolvedBy,
                        )}`
                      : ''}
                  </>
                ) : movement.projection.requiresApprovalBridge ? (
                  movement.projection.approvalBridgeType ===
                  'inventory_without_photo_confirmation' ? (
                    'Нет фото: ожидает director approval bridge'
                  ) : (
                    'Нет фото: требуется подтверждение evidence'
                  )
                ) : (
                  'Фото не требуется'
                )}
              </div>
              {movement.projection.requiresApprovalBridge || movement.approvalRequest ? (
                <Link
                  href={`/approvals?sourceEntityType=inventory_movement&sourceEntityId=${movement.id}`}
                >
                  Открыть согласование
                </Link>
              ) : null}
              {movement.comment ? <div>{movement.comment}</div> : null}
              <AttachmentPreviewList
                files={movement.attachments}
                emptyText="Подтверждающие фото пока не приложены."
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
