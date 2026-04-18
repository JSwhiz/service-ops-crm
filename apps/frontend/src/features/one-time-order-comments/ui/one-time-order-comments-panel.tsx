'use client';

import React, { useState } from 'react';

import type { OneTimeOrderCommentItem } from '@/entities/one-time-order/model/one-time-order.types';

export function OneTimeOrderCommentsPanel({
  items,
  canCreate,
  onCreate,
}: {
  items: OneTimeOrderCommentItem[];
  canCreate: boolean;
  onCreate: (payload: { content: string; commentType?: string }) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600 }}>Комментарии</div>

      {canCreate ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            if (!content.trim()) {
              return;
            }

            setIsSubmitting(true);
            try {
              await onCreate({
                content: content.trim(),
              });
              setContent('');
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
          <div>
            <button type="submit" disabled={isSubmitting || !content.trim()}>
              {isSubmitting ? 'Сохраняем...' : 'Добавить комментарий'}
            </button>
          </div>
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="page-muted">Комментариев пока нет.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((item) => (
            <article
              key={item.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 12,
              }}
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
              <div style={{ whiteSpace: 'pre-wrap' }}>{item.content}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
