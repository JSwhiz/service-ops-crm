'use client';

import React, { useEffect, useState } from 'react';

import type { OneTimeOrderDailyReportItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';

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
    <Surface padding="md">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Ежедневный отчет заказа
      </div>

      {item ? (
        <div className="ui-text-muted" style={{ marginBottom: 12 }}>
          Последнее обновление: {getUserDisplayName(item.updatedBy)}
        </div>
      ) : (
        <div className="ui-text-muted" style={{ marginBottom: 12 }}>
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
        <Field label="Текст отчета">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
            placeholder="Что произошло по разовому заказу за день..."
          />
        </Field>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className="ui-text-muted">Фото и файлы отчета</div>
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
          <Alert tone="danger" role="alert">{error}</Alert>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting
              ? 'Сохраняем...'
              : item
                ? 'Обновить отчет заказа'
                : 'Сохранить отчет заказа'}
          </Button>
        </div>
      </form>
    </Surface>
  );
}
