'use client';

import React, { useState } from 'react';

import type { ObjectComment } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Button, Surface } from '@/shared/ui/foundation';

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
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">Комментарии</div>
        <span className={styles.panelMeta}>{items.length}</span>
      </div>

      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <textarea
            aria-label="Комментарий к объекту"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            placeholder="Что важно зафиксировать по объекту"
          />
        </div>

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
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Добавить'}
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className={styles.emptyState}>Комментариев пока нет.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <Surface padding="sm" key={item.id}>
              <div className={styles.panelMeta}>{getUserDisplayName(item.createdBy)}</div>
              {item.content ? <div>{item.content}</div> : null}
              {item.attachments.length > 0 ? (
                <div className={styles.savedPhotosViewport}>
                  <AttachmentPreviewList files={item.attachments} />
                </div>
              ) : null}
            </Surface>
          ))}
        </div>
      )}
    </Surface>
  );
}
