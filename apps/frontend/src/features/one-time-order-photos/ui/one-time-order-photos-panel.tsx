'use client';

import React, { useState } from 'react';

import type { OneTimeOrderPhotoItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  MEDIA_CATEGORY_OPTIONS,
  getMediaCategoryLabel,
} from '@/shared/lib/media-categories';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

export function OneTimeOrderPhotosPanel({
  items,
  canCreate,
  onCreate,
}: {
  items: OneTimeOrderPhotoItem[];
  canCreate: boolean;
  onCreate: (payload: {
    category: string;
    comment?: string;
    files: File[];
  }) => Promise<void>;
}): React.JSX.Element {
  const [category, setCategory] = useState('before');
  const [comment, setComment] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
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
          <label>
            <div style={{ marginBottom: 6 }}>Категория фото</div>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              style={{ width: '100%', padding: 10 }}
            >
              {MEDIA_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              style={{ width: '100%', padding: 10, resize: 'vertical' }}
              placeholder="Что показано на фото"
            />
          </label>

          <div style={{ display: 'grid', gap: 8 }}>
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
          </div>

          {error ? (
            <div style={{ color: '#b91c1c' }}>{error}</div>
          ) : null}

          <div>
            <button type="submit" disabled={isSubmitting || pendingFiles.length === 0}>
              {isSubmitting ? 'Сохраняем...' : 'Добавить фото'}
            </button>
          </div>
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="page-muted">Фотографии заказа пока не загружены.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
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
              <div className="page-muted">{item.createdBy.fullName}</div>
              {item.comment ? <div>{item.comment}</div> : null}
              <AttachmentPreviewList
                files={item.attachments}
                emptyText="Фотографии в записи не найдены."
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
