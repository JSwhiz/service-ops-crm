'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

interface ObjectDailyReportPanelProps {
  item: ObjectDailyReport | null;
  onSave: (payload: { content: string; files: File[] }) => Promise<void>;
}

export function ObjectDailyReportPanel({
  item,
  onSave,
}: ObjectDailyReportPanelProps): React.JSX.Element {
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
      setError('Не удалось сохранить ежедневный отчет.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div className="section-title" style={{ marginBottom: 6 }}>Ежедневный отчет</div>
      <div className="page-muted" style={{ marginBottom: 12 }}>
        {item ? `Последнее обновление: ${getUserDisplayName(item.updatedBy)}` : 'Отчет за сегодня еще не создан.'}
      </div>

      <form onSubmit={handleSubmit}>
        <label>
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Текст отчета</div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            placeholder="Что было сделано за день..."
          />
        </label>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className="page-muted">Фото и файлы отчета</div>
          <MediaActionPicker
            disabled={isSubmitting}
            onPick={async (file) => setPendingFiles((prev) => [...prev, file])}
          />
          <PendingMediaList
            files={pendingFiles}
            onRemove={(index) => setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            emptyText="Новых вложений к отчету пока нет."
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Вложений у отчета пока нет." />
        </div>

        {error ? <div className={styles.error} style={{ marginTop: 12 }}>{error}</div> : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}>
            {isSubmitting ? 'Сохраняем...' : item ? 'Обновить отчет дня' : 'Сохранить отчет дня'}
          </button>
        </div>
      </form>
    </div>
  );
}
