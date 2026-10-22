'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { ConfirmDialog } from '@/shared/ui/overlays';
import { Alert, Button } from '@/shared/ui/foundation';

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
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText(item.reviewText ?? '');
  }, [item.reviewText]);

  useEffect(() => {
    if (window.location.hash !== '#review') return;
    setIsEditing(true);
    window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: 'start' });
      if (item.capabilities.canEditReview) {
        textareaRef.current?.focus();
      }
    });
  }, [item.capabilities.canEditReview]);

  const hasReview = item.reviewText !== null || item.reviewRating !== null;

  return (
    <>
    <section id="review" ref={sectionRef} className="ui-surface ui-surface--padded one-time-order-review-section">
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Отзыв</div>
          <div className="ui-section-subtitle">
            {item.reviewUpdatedBy
              ? getUserDisplayName(item.reviewUpdatedBy)
              : ''}
            {item.reviewUpdatedAt
              ? `${item.reviewUpdatedBy ? ' · ' : ''}${new Date(item.reviewUpdatedAt).toLocaleString('ru-RU')}`
              : ''}
          </div>
        </div>
      </div>

      {item.capabilities.canEditReview && isEditing ? (
        <form
          className="ui-stack ui-stack--lg"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);

            if (!text.trim()) {
              setError('Введите текст отзыва.');
              return;
            }

            setIsSaving(true);
            try {
              await onSave({
                reviewText: text.trim() || null,
                // Preserve legacy rating data; rating controls are intentionally hidden.
                reviewRating: item.reviewRating,
              });
              setIsEditing(false);
            } catch {
              setError('Не удалось сохранить отзыв.');
            } finally {
              setIsSaving(false);
            }
          }}
        >
          <label>
            <div className="ui-detail-label">Текст отзыва</div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={5000}
              rows={4}
            />
          </label>
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          <div className="ui-inline">
            <Button variant="primary" type="submit" disabled={isSaving || !text.trim()}>
              {isSaving ? 'Сохраняем...' : 'Сохранить отзыв'}
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => { setText(item.reviewText ?? ''); setError(null); setIsEditing(false); }}
            >
              Отмена
            </Button>
            {hasReview ? (
              <Button
                disabled={isSaving}
                onClick={() => setClearConfirmOpen(true)}
              >
                Удалить отзыв
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="ui-inline" style={{ justifyContent: 'space-between' }}>
          <div>{item.reviewText ?? 'Отзыв пока не заполнен.'}</div>
          {item.capabilities.canEditReview ? (
            <Button onClick={() => setIsEditing(true)}>
              {hasReview ? 'Изменить отзыв' : 'Добавить отзыв'}
            </Button>
          ) : null}
        </div>
      )}
    </section>
    <ConfirmDialog
      open={clearConfirmOpen}
      onOpenChange={setClearConfirmOpen}
      title="Удалить отзыв?"
      consequence="Будут удалены текст отзыва и сохранённая оценка. Это действие нельзя отменить."
      confirmLabel="Удалить отзыв"
      tone="danger"
      pending={isSaving}
      onConfirm={() => {
        setIsSaving(true);
        setError(null);
        void onClear()
          .then(() => { setClearConfirmOpen(false); setIsEditing(false); })
          .catch(() => setError('Не удалось очистить отзыв.'))
          .finally(() => setIsSaving(false));
      }}
    />
    </>
  );
}
