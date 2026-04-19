'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectArrivalPhoto } from '@/entities/object/model/object-operations.types';
import {
  MEDIA_CATEGORY_OPTIONS,
  getMediaCategoryLabel,
} from '@/shared/lib/media-categories';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

interface ObjectArrivalPanelProps {
  item: ObjectArrivalPhoto | null;
  onSave: (payload: {
    photoUrl?: string;
    photoType?: string;
    comment?: string;
    files: File[];
  }) => Promise<void>;
}

function normalizePhotoCategory(value: string | null | undefined): string {
  return MEDIA_CATEGORY_OPTIONS.some((option) => option.value === value)
    ? (value as string)
    : 'other';
}

export function ObjectArrivalPanel({
  item,
  onSave,
}: ObjectArrivalPanelProps): React.JSX.Element {
  const [form, setForm] = useState({
    photoType: normalizePhotoCategory(item?.photoType),
    comment: item?.comment ?? '',
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      photoType: normalizePhotoCategory(item?.photoType),
      comment: item?.comment ?? '',
    });
    setPendingFiles([]);
  }, [item]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        photoType: form.photoType || undefined,
        comment: form.comment || undefined,
        files: pendingFiles,
      });
      setPendingFiles([]);
    } catch {
      setError('Не удалось сохранить фото прибытия.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Фото прибытия сегодня</div>

      {item ? (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Уже зафиксировано: {item.createdBy.fullName}
          {item.photoType ? ` • ${getMediaCategoryLabel(item.photoType)}` : ''}
        </div>
      ) : (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Фото прибытия за сегодня еще не зафиксировано.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <label>
            <div style={{ marginBottom: 6 }}>Категория фото</div>
            <select
              value={form.photoType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, photoType: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              {MEDIA_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={form.comment}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, comment: event.target.value }))
              }
              rows={3}
              style={{ width: '100%', padding: 10, resize: 'vertical' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className="page-muted">Фото прибытия</div>
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
            emptyText="Новых фото пока нет."
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <AttachmentPreviewList
            files={item?.attachments ?? []}
            emptyText="Фотографии прибытия пока не загружены."
          />
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button
            type="submit"
            disabled={isSubmitting || (!item && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем...' : item ? 'Обновить фото прибытия' : 'Сохранить фото прибытия'}
          </button>
        </div>
      </form>
    </div>
  );
}
