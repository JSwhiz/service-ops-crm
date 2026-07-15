'use client';

import Link from 'next/link';
import React from 'react';

import type { OneTimeOrderSortField } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';

export function OneTimeOrderListTable({
  items,
  sortBy,
  sortDirection,
  onSort,
}: {
  items: OneTimeOrderListItem[];
  sortBy: OneTimeOrderSortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: OneTimeOrderSortField) => void;
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="page-card page-muted">Разовые заказы не найдены.</div>;
  }

  const sortButton = (
    field: OneTimeOrderSortField,
    label: string,
  ): React.JSX.Element => (
    <button
      type="button"
      className="one-time-order-table-sort"
      onClick={() => onSort(field)}
    >
      {label}
      {sortBy === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  return (
    <div className="page-card one-time-order-table-scroll">
      <table className="one-time-order-registry-table">
        <thead>
          <tr>
            <th>{sortButton('title', 'Заказ')}</th>
            <th>{sortButton('executionStartDate', 'Даты')}</th>
            <th>Адрес</th>
            <th>{sortButton('status', 'Статус')}</th>
            <th>Менеджеры</th>
            <th>Объект</th>
            <th>ТЗ</th>
            <th>Задачи</th>
            <th>Оценка</th>
            <th>Отзыв</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const href = `/one-time-orders/${item.id}`;

            return (
              <tr key={item.id}>
                <td data-label="Заказ">
                  <strong>{item.title}</strong>
                  <span className="one-time-order-table-meta">
                    {item.contact.name}
                    {item.contact.phone ? ` · ${item.contact.phone}` : ''}
                  </span>
                </td>
                <td data-label="Даты">
                  {formatExecutionRange(
                    item.executionStartDate,
                    item.executionEndDate,
                  )}
                  {item.durationDays ? (
                    <span className="one-time-order-table-meta">
                      {item.durationDays} дн.
                    </span>
                  ) : null}
                </td>
                <td data-label="Адрес">{item.executionAddress}</td>
                <td data-label="Статус">
                  <span className="status-pill" data-status={item.status}>
                    {getOneTimeOrderStatusLabel(item.status)}
                  </span>
                </td>
                <td data-label="Менеджеры">
                  {item.managers.map(getUserDisplayName).join(', ') || '—'}
                </td>
                <td data-label="Объект">
                  {item.linkedObject ? (
                    item.linkedObject.canOpenObjectCard ? (
                      <Link href={`/objects/${item.linkedObject.id}`}>
                        {item.linkedObject.name}
                      </Link>
                    ) : (
                      item.linkedObject.name
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td data-label="ТЗ">
                  {item.specificationProgress.completed} /{' '}
                  {item.specificationProgress.total}
                </td>
                <td data-label="Задачи">{item.accessibleTaskCount}</td>
                <td data-label="Оценка">
                  {item.reviewRating ? '★'.repeat(item.reviewRating) : '—'}
                </td>
                <td data-label="Отзыв">
                  <span title={item.reviewPreview ?? undefined}>
                    {item.reviewPreview || '—'}
                  </span>
                </td>
                <td data-label="Действия">
                  <Link href={href}>Открыть</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatExecutionRange(
  startDate: string | null,
  endDate: string | null,
): string {
  if (!startDate) return 'Без даты';
  if (!endDate || endDate === startDate) return formatBusinessDate(startDate);
  return `${formatBusinessDate(startDate)} – ${formatBusinessDate(endDate)}`;
}

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}
