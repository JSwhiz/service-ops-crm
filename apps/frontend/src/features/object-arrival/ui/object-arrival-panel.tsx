'use client';

import React, { useState } from 'react';

import type { ObjectArrivalPhoto } from '@/entities/object/model/object-operations.types';

interface ObjectArrivalPanelProps {
  item: ObjectArrivalPhoto | null;
  onSave: (payload: {
    photoUrl: string;
    photoType?: string;
    comment?: string;
  }) => Promise<void>;
}

export function ObjectArrivalPanel({
  item,
  onSave,
}: ObjectArrivalPanelProps): React.JSX.Element {
  const [form, setForm] = useState({
    photoUrl: item?.photoUrl ?? '',
    photoType: item?.photoType ?? 'arrival',
    comment: item?.comment ?? '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        photoUrl: form.photoUrl,
        photoType: form.photoType || undefined,
        comment: form.comment || undefined,
      });
    } catch {
      setError('Не удалось сохранить фото прибытия.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Фото прибытия сегодня</div>

      {item ? (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Уже зафиксировано: {item.createdBy.fullName}
        </div>
      ) : (
        <div className="page-muted" style={{ marginBottom: 12 }}>
          Фото прибытия за сегодня еще не зафиксировано.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 6 }}>URL фото</div>
            <input
              value={form.photoUrl}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, photoUrl: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              placeholder="https://..."
              required
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Тип фото</div>
            <input
              value={form.photoType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, photoType: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={form.comment}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, comment: event.target.value }))
              }
              rows={3}
              style={{ width: '100%', padding: 10, resize: 'vertical' }}
            />
          </label>
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохраняем...' : item ? 'Обновить фото прибытия' : 'Сохранить фото прибытия'}
          </button>
        </div>
      </form>
    </div>
  );
}
