'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import styles from './month-period-picker.module.css';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/icons/icons';

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

const SHORT_MONTHS = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
] as const;

interface MonthPeriodPickerProps {
  year: number;
  month: number;
  minYear?: number;
  maxYear?: number;
  label?: string;
  onChange: (year: number, month: number) => void;
}

export function MonthPeriodPicker({
  year,
  month,
  minYear = 2024,
  maxYear = 2100,
  label = 'Выбор месяца',
  onChange,
}: MonthPeriodPickerProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(year);

  useEffect(() => {
    if (!isOpen) setViewYear(year);
  }, [isOpen, year]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const currentPeriod = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }, []);

  const shiftMonth = (delta: number): void => {
    const nextDate = new Date(year, month - 1 + delta, 1);
    const nextYear = nextDate.getFullYear();
    const nextMonth = nextDate.getMonth() + 1;
    if (nextYear < minYear || nextYear > maxYear) return;
    onChange(nextYear, nextMonth);
  };

  const isPreviousDisabled = year === minYear && month === 1;
  const isNextDisabled = year === maxYear && month === 12;
  const isCurrentPeriod = year === currentPeriod.year && month === currentPeriod.month;

  return (
    <div className={styles.field} ref={rootRef}>
      <span className={styles.label}>Период</span>
      <div className={styles.control}>
        <button
          type="button"
          className={styles.arrowButton}
          aria-label="Предыдущий месяц"
          disabled={isPreviousDisabled}
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeftIcon />
        </button>

        <button
          type="button"
          className={styles.periodButton}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((value) => !value)}
        >
          <span>{MONTHS[month - 1]} {year}</span>
          <ChevronDownIcon />
        </button>

        <button
          type="button"
          className={styles.arrowButton}
          aria-label="Следующий месяц"
          disabled={isNextDisabled}
          onClick={() => shiftMonth(1)}
        >
          <ChevronRightIcon />
        </button>
      </div>

      {isOpen ? (
        <div className={styles.popover} role="dialog" aria-label={label}>
          <div className={styles.yearHeader}>
            <button
              type="button"
              className={styles.yearArrow}
              aria-label="Предыдущий год"
              disabled={viewYear <= minYear}
              onClick={() => setViewYear((value) => Math.max(minYear, value - 1))}
            >
              <ChevronLeftIcon />
            </button>
            <strong>{viewYear}</strong>
            <button
              type="button"
              className={styles.yearArrow}
              aria-label="Следующий год"
              disabled={viewYear >= maxYear}
              onClick={() => setViewYear((value) => Math.min(maxYear, value + 1))}
            >
              <ChevronRightIcon />
            </button>
          </div>

          <div className={styles.monthGrid}>
            {SHORT_MONTHS.map((label, index) => {
              const value = index + 1;
              const selected = viewYear === year && value === month;
              const current = viewYear === currentPeriod.year && value === currentPeriod.month;
              return (
                <button
                  key={label}
                  type="button"
                  className={styles.monthButton}
                  data-selected={selected ? 'true' : undefined}
                  data-current={current ? 'true' : undefined}
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(viewYear, value);
                    setIsOpen(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.todayButton}
              disabled={isCurrentPeriod || currentPeriod.year < minYear || currentPeriod.year > maxYear}
              onClick={() => {
                onChange(currentPeriod.year, currentPeriod.month);
                setIsOpen(false);
              }}
            >
              Текущий месяц
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
