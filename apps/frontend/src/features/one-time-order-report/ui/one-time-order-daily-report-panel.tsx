'use client';

import React, { useEffect, useState } from 'react';

import type { OneTimeOrderDailyReportItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Alert, Button, Field, Stack, Surface } from '@/shared/ui/foundation';

export function OneTimeOrderDailyReportPanel({
  item,
  onSave,
  resources,
}: {
  item: OneTimeOrderDailyReportItem | null;
  onSave: (payload: { content: string; files: File[] }) => Promise<void>;
  resources?: React.ReactNode;
}): React.JSX.Element {
  const [content, setContent] = useState(item?.content ?? '');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(item?.content ?? '');
  }, [item]);

  return (
    <Stack gap="xl">
    <Surface as="section" padding="md" className="ui-stack ui-stack--lg">
      <div className="ui-section-header">
        <div>
          <h2 className="ui-section-title">Дневной отчёт</h2>
          <div className="ui-section-subtitle">Что выполнено по заказу сегодня и подтверждающие материалы.</div>
        </div>
      </div>

      {item ? (
        <div className="ui-text-muted">
          Последнее обновление: {getUserDisplayName(item.updatedBy)}
        </div>
      ) : (
        <div className="ui-text-muted">
          Отчёта за сегодня пока нет. Добавьте текст или вложения и сохраните отчёт.
        </div>
      )}

      <form
        className="ui-stack ui-stack--lg"
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
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось сохранить ежедневный отчет заказа.');
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <Field label="Текст отчёта">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            placeholder="Что произошло по разовому заказу за день..."
          />
        </Field>

        <Stack gap="sm">
          <div className="ui-text-muted">Фото и файлы отчёта</div>
          <MediaActionPicker
            disabled={isSubmitting}
            onPick={async (file) => {
              setPendingFiles((prev) => [...prev, file]);
            }}
          />
          {pendingFiles.length > 0 ? <PendingMediaList
            files={pendingFiles}
            onRemove={(index) =>
              setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
            emptyText="Новых вложений к отчету пока нет."
          /> : null}
        </Stack>

        {item && item.attachments.length > 0 ? (
        <Stack gap="sm">
          <div className="ui-text-muted">Сохранённые вложения</div>
          <AttachmentPreviewList
            files={item?.attachments ?? []}
            emptyText="Вложений у отчета пока нет."
          />
        </Stack>
        ) : null}

        {error ? (
          <Alert tone="danger" role="alert">{error}</Alert>
        ) : null}

        <div className="ui-inline">
          <Button variant="primary"
            type="submit"
            pending={isSubmitting}
            pendingLabel="Сохраняем…"
            disabled={!content.trim() && pendingFiles.length === 0}
          >
            {item ? 'Обновить отчёт' : 'Сохранить отчёт'}
          </Button>
        </div>
      </form>
    </Surface>
    {resources}
    </Stack>
  );
}
