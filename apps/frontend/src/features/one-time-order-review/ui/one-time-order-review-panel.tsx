'use client';

import React, { useEffect, useState } from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';

export function OneTimeOrderReviewPanel({
  item,
  onSave,
  onClear,
}: {
  item: OneTimeOrderItem;
  onSave: (payload: {
    reviewText: string | null;
    reviewRating: number | null;
  }) => Promise<void>;
  onClear: () => Promise<void>;
}): React.JSX.Element {
  const [text, setText] = useState(item.reviewText ?? '');
  const [rating, setRating] = useState(
    item.reviewRating === null ? '' : String(item.reviewRating),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(item.reviewText ?? '');
    setRating(item.reviewRating === null ? '' : String(item.reviewRating));
  }, [item.reviewRating, item.reviewText]);

  const hasReview = item.reviewText !== null || item.reviewRating !== null;

  return (
    <section className="page-card">
      <div className="section-header">
        <div>
          <div className="section-title">Отзыв</div>
          <div className="section-subtitle">
            {item.reviewRating ? '★'.repeat(item.reviewRating) : 'Без оценки'}
            {item.reviewUpdatedBy
              ? ` · ${getUserDisplayName(item.reviewUpdatedBy)}`
              : ''}
            {item.reviewUpdatedAt
              ? ` · ${new Date(item.reviewUpdatedAt).toLocaleString('ru-RU')}`
              : ''}
          </div>
        </div>
      </div>

      {item.capabilities.canEditReview ? (
        <form
          className="page-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);

            if (!text.trim() && !rating) {
              setError('Укажите оценку или текст отзыва.');
              return;
            }

            setIsSaving(true);
            try {
              await onSave({
                reviewText: text.trim() || null,
                reviewRating: rating ? Number(rating) : null,
              });
            } catch {
              setError('Не удалось сохранить отзыв.');
            } finally {
              setIsSaving(false);
            }
          }}
        >
          <label>
            <div className="detail-label">Оценка</div>
            <select
              value={rating}
              onChange={(event) => setRating(event.target.value)}
            >
              <option value="">Без оценки</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {'★'.repeat(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="detail-label">Текст отзыва</div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={5000}
              rows={4}
            />
          </label>
          {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div className="action-row">
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Сохраняем...' : 'Сохранить отзыв'}
            </button>
            {hasReview ? (
              <button
                type="button"
                className="button-secondary"
                disabled={isSaving}
                onClick={async () => {
                  if (!window.confirm('Очистить отзыв?')) {
                    return;
                  }

                  setIsSaving(true);
                  setError(null);
                  try {
                    await onClear();
                  } catch {
                    setError('Не удалось очистить отзыв.');
                  } finally {
                    setIsSaving(false);
                  }
                }}
              >
                Очистить
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div>{item.reviewText ?? 'Отзыв пока не заполнен.'}</div>
      )}
    </section>
  );
}
