'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { submitTodayDailyReport } from '@/entities/object/api/object-operations-client';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Button, Surface } from '@/shared/ui/foundation';

interface ObjectDailyReportPanelProps {
  item: ObjectDailyReport | null;
  onSave: (payload: { content: string; files: File[] }) => Promise<void>;
}

export function ObjectDailyReportPanel({ item, onSave }: ObjectDailyReportPanelProps): React.JSX.Element {
  const [content, setContent] = useState(item?.content ?? '');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publication, setPublication] = useState<ObjectDailyReport | null>(item);

  useEffect(() => {
    setContent(item?.content ?? '');
    setPublication(item);
  }, [item]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({ content, files: pendingFiles });
      setPendingFiles([]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Не удалось сохранить ежедневный отчёт.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitFinal = async (): Promise<void> => {
    if (!item || !item.revision) return;
    setIsSubmitting(true);
    setError(null);
    try {
      setPublication(await submitTodayDailyReport(item.objectId, item.revision));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Не удалось отправить отчёт.');
    } finally { setIsSubmitting(false); }
  };
  const submitted = !!publication && publication.submittedRevision > 0;
  const hasDraftChanges = content !== item?.content || pendingFiles.length > 0;
  const needsSubmission = !!item && item.revision > (publication?.submittedRevision ?? 0);

  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">Ежедневный отчёт</div>
        <span className={styles.panelState} data-ready={item ? 'true' : 'false'}>
          {submitted ? needsSubmission ? 'Есть черновик изменений' : 'Отправлен' : item ? 'Черновик' : 'Не заполнен'}
        </span>
      </div>

      {item ? <div className="ui-text-muted">{item.updatedBy.fullName} · {new Date(item.updatedAt).toLocaleString('ru-RU')}</div> : null}
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
            iconOnly
            disabled={isSubmitting}
            onPick={async (file) => setPendingFiles((prev) => [...prev, file])}
          />
          {pendingFiles.length > 0 ? (
            <div className={styles.pendingFilesViewport}>
              <PendingMediaList
                files={pendingFiles}
                onRemove={(index) => setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                emptyText=""
              />
            </div>
          ) : null}
          {(item?.attachments.length ?? 0) > 0 ? (
            <div className={styles.savedPhotosViewport}>
              <AttachmentPreviewList files={item?.attachments ?? []} emptyText="Вложений пока нет." />
            </div>
          ) : pendingFiles.length === 0 ? <div className={styles.emptyState}>Вложений пока нет.</div> : null}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Сохранить черновик'}
          </Button>
          {needsSubmission ? <Button type="button" disabled={isSubmitting || hasDraftChanges} onClick={() => void submitFinal()}>
            {submitted ? 'Отправить обновление отчёта' : 'Окончательно отправить отчёт'}
          </Button> : null}
        </div>
        {hasDraftChanges && item ? <div className="ui-text-muted">Сохраните текст и вложения перед окончательной отправкой.</div> : null}
      </form>
    </Surface>
  );
}
