'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectArrivalPhoto } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
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

export function ObjectArrivalPanel({ item, onSave }: ObjectArrivalPanelProps): React.JSX.Element {
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
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
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div>
          <div className="section-title">Фото прибытия</div>
          {item?.photoType ? <div className={styles.panelMeta}>{getMediaCategoryLabel(item.photoType)}</div> : null}
        </div>
        <span className={styles.panelState} data-ready={item ? 'true' : 'false'}>
          {item ? 'Загружено' : 'Не загружено'}
        </span>
      </div>

      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Категория</span>
          <select
            value={form.photoType}
            onChange={(event) => setForm((prev) => ({ ...prev, photoType: event.target.value }))}
          >
            {MEDIA_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Комментарий</span>
          <textarea
            value={form.comment}
            onChange={(event) => setForm((prev) => ({ ...prev, comment: event.target.value }))}
            rows={3}
            placeholder="Если есть важная деталь"
          />
        </label>

        <div className={styles.mediaSection}>
          <MediaActionPicker
            disabled={isSubmitting}
            allowGenericFile={false}
            genericFileAccept="image/*"
            onPick={async (file) => setPendingFiles((prev) => [...prev, file])}
          />
          <PendingMediaList
            files={pendingFiles}
            onRemove={(index) => setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            emptyText="Новых фото нет."
          />
          <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Фото пока не загружено." />
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={isSubmitting || (!item && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : item ? 'Обновить' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}
