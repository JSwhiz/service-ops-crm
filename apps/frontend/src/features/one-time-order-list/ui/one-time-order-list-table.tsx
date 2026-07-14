import Link from 'next/link';
import React from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';

export function OneTimeOrderListTable({
  items,
}: {
  items: OneTimeOrderItem[];
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="page-card">
        <div className="page-muted">Разовые заказы не найдены.</div>
      </div>
    );
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 840,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Заказ</th>
            <th style={thStyle}>Статус</th>
            <th style={thStyle}>Контакт</th>
            <th style={thStyle}>Дата</th>
            <th style={thStyle}>Сумма</th>
            <th style={thStyle}>Отзыв</th>
            <th style={thStyle}>Менеджеры</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={tdStyle}>
                <div>
                  <Link href={`/one-time-orders/${item.id}`}>{item.title}</Link>
                </div>
                <div className="page-muted">{item.executionAddress}</div>
              </td>
              <td style={tdStyle}>
                <span className="status-pill" data-status={item.status}>
                  {getOneTimeOrderStatusLabel(item.status)}
                </span>
              </td>
              <td style={tdStyle}>
                {item.contactName}
                {item.contactPhone ? ` (${item.contactPhone})` : ''}
              </td>
              <td style={tdStyle}>
                {formatExecutionRange(
                  item.executionStartDate,
                  item.executionEndDate,
                )}
              </td>
              <td style={tdStyle}>
                {item.agreedSum !== null
                  ? `${item.agreedSum.toLocaleString('ru-RU')} ₽`
                  : '—'}
              </td>
              <td style={{ ...tdStyle, maxWidth: 240 }}>
                <div>
                  {item.reviewRating ? '★'.repeat(item.reviewRating) : '—'}
                </div>
                {item.reviewText ? (
                  <div className="page-muted" title={item.reviewText}>
                    {item.reviewText.length > 80
                      ? `${item.reviewText.slice(0, 80)}…`
                      : item.reviewText}
                  </div>
                ) : null}
              </td>
              <td style={tdStyle}>
                {item.managers.map(getUserDisplayName).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: 14,
};

function formatExecutionRange(
  startDate: string | null,
  endDate: string | null,
): string {
  if (!startDate) {
    return 'Без даты';
  }

  if (!endDate || endDate === startDate) {
    return formatBusinessDate(startDate);
  }

  const [startYear, startMonth, startDay] = startDate.split('-');
  const [endYear, endMonth] = endDate.split('-');

  if (startYear === endYear && startMonth === endMonth) {
    return `${Number(startDay)}–${formatBusinessDate(endDate)}`;
  }

  return `${formatBusinessDate(startDate)} – ${formatBusinessDate(endDate)}`;
}

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  borderBottom: '1px solid #f0f2f5',
  verticalAlign: 'top',
  fontSize: 14,
};
