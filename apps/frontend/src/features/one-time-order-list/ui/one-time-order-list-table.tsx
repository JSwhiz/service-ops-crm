'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';

import type { OneTimeOrderSortField } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { OneTimeOrderPreviewDrawer } from './one-time-order-preview-drawer';
import { StatusBadge } from '@/shared/ui/foundation';
import { SortableHeader } from '@/shared/ui/data-table/sortable-header';

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
  const [previewItem, setPreviewItem] = useState<OneTimeOrderListItem | null>(null);
  const closePreview = useCallback(() => setPreviewItem(null), []);

  if (items.length === 0) {
    return <div className="ui-empty-state">Разовые заказы не найдены.</div>;
  }

  return (
    <>
      <DataTable
        label="Таблица разовых заказов"
        className="one-time-order-registry-table"
        frameClassName="one-time-order-table-scroll"
      >
        <thead>
          <tr>
            <SortableHeader field="title" label="Заказ" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
            <SortableHeader field="executionStartDate" label="Даты" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
            <th scope="col">Адрес</th>
            <SortableHeader field="status" label="Статус" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
            <th scope="col">Менеджеры</th>
            <th scope="col">Объект</th>
            <th scope="col">ТЗ</th>
            <th scope="col">Задачи</th>
            <th scope="col">Отзыв</th>
            <th scope="col" aria-label="Быстрый просмотр" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const href = `/one-time-orders/${item.id}`;
            const executionDateMeta = getExecutionDateMeta(
              item.executionStartDate,
              item.executionEndDate,
              item.durationDays,
            );

            return (
              <tr
                key={item.id}
                className="one-time-order-preview-row"
                tabIndex={0}
                aria-label={`Быстрый просмотр заказа ${item.title}`}
                onClick={() => setPreviewItem(item)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setPreviewItem(item);
                  }
                }}
              >
                <td data-label="Заказ">
                  <Link href={href} onClick={(event) => event.stopPropagation()}><strong>{item.title}</strong></Link>
                  <span className="one-time-order-table-meta">
                    {item.contact.name}
                    {item.contact.phone ? ` · ${item.contact.phone}` : ''}
                  </span>
                </td>
                <td data-label="Даты">
                  <span
                    className="one-time-order-execution-date"
                    title={formatExecutionRangeFull(
                      item.executionStartDate,
                      item.executionEndDate,
                    )}
                  >
                    {formatExecutionRange(
                      item.executionStartDate,
                      item.executionEndDate,
                    )}
                  </span>
                  {executionDateMeta ? (
                    <span className="one-time-order-table-meta">
                      {executionDateMeta}
                    </span>
                  ) : null}
                </td>
                <td data-label="Адрес">{item.executionAddress}</td>
                <td data-label="Статус">
                  <StatusBadge status={item.status}>
                    {getOneTimeOrderStatusLabel(item.status)}
                  </StatusBadge>
                </td>
                <td data-label="Менеджеры">
                  {item.managers.map(getUserDisplayName).join(', ') || '—'}
                </td>
                <td data-label="Объект">
                  {item.linkedObject ? (
                    item.linkedObject.canOpenObjectCard ? (
                      <Link href={`/objects/${item.linkedObject.id}`} onClick={(event) => event.stopPropagation()}>
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
                  <span
                    className="one-time-order-specification-progress"
                    data-complete={item.specificationProgress.total > 0 && item.specificationProgress.completed >= item.specificationProgress.total}
                    title={`Выполнено пунктов ТЗ: ${item.specificationProgress.completed} из ${item.specificationProgress.total}`}
                  >
                    <strong>{item.specificationProgress.completed}</strong>
                    <span aria-hidden="true">/</span>
                    {item.specificationProgress.total}
                  </span>
                </td>
                <td data-label="Задачи">{item.accessibleTaskCount}</td>
                <td data-label="Отзыв">
                  <span className="one-time-order-review-preview" title={item.reviewPreview ?? undefined}>
                    {item.reviewPreview || '—'}
                  </span>
                </td>
                <td data-label="">
                  <div className="one-time-order-table-actions">
                    <Link
                      href={href}
                      className="one-time-order-preview-trigger"
                      aria-label={`Открыть заказ ${item.title} полностью`}
                      title="Открыть полную карточку"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span aria-hidden="true">›</span>
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      <OneTimeOrderPreviewDrawer item={previewItem} onClose={closePreview} />
    </>
  );
}

function formatExecutionRange(
  startDate: string | null,
  endDate: string | null,
): string {
  if (!startDate) return 'Без даты';
  if (!endDate || endDate === startDate) return formatCompactBusinessDate(startDate);

  const start = parseBusinessDate(startDate);
  const end = parseBusinessDate(endDate);
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${formatMonth(start.month)}`;
  }
  if (start.year === end.year) {
    return `${formatDayAndMonth(start)} – ${formatDayAndMonth(end)}`;
  }
  return `${formatDayAndMonth(start)} – ${formatDayAndMonth(end)}`;
}

function formatExecutionRangeFull(startDate: string | null, endDate: string | null): string {
  if (!startDate) return 'Дата выполнения не указана';
  const start = formatFullBusinessDate(startDate);
  if (!endDate || endDate === startDate) return start;
  return `${start} – ${formatFullBusinessDate(endDate)}`;
}

function parseBusinessDate(value: string): { day: number; month: number; year: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { day: day!, month: month!, year: year! };
}

function formatCompactBusinessDate(value: string): string {
  const date = parseBusinessDate(value);
  return formatDayAndMonth(date);
}

function getExecutionDateMeta(
  startDate: string | null,
  endDate: string | null,
  durationDays: number | null,
): string {
  const years = startDate
    ? (() => {
        const startYear = parseBusinessDate(startDate).year;
        const endYear = endDate ? parseBusinessDate(endDate).year : startYear;
        if (startYear === new Date().getFullYear() && endYear === startYear) return '';
        return startYear === endYear ? String(startYear) : `${startYear}–${endYear}`;
      })()
    : '';
  return [years, durationDays ? `${durationDays} дн.` : ''].filter(Boolean).join(' · ');
}

function formatDayAndMonth(date: { day: number; month: number; year: number }): string {
  return `${date.day} ${formatMonth(date.month)}`;
}

function formatMonth(month: number): string {
  const monthLabels = [
    'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.',
    'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
  ];
  return monthLabels[month - 1] ?? '';
}

function formatFullBusinessDate(value: string): string {
  const { day, month, year } = parseBusinessDate(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
