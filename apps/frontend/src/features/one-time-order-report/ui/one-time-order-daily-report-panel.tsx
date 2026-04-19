'use client';

import React, { useEffect, useState } from 'react';

import type { OneTimeOrderDailyReportItem } from '@/entities/one-time-order/model/one-time-order.types';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

export function OneTimeOrderDailyReportPanel({
  item,
  onSave,
}: {
  item: OneTimeOrderDailyReportItem | null;
  onSave: (payload: { content: string; files: File[] }) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState(item?.content ?? '');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(item?.content ?? '');
    setPendingFiles([]);
  }, [item]);

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Ежедневный отчет заказа
      </div>

      {item ? (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Последнее обновление: {item.updatedBy.fullName}
        </div>
      ) : (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Отчет за сегодня еще не создан.
        </div>
      )}

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setIsSubmitting(true);

          try {
            await onSave({
              content,
              files: pendingFiles,
            });
            setPendingFiles([]);
          } catch {
            setError('Не удалось сохранить ежедневный отчет заказа.');
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <label>
          <div style={{ marginBottom: 6 }}>Текст отчета</div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
            placeholder="Что произошло по разовому заказу за день..."
          />
        </label>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className="page-muted">Фото и файлы отчета</div>
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
            emptyText="Новых вложений к отчету пока нет."
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <AttachmentPreviewList
            files={item?.attachments ?? []}
            emptyText="Вложений у отчета пока нет."
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
            {isSubmitting
              ? 'Сохраняем...'
              : item
                ? 'Обновить отчет заказа'
                : 'Сохранить отчет заказа'}
          </button>
        </div>
      </form>
    </div>
  );
}
