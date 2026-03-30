'use client';

import React, { useState } from 'react';

import type { ObjectComment } from '@/entities/object/model/object-operations.types';

interface ObjectCommentsPanelProps {
  items: ObjectComment[];
  onCreate: (payload: { content: string; commentType?: string }) => Promise<void>;
}

export function ObjectCommentsPanel({
  items,
  onCreate,
}: ObjectCommentsPanelProps): React.JSX.Element {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate({ content });
      setContent('');
    } catch {
      setError('Не удалось добавить комментарий.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Комментарии объекта</div>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <label>
          <div style={{ marginBottom: 6 }}>Новый комментарий</div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
            required
          />
        </label>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохраняем...' : 'Добавить комментарий'}
          </button>
        </div>
      </form>

      <div style={{ display: 'grid', gap: 12 }}>
        {items.length === 0 ? (
          <div className="page-muted">Комментариев пока нет.</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                {item.createdBy.fullName}
              </div>
              <div>{item.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
