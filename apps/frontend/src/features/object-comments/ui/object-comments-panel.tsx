'use client';

import React, { useState } from 'react';

import type { ObjectComment } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

interface ObjectCommentsPanelProps {
  items: ObjectComment[];
  onCreate: (payload: { content: string; commentType?: string; files: File[] }) => Promise<void>;
}

export function ObjectCommentsPanel({ items, onCreate }: ObjectCommentsPanelProps): React.JSX.Element {
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate({ content, files: pendingFiles });
      setContent('');
      setPendingFiles([]);
    } catch {
      setError('Не удалось добавить комментарий.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="section-title">Комментарии</div>
        <span className={styles.panelMeta}>{items.length}</span>
      </div>

      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Новый комментарий</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            placeholder="Что важно зафиксировать по объекту"
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
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Добавить'}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className={styles.emptyState}>Комментариев пока нет.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <div key={item.id} className="record-card">
              <div className={styles.panelMeta}>{getUserDisplayName(item.createdBy)}</div>
              {item.content ? <div>{item.content}</div> : null}
              {item.attachments.length > 0 ? (
                <AttachmentPreviewList files={item.attachments} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
