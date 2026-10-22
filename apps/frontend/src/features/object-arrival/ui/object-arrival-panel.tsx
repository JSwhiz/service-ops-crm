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
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { Button, Surface } from '@/shared/ui/foundation';

interface ObjectArrivalPanelProps {
  item: ObjectArrivalPhoto | null;
  onSave: (payload: {
    photoUrl?: string;
    photoType?: string;
    comment?: string;
    files: File[];
    fileNames: Array<string | undefined>;
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
  const [pendingFileNames, setPendingFileNames] = useState<Array<string | undefined>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      photoType: normalizePhotoCategory(item?.photoType),
      comment: item?.comment ?? '',
    });
    setPendingFiles([]);
    setPendingFileNames([]);
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
        fileNames: pendingFileNames,
      });
      setPendingFiles([]);
      setPendingFileNames([]);
    } catch {
      setError('Не удалось сохранить фото прибытия.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div>
          <div className="ui-section-title">Фото прибытия</div>
          {item?.photoType ? <div className={styles.panelMeta}>{getMediaCategoryLabel(item.photoType)}</div> : null}
        </div>
        <span className={styles.panelState} data-ready={item ? 'true' : 'false'}>
          {item ? 'Загружено' : 'Не загружено'}
        </span>
      </div>

      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <div className={`${styles.field} ${styles.categoryField}`}>
          <SearchableSelect
            label="Категория"
            value={form.photoType}
            options={MEDIA_CATEGORY_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            searchable={false}
            clearable={false}
            viewportAware
            disabled={isSubmitting}
            onChange={(photoType) => setForm((prev) => ({ ...prev, photoType }))}
          />
        </div>

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
            iconOnly
            disabled={isSubmitting}
            allowGenericFile={false}
            genericFileAccept="image/*"
            onPick={async (file) => { setPendingFiles((prev) => [...prev, file]); setPendingFileNames((prev) => [...prev, undefined]); }}
          />
          {pendingFiles.length > 0 ? (
            <div className={styles.pendingFilesViewport}>
              <PendingMediaList
                files={pendingFiles}
                displayNames={pendingFileNames}
                onRemove={(index) => { setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index)); setPendingFileNames((prev) => prev.filter((_, itemIndex) => itemIndex !== index)); }}
                onRename={(index, name) => setPendingFileNames((prev) => prev.map((current, itemIndex) => itemIndex === index ? name : current))}
                iconActions
                emptyText=""
              />
            </div>
          ) : null}
          {(item?.attachments.length ?? 0) > 0 ? (
            <div className={styles.savedPhotosViewport}>
              <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Фото пока нет." iconDownload />
            </div>
          ) : <div className={styles.emptyState}>Фото пока нет.</div>}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || (!item && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : item ? 'Обновить' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Surface>
  );
}
