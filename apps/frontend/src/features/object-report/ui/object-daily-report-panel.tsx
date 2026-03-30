'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectDailyReport } from '@/entities/object/model/object-operations.types';

interface ObjectDailyReportPanelProps {
  item: ObjectDailyReport | null;
  onSave: (payload: { content: string }) => Promise<void>;
}

export function ObjectDailyReportPanel({
  item,
  onSave,
}: ObjectDailyReportPanelProps): React.JSX.Element {
  const [content, setContent] = useState(item?.content ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(item?.content ?? '');
  }, [item]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({ content });
    } catch {
      setError('Не удалось сохранить ежедневный отчет.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Ежедневный отчет</div>

      {item ? (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Последнее обновление: {item.updatedBy.fullName}
        </div>
      ) : (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Отчет за сегодня еще не создан.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label>
          <div style={{ marginBottom: 6 }}>Текст отчета</div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
            placeholder="Что было сделано за день..."
            required
          />
        </label>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохраняем...' : item ? 'Обновить отчет дня' : 'Сохранить отчет дня'}
          </button>
        </div>
      </form>
    </div>
  );
}
