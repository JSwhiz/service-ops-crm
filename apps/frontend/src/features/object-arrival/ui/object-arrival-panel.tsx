'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';

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
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';


interface ObjectArrivalPanelProps {
  objectId: string;
  item: ObjectArrivalPhoto | null;
  canSave: boolean;
  onSave: (payload: {
    photoUrl?: string;
    photoType?: string;
    comment?: string;
    files: File[];
    fileNames: Array<string | undefined>;
  }) => Promise<void | SavedWithoutAccess>;
}

function normalizePhotoCategory(value: string | null | undefined): string {
  return MEDIA_CATEGORY_OPTIONS.some((option) => option.value === value)
    ? (value as string)
    : 'other';
}

export function ObjectArrivalPanel({ objectId, item, canSave, onSave }: ObjectArrivalPanelProps): React.JSX.Element {
  const surfaceMounted = useRef(true);
  const currentObjectId = useRef(objectId);
  currentObjectId.current = objectId;
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = useContext(AccessSnapshotBlockedContext);
  const writable = canSave && !blocked;
  const currentWritable = useRef(writable);
  currentWritable.current = writable;
  const persisted = useRef({ photoType: normalizePhotoCategory(item?.photoType), comment: item?.comment ?? '' });
  const [form, setForm] = useState({
    photoType: normalizePhotoCategory(item?.photoType),
    comment: item?.comment ?? '',
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFileNames, setPendingFileNames] = useState<Array<string | undefined>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentForm = useRef(form);
  currentForm.current = form;
  useEffect(() => {
    const dirty = JSON.stringify(currentForm.current) !== JSON.stringify(persisted.current);
    const next = { photoType: normalizePhotoCategory(item?.photoType), comment: item?.comment ?? '' };
    persisted.current = next;
    if (dirty) return;
    setForm({
      photoType: normalizePhotoCategory(item?.photoType),
      comment: item?.comment ?? '',
    });
  }, [item]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (acknowledged || isSubmitting || !currentWritable.current) { setError('Право изменения фото прибытия недоступно. Черновик сохранён.'); return; }
    const generation = getAccessGeneration();
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId);
    setIsSubmitting(true);
    setError(null);
    try {
      const receipt = await onSave({
        photoType: form.photoType || undefined,
        comment: form.comment || undefined,
        files: pendingFiles,
        fileNames: pendingFileNames,
      });
      if (!fence.sameTarget()) return;
      if (receipt && isSavedWithoutAccess(receipt)) { setAcknowledged(true); return; }
      if (!fence.current() || !isAccessGenerationCurrent(generation) || !currentWritable.current) { setAcknowledged(true); return; }
      setPendingFiles([]);
      setPendingFileNames([]);
    } catch {
      if (!fence.current()) return;
      setError('Не удалось сохранить фото прибытия.');
    } finally {
      if (fence.sameTarget()) setIsSubmitting(false);
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

      {!writable ? <div className={styles.emptyState} role="status">Изменение фото прибытия недоступно. Комментарий и выбранные файлы сохранены.</div> : null}
      {acknowledged ? <div className={styles.emptyState} role="status">Основная запись сохранена. Черновик и файлы оставлены для проверки; повтор не отправлялся.
        <Button type="button" onClick={() => setAcknowledged(false)}>Я проверил запись — новое действие</Button>
      </div> : null}
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
            disabled={acknowledged || isSubmitting || !writable}
            onChange={(photoType) => setForm((prev) => ({ ...prev, photoType }))}
          />
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Комментарий</span>
          <textarea
            disabled={acknowledged || isSubmitting || !writable}
            value={form.comment}
            onChange={(event) => setForm((prev) => ({ ...prev, comment: event.target.value }))}
            rows={3}
            placeholder="Если есть важная деталь"
          />
        </label>

        <div className={styles.mediaSection}>
          <MediaActionPicker
            compactMenu
            compactLabel="Добавить фото прибытия"
            disabled={acknowledged || isSubmitting || !writable}
            allowGenericFile={false}
            genericFileAccept="image/*"
            onPick={async (file) => { if (!currentWritable.current) return; setPendingFiles((prev) => [...prev, file]); setPendingFileNames((prev) => [...prev, undefined]); }}
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
            <div>
              <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Фото пока нет." compact iconDownload />
            </div>
          ) : <div className={styles.emptyState}>Фото пока нет.</div>}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={acknowledged || isSubmitting || !writable || (!item && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : item ? 'Обновить' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Surface>
  );
}
