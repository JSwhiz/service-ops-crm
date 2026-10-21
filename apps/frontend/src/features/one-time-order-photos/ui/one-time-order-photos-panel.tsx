'use client';

import React, { useState } from 'react';

import type { OneTimeOrderPhotoItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  MEDIA_CATEGORY_OPTIONS,
  getMediaCategoryLabel,
} from '@/shared/lib/media-categories';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { ReasonDialog } from '@/shared/ui/overlays';
import { Alert, Button, Field, Stack } from '@/shared/ui/foundation';

export function OneTimeOrderPhotosPanel({
  items,
  canCreate,
  onCreate,
  onDelete,
  onRestore,
}: {
  items: OneTimeOrderPhotoItem[];
  canCreate: boolean;
  onCreate: (payload: {
    category: string;
    comment?: string;
    files: File[];
  }) => Promise<void>;
  onDelete: (photoId: string, reason?: string) => Promise<void>;
  onRestore: (photoId: string) => Promise<void>;
}): React.JSX.Element {
  const [category, setCategory] = useState('before');
  const [comment, setComment] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activeItems = items.filter((item) => !item.deletedAt);
  const deletedItems = items.filter((item) => !!item.deletedAt);

  return (
    <>
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Фото заказа</div>
          <div className="section-subtitle">
            До/после, отчетные и прочие фото через общий storage.
          </div>
        </div>
      </div>

      {canCreate ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            if (pendingFiles.length === 0) {
              return;
            }

            setError(null);
            setIsSubmitting(true);

            try {
              await onCreate({
                category,
                comment: comment.trim() || undefined,
                files: pendingFiles,
              });
              setComment('');
              setPendingFiles([]);
              setCategory('before');
            } catch {
              setError('Не удалось сохранить фото заказа.');
            } finally {
              setIsSubmitting(false);
            }
          }}
          style={{ display: 'grid', gap: 12 }}
        >
          <SearchableSelect
              label="Категория фото"
              value={category}
              options={MEDIA_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              searchable={false}
              clearable={false}
              onChange={setCategory}
          />

          <Field label="Комментарий">
            <textarea
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Что показано на фото"
            />
          </Field>

          <Stack gap="sm">
            <div className="page-muted">Фото</div>
            <MediaActionPicker
              disabled={isSubmitting}
              allowGenericFile={false}
              genericFileAccept="image/*"
              onPick={async (file) => {
                setPendingFiles((prev) => [...prev, file]);
              }}
            />
            <PendingMediaList
              files={pendingFiles}
              onRemove={(index) =>
                setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
              }
              emptyText="Новых фотографий пока нет."
            />
          </Stack>

          {error ? (
            <Alert tone="danger" role="alert">{error}</Alert>
          ) : null}

          <div>
            <Button variant="primary" type="submit" disabled={isSubmitting || pendingFiles.length === 0}>
              {isSubmitting ? 'Сохраняем...' : 'Добавить фото'}
            </Button>
          </div>
        </form>
      ) : null}

      {activeItems.length === 0 ? (
        <div className="page-muted">Фотографии заказа пока не загружены.</div>
      ) : (
        <div className="record-list local-scroll">
          {activeItems.map((item) => (
            <article
              key={item.id}
              className="record-card"
              style={{ display: 'grid', gap: 10 }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {getMediaCategoryLabel(item.category)}
                </div>
                <div className="page-muted">
                  {new Date(item.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="page-muted">
                {getUserDisplayName(item.createdBy)}
              </div>
              {item.comment ? <div>{item.comment}</div> : null}
              <AttachmentPreviewList
                files={item.attachments}
                emptyText="Фотографии в записи не найдены."
              />
              {item.capabilities.canDelete ? (
                <div className="action-row">
                  <Button
                    disabled={busyPhotoId === item.id}
                    onClick={() => { setPhotoToDelete(item.id); setDeleteReason(''); }}
                  >
                    {busyPhotoId === item.id ? 'Удаляем...' : 'Удалить'}
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {deletedItems.length > 0 ? (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Удалённые фото ({deletedItems.length})
          </summary>
          <div className="record-list local-scroll" style={{ marginTop: 12 }}>
            {deletedItems.map((item) => (
              <article
                key={item.id}
                className="record-card"
                style={{ display: 'grid', gap: 8 }}
              >
                <div style={{ fontWeight: 600 }}>
                  {getMediaCategoryLabel(item.category)}
                </div>
                <div className="page-muted">
                  Удалено{' '}
                  {item.deletedAt
                    ? new Date(item.deletedAt).toLocaleString('ru-RU')
                    : ''}
                  {item.deletedBy
                    ? ` · ${getUserDisplayName(item.deletedBy)}`
                    : ''}
                </div>
                {item.deleteReason ? (
                  <div>Причина: {item.deleteReason}</div>
                ) : null}
                {item.capabilities.canRestore ? (
                  <div className="action-row">
                    <Button
                      disabled={busyPhotoId === item.id}
                      onClick={async () => {
                        setError(null);
                        setBusyPhotoId(item.id);
                        try {
                          await onRestore(item.id);
                        } catch {
                          setError('Не удалось восстановить фото заказа.');
                        } finally {
                          setBusyPhotoId(null);
                        }
                      }}
                    >
                      {busyPhotoId === item.id
                        ? 'Восстанавливаем...'
                        : 'Восстановить'}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </div>
    <ReasonDialog
      open={photoToDelete !== null}
      onOpenChange={(open) => { if (!open) setPhotoToDelete(null); }}
      title="Удалить фото из заказа?"
      description="Фото будет перемещено в удалённые материалы. Его можно будет восстановить из этой карточки."
      reason={deleteReason}
      onReasonChange={setDeleteReason}
      reasonRequired={false}
      reasonLabel="Причина удаления (необязательно)"
      confirmLabel="Удалить фото"
      pending={busyPhotoId === photoToDelete}
      onConfirm={(reason) => {
        if (!photoToDelete) return;
        const targetId = photoToDelete;
        setError(null);
        setBusyPhotoId(targetId);
        void onDelete(targetId, reason.trim() || undefined)
          .then(() => setPhotoToDelete(null))
          .catch(() => setError('Не удалось удалить фото заказа.'))
          .finally(() => setBusyPhotoId(null));
      }}
    />
    </>
  );
}
