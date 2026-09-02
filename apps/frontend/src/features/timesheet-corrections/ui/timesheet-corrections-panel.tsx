'use client';

import React from 'react';

import type { TimesheetCorrectionItem } from '@/entities/timesheet/model/timesheet.types';

interface TimesheetCorrectionsPanelProps {
  items: TimesheetCorrectionItem[];
  employeeName?: string | null;
}

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDay(day: number): string {
  return `${String(day).padStart(2, '0')} число`;
}

export function TimesheetCorrectionsPanel({
  items,
  employeeName = null,
}: TimesheetCorrectionsPanelProps): React.JSX.Element {
  return (
    <section className="timesheet-corrections-panel" aria-label="Ручные корректировки табеля">
      <div className="timesheet-corrections-panel__header">
        <div>
          <h3>Ручные корректировки</h3>
          <p>
            {employeeName
              ? `Для сотрудника ${employeeName}`
              : 'Изменения выплат за выбранный объект и период'}
          </p>
        </div>
        <span className="timesheet-corrections-panel__count">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="timesheet-corrections-panel__empty">
          Ручных корректировок для текущей выборки нет.
        </div>
      ) : (
        <div className="timesheet-corrections-list">
          {items.map((item) => (
            <article
              key={`${item.employeeId}-${item.dayOfMonth}`}
              className="timesheet-correction-row"
            >
              <div className="timesheet-correction-row__date">
                <span>{formatDay(item.dayOfMonth)}</span>
                <small>{item.hasFact ? 'Есть факт присутствия' : 'Без факта присутствия'}</small>
              </div>

              <div className="timesheet-correction-row__main">
                <div className="timesheet-correction-row__topline">
                  <strong>{item.employeeName}</strong>
                  <span className="timesheet-correction-row__amount">
                    {moneyFormatter.format(item.dayValue)}
                  </span>
                </div>
                <p className="timesheet-correction-row__comment">
                  {item.comment?.trim() || 'Без комментария'}
                </p>
              </div>

              <div className="timesheet-correction-row__audit">
                <span>{item.updatedByUserName ?? 'Неизвестный пользователь'}</span>
                <time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
