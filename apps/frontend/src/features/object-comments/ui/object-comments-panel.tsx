'use client';

import React, { useState } from 'react';

import type { ObjectComment } from '@/entities/object/model/object-operations.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

interface ObjectCommentsPanelProps {
  items: ObjectComment[];
  onCreate: (payload: {
    content: string;
    commentType?: string;
    files: File[];
  }) => Promise<void>;
}

export function ObjectCommentsPanel({
  items,
  onCreate,
}: ObjectCommentsPanelProps): React.JSX.Element {
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate({
        content,
        files: pendingFiles,
      });
      setContent('');
      setPendingFiles([]);
    } catch {
      setError('Не удалось добавить комментарий.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Комментарии объекта</div>
          <div className="section-subtitle">
            Текст, фото и файлы по текущему объекту.
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <label>
          <div style={{ marginBottom: 6 }}>Новый комментарий</div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className="page-muted">Медиа и файлы комментария</div>
          <MediaActionPicker
            disabled={isSubmitting}
            onPick={async (file) => {
              setPendingFiles((prev) => [...prev, file]);
            }}
          />
          <PendingMediaList
            files={pendingFiles}
            onRemove={(index) =>
              setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
            emptyText="Новых вложений к комментарию пока нет."
          />
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем...' : 'Добавить комментарий'}
          </button>
        </div>
      </form>

      <div className="record-list local-scroll">
        {items.length === 0 ? (
          <div className="page-muted">Комментариев пока нет.</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="record-card"
            >
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                {getUserDisplayName(item.createdBy)}
              </div>
              {item.content ? <div>{item.content}</div> : null}
              <div style={{ marginTop: 10 }}>
                <AttachmentPreviewList
                  files={item.attachments}
                  emptyText="Вложений у комментария нет."
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
