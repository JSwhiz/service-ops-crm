'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import type {
  InventoryItem,
  InventoryMovement,
} from '@/entities/inventory/model/inventory.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

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
  const [inventoryItemId, setInventoryItemId] = useState(availableItems[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedItem = availableItems.find((item) => item.id === inventoryItemId) ?? null;

  return (
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="section-title">Списание расходников</div>
        <span className={styles.panelMeta}>{movements.length} операций</span>
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
                setError(getErrorMessage(submitError, 'Не удалось списать расходник на объект.'));
              })
              .finally(() => {
                setIsSaving(false);
              });
          }}
        >
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className={styles.field}>
              <SearchableSelect
                label="Расходник"
                value={inventoryItemId}
                options={availableItems.map((item) => ({
                  value: item.id,
                  label: `${item.name} • ${formatInventoryQuantity(item.currentStock, item.unit)}`,
                  searchText: item.name,
                }))}
                placeholder="Выберите расходник"
                searchPlaceholder="Название расходника"
                searchable
                clearable={false}
                viewportAware
                onChange={setInventoryItemId}
              />
            </div>

            <label>
              <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Количество</div>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Цена</span>
              <div className={styles.readonlyValue}>
                {selectedItem?.currentUnitPrice === null || selectedItem?.currentUnitPrice === undefined
                  ? 'Цена не указана'
                  : `${selectedItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedItem.unit}`}
              </div>
            </div>
          </div>

          <label>
            <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
              placeholder="Куда и зачем списали расходник"
            />
          </label>

          <div>
            <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Фото подтверждения</div>
            <MediaActionPicker
              iconOnly
              allowGenericFile={false}
              onPick={async (file) => {
                setEvidenceFiles((current) => [...current, file]);
              }}
            />
            {evidenceFiles.length > 0 ? (
              <div className={styles.pendingFilesViewport}>
                <PendingMediaList
                  files={evidenceFiles}
                  onRemove={(index) =>
                    setEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  emptyText=""
                />
              </div>
            ) : <div className={styles.emptyState}>Фото не добавлены.</div>}
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.formActions}>
            <button className={styles.primaryAction} type="submit" disabled={isSaving || !inventoryItemId}>
              {isSaving ? 'Списываем…' : 'Списать на объект'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="record-list local-scroll">
        {movements.length === 0 ? (
          <div className={styles.emptyState}>Списаний пока нет.</div>
        ) : (
          movements.map((movement) => (
            <div key={movement.id} className="record-card" style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{movement.inventoryItem.name}</div>
              <div className="page-muted">
                {formatInventoryQuantity(movement.quantity, movement.inventoryItem.unit)} •{' '}
                {movement.unitPriceSnapshot.toLocaleString('ru-RU')} ₽ / {movement.inventoryItem.unit} •{' '}
                {movement.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
              </div>
                <div className="page-muted">
                {getUserDisplayName(movement.createdBy)} · {new Date(movement.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <div>
                {movement.projection.hasEvidence
                  ? 'Фото есть'
                  : movement.approvalRequest
                    ? 'Ожидает согласования'
                    : movement.projection.approvalBridgeResolvedAt
                      ? <>
                          Подтверждено директором без фото
                          {movement.projection.approvalBridgeResolvedBy
                            ? `: ${getUserDisplayName(movement.projection.approvalBridgeResolvedBy)}`
                            : ''}
                        </>
                      : movement.projection.requiresApprovalBridge
                        ? movement.projection.approvalBridgeType === 'inventory_without_photo_confirmation'
                          ? 'Нет фото: ожидает согласования'
                          : 'Нет фото: требуется подтверждение'
                        : 'Фото не требуется'}
              </div>
              {movement.projection.requiresApprovalBridge || movement.approvalRequest ? (
                <Link
                  className={styles.buttonLike}
                  href={`/approvals?sourceEntityType=inventory_movement&sourceEntityId=${movement.id}`}
                >
                  Открыть согласование
                </Link>
              ) : null}
              {movement.comment ? <div>{movement.comment}</div> : null}
              {movement.attachments.length > 0 ? (
                <div className={styles.savedPhotosViewport}>
                  <AttachmentPreviewList files={movement.attachments} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
