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
import { Button, Stack, Surface } from '@/shared/ui/foundation';

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
  onAttachEvidence,
  onRefresh,
}: {
  movements: InventoryMovement[];
  availableItems: InventoryItem[];
  canIssueInventoryToObject: boolean;
  onIssue: (params: {
    inventoryItemId: string;
    quantity: number;
    comment?: string;
  }) => Promise<string>;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [issueLines, setIssueLines] = useState<Array<{ key: string; inventoryItemId: string; quantity: string; movementId?: string }>>([
    { key: 'initial', inventoryItemId: availableItems[0]?.id ?? '', quantity: '1' },
  ]);
  const [comment, setComment] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const addLine = (): void => {
    const selectedIds = new Set(issueLines.map((line) => line.inventoryItemId));
    const nextItem = availableItems.find((item) => !selectedIds.has(item.id));
    setIssueLines((current) => [...current, {
      key: `${Date.now()}-${current.length}`,
      inventoryItemId: nextItem?.id ?? '',
      quantity: '1',
    }]);
  };

  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">Списание расходников</div>
        <span className={styles.panelMeta}>{movements.length} операций</span>
      </div>

      {canIssueInventoryToObject ? (
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            setIsSaving(true);
            setError(null);
            void (async () => {
              let completed = 0;
              try {
                for (const line of issueLines) {
                  let movementId = line.movementId;
                  if (!movementId) {
                    movementId = await onIssue({
                      inventoryItemId: line.inventoryItemId,
                      quantity: Number(line.quantity),
                      ...(comment.trim() ? { comment: comment.trim() } : {}),
                    });
                    setIssueLines((current) => current.map((entry) =>
                      entry.key === line.key ? { ...entry, movementId } : entry,
                    ));
                  }

                  await onRefresh();

                  if (evidenceFiles.length > 0) {
                    await onAttachEvidence(movementId, evidenceFiles);
                  }
                  setIssueLines((current) => current.filter((entry) => entry.key !== line.key));
                  completed += 1;
                }
                setComment('');
                setEvidenceFiles([]);
                setIssueLines((current) => current.length > 0 ? current : [
                  { key: `${Date.now()}-next`, inventoryItemId: availableItems[0]?.id ?? '', quantity: '1' },
                ]);
                await onRefresh();
              } catch (submitError) {
                setError(completed > 0
                  ? `Успешно списано позиций: ${completed}. Остальные оставлены в форме. ${getErrorMessage(submitError, 'Не удалось завершить списание.')}`
                  : getErrorMessage(submitError, 'Не удалось списать расходники на объект.'));
              } finally {
                setIsSaving(false);
              }
            })();
          }}
        >
          <Stack gap="md">
            {issueLines.map((line, index) => {
              const selectedItem = availableItems.find((item) => item.id === line.inventoryItemId) ?? null;
              const options = availableItems.filter((item) =>
                item.id === line.inventoryItemId || !issueLines.some((other) => other.key !== line.key && other.inventoryItemId === item.id),
              );
              return (
                <Surface padding="sm" key={line.key} style={{ display: 'grid', gap: 10 }}>
                  <div className={styles.panelHeader}>
                    <strong>Позиция {index + 1}{line.movementId ? ' · уже списана, ожидает фото' : ''}</strong>
                    {!line.movementId && issueLines.length > 1 ? (
                      <Button onClick={() => setIssueLines((current) => current.filter((entry) => entry.key !== line.key))} disabled={isSaving}>Убрать</Button>
                    ) : null}
                  </div>
                  {!line.movementId ? (
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      <div className={styles.field}>
                        <SearchableSelect
                          label="Расходник"
                          value={line.inventoryItemId}
                          options={options.map((item) => ({
                            value: item.id,
                            label: `${item.name} • ${formatInventoryQuantity(item.currentStock, item.unit)}`,
                            searchText: item.name,
                          }))}
                          placeholder="Выберите расходник"
                          searchPlaceholder="Название расходника"
                          searchable
                          clearable={false}
                          viewportAware
                          disabled={isSaving}
                          onChange={(inventoryItemId) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, inventoryItemId } : entry))}
                        />
                      </div>
                      <label>
                        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Количество</div>
                        <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setIssueLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} required disabled={isSaving} />
                      </label>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Цена</span>
                        <div className={styles.readonlyValue}>{selectedItem?.currentUnitPrice == null ? 'Цена не указана' : `${selectedItem.currentUnitPrice.toLocaleString('ru-RU')} ₽ / ${selectedItem.unit}`}</div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyState}>Списание создано. Фото можно повторно приложить кнопкой ниже, не создавая новое движение.</div>
                  )}
                </Surface>
              );
            })}
          </Stack>

          {availableItems.some((item) => !issueLines.some((line) => line.inventoryItemId === item.id)) ? (
            <Button onClick={addLine} disabled={isSaving}>+ Добавить позицию</Button>
          ) : null}
          <div className={styles.emptyState}>Каждая позиция попадёт в журнал отдельным движением с собственным остатком и историей.</div>

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
            <Button variant="primary" type="submit" disabled={isSaving || issueLines.some((line) => !line.inventoryItemId || (!line.movementId && Number(line.quantity) < 0.001))}>
              {isSaving ? 'Списываем…' : issueLines.some((line) => line.movementId) ? 'Продолжить списание' : `Списать позиций: ${issueLines.length}`}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="record-list local-scroll">
        {movements.length === 0 ? (
          <div className={styles.emptyState}>Списаний пока нет.</div>
        ) : (
          movements.map((movement) => (
            <Surface padding="sm" key={movement.id} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{movement.inventoryItem.name}</div>
              <div className="ui-text-muted">
                {formatInventoryQuantity(movement.quantity, movement.inventoryItem.unit)} •{' '}
                {movement.unitPriceSnapshot.toLocaleString('ru-RU')} ₽ / {movement.inventoryItem.unit} •{' '}
                {movement.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
              </div>
                <div className="ui-text-muted">
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
            </Surface>
          ))
        )}
      </div>
    </Surface>
  );
}
