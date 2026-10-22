'use client';

import React from 'react';

import type { TimesheetCorrectionItem } from '@/entities/timesheet/model/timesheet.types';
import timesheetStyles from '@/entities/timesheet/ui/timesheet-ui.module.css';

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
    <section className={timesheetStyles.timesheetCorrectionsPanel} aria-label="Ручные корректировки табеля">
      <div className={timesheetStyles.timesheetCorrectionsPanelHeader}>
        <div>
          <h3>Ручные корректировки</h3>
          <p>
            {employeeName
              ? `Для сотрудника ${employeeName}`
              : 'Изменения выплат за выбранный объект и период'}
          </p>
        </div>
        <span className={timesheetStyles.timesheetCorrectionsPanelCount}>{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className={timesheetStyles.timesheetCorrectionsPanelEmpty}>
          Ручных корректировок для текущей выборки нет.
        </div>
      ) : (
        <div className={timesheetStyles.timesheetCorrectionsList}>
          {items.map((item) => (
            <article
              key={`${item.employeeId}-${item.dayOfMonth}`}
              className={timesheetStyles.timesheetCorrectionRow}
            >
              <div className={timesheetStyles.timesheetCorrectionRowDate}>
                <span>{formatDay(item.dayOfMonth)}</span>
                <small>{item.hasFact ? 'Есть факт присутствия' : 'Без факта присутствия'}</small>
              </div>

              <div className={timesheetStyles.timesheetCorrectionRowMain}>
                <div className={timesheetStyles.timesheetCorrectionRowTopline}>
                  <strong>{item.employeeName}</strong>
                  <span className={timesheetStyles.timesheetCorrectionRowAmount}>
                    {moneyFormatter.format(item.dayValue)}
                  </span>
                </div>
                <p className={timesheetStyles.timesheetCorrectionRowComment}>
                  {item.comment?.trim() || 'Без комментария'}
                </p>
              </div>

              <div className={timesheetStyles.timesheetCorrectionRowAudit}>
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
