'use client';

import React from 'react';

import styles from './review-rating-input.module.css';

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

export function ReviewRatingInput({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const values = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

  return (
    <div className={styles.control}>
      <div
        className={styles.stars}
        role="radiogroup"
        aria-label="Оценка отзыва"
        onKeyDown={(event) => {
          const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? -1
              : 0;
          if (!direction) return;
          event.preventDefault();
          const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
          const focusedIndex = radios.indexOf(document.activeElement as HTMLButtonElement);
          const selectedIndex = values.indexOf(value ?? 0);
          const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
          const nextIndex = Math.min(values.length - 1, Math.max(0, currentIndex + direction));
          onChange(values[nextIndex] ?? 0.5);
          radios[nextIndex]?.focus();
        }}
      >
        {values.map((rating) => {
          const isLeftHalf = rating % 1 !== 0;
          const filled = value !== null && value >= rating;
          return (
            <button
              key={rating}
              className={styles.halfStar}
              data-side={isLeftHalf ? 'left' : 'right'}
              data-filled={filled}
              type="button"
              role="radio"
              aria-checked={value === rating}
              aria-label={`${formatRating(rating)} из 5`}
              title={`${formatRating(rating)} из 5`}
              disabled={disabled}
              onClick={() => onChange(rating)}
            >
              <span className={styles.halfGlyph} aria-hidden="true">★</span>
            </button>
          );
        })}
      </div>
      <span className={styles.value}>{value === null ? 'Без оценки' : `${formatRating(value)} из 5`}</span>
      {value !== null ? (
        <button className={styles.clear} type="button" disabled={disabled} onClick={() => onChange(null)}>
          Без оценки
        </button>
      ) : null}
    </div>
  );
}

export function ReviewRatingDisplay({ value }: { value: number | null }): React.JSX.Element {
  return (
    <span className={styles.display} aria-label={value === null ? 'Без оценки' : `Оценка ${formatRating(value)} из 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = value !== null && value >= star ? '100%'
          : value === star - 0.5 ? '50%' : '0%';
        return <span key={star} className={styles.glyph} style={{ '--fill': fill } as React.CSSProperties} aria-hidden="true">★</span>;
      })}
    </span>
  );
}
