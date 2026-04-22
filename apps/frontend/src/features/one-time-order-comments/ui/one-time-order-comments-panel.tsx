'use client';

import React, { useState } from 'react';

import type { OneTimeOrderCommentItem } from '@/entities/one-time-order/model/one-time-order.types';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

export function OneTimeOrderCommentsPanel({
  items,
  canCreate,
  onCreate,
}: {
  items: OneTimeOrderCommentItem[];
  canCreate: boolean;
  onCreate: (payload: {
    content: string;
    commentType?: string;
    files: File[];
  }) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Комментарии</div>
          <div className="section-subtitle">
            Обсуждение заказа без смешения с чатами.
          </div>
        </div>
      </div>

      {canCreate ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            if (!content.trim() && pendingFiles.length === 0) {
              return;
            }

            setIsSubmitting(true);
            try {
              await onCreate({
                content: content.trim(),
                files: pendingFiles,
              });
              setContent('');
              setPendingFiles([]);
            } finally {
              setIsSubmitting(false);
            }
          }}
          style={{ display: 'grid', gap: 8 }}
        >
          <textarea
            rows={4}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
            placeholder="Добавить комментарий по заказу"
          />
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
                setPendingFiles((prev) =>
                  prev.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              emptyText="Новых вложений к комментарию пока нет."
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={
                isSubmitting || (!content.trim() && pendingFiles.length === 0)
              }
            >
              {isSubmitting ? 'Сохраняем...' : 'Добавить комментарий'}
            </button>
          </div>
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="page-muted">Комментариев пока нет.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <article
              key={item.id}
              className="record-card"
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600 }}>{item.createdBy.fullName}</div>
                <div className="page-muted">
                  {new Date(item.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              {item.content ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{item.content}</div>
              ) : null}
              <div style={{ marginTop: 10 }}>
                <AttachmentPreviewList
                  files={item.attachments}
                  emptyText="Вложений у комментария нет."
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
