'use client';

import React from 'react';

import type { TimesheetCorrectionItem } from '@/entities/timesheet/model/timesheet.types';

interface TimesheetCorrectionsPanelProps {
  items: TimesheetCorrectionItem[];
}

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

export function TimesheetCorrectionsPanel({
  items,
}: TimesheetCorrectionsPanelProps): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 18 }}>
        Ручные корректировки табеля
      </div>

      {items.length === 0 ? (
        <div className="page-muted">
          За выбранный месяц ручных корректировок нет.
        </div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <div
              key={`${item.employeeId}-${item.dayOfMonth}`}
              style={{
                border: '1px solid #dbe3ee',
                borderRadius: 12,
                padding: 12,
                display: 'grid',
                gap: 8,
                background: item.hasFact ? '#eff6ff' : '#ffffff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontWeight: 600 }}>{item.employeeName}</div>
                <div className="page-muted">День: {item.dayOfMonth}</div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                }}
              >
                <div>
                  <div className="page-muted">Значение</div>
                  <div>{item.dayValue}</div>
                </div>

                <div>
                  <div className="page-muted">Факт присутствия</div>
                  <div>{item.hasFact ? 'Есть' : 'Нет'}</div>
                </div>

                <div>
                  <div className="page-muted">Последнее изменение</div>
                  <div>{formatDateTime(item.updatedAt)}</div>
                </div>

                <div>
                  <div className="page-muted">Изменил</div>
                  <div>{item.updatedByUserName ?? 'Неизвестно'}</div>
                </div>
              </div>

              <div>
                <div className="page-muted">Комментарий</div>
                <div>{item.comment ?? 'Комментарий отсутствует'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
