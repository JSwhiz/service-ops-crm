'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

interface ObjectDailyReportPanelProps {
  item: ObjectDailyReport | null;
  onSave: (payload: { content: string; files: File[] }) => Promise<void>;
}

export function ObjectDailyReportPanel({ item, onSave }: ObjectDailyReportPanelProps): React.JSX.Element {
  const [content, setContent] = useState(item?.content ?? '');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(item?.content ?? '');
    setPendingFiles([]);
  }, [item]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({ content, files: pendingFiles });
      setPendingFiles([]);
    } catch {
      setError('Не удалось сохранить ежедневный отчёт.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="section-title">Ежедневный отчёт</div>
        <span className={styles.panelState} data-ready={item ? 'true' : 'false'}>
          {item ? 'Заполнен' : 'Не заполнен'}
        </span>
      </div>

      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Что сделано за день</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
            placeholder="Коротко зафиксируйте результат дня"
          />
        </label>

        <div className={styles.mediaSection}>
          <MediaActionPicker
            disabled={isSubmitting}
            onPick={async (file) => setPendingFiles((prev) => [...prev, file])}
          />
          <PendingMediaList
            files={pendingFiles}
            onRemove={(index) => setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            emptyText="Новых вложений нет."
          />
          <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Вложений пока нет." />
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : item ? 'Обновить' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}
