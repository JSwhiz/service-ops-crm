'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';

import type {
  ObjectSortField,
} from '@/entities/object/api/object-client';
import type {
  ObjectAssignedUser,
  ServiceObject,
} from '@/entities/object/model/object.types';
import { getUserDisplayName } from '@/shared/lib/display-name';

interface ObjectListTableProps {
  items: ServiceObject[];
  sortBy: ObjectSortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: ObjectSortField) => void;
}

function renderPeople(items: ObjectAssignedUser[]): string {
  return items.length ? items.map(getUserDisplayName).join(', ') : '—';
}

function getStatusLabel(status: string): string {
  if (status === 'active') return 'Активный';
  if (status === 'frozen') return 'Заморожен';
  if (status === 'archived') return 'Архив';
  return status;
}

function getSeasonLabel(seasonMode: string | null): string {
  if (seasonMode === 'summer') return 'Летний';
  if (seasonMode === 'winter') return 'Зимний';
  return 'Без сезонности';
}

function getAriaSort(
  field: ObjectSortField,
  sortBy: ObjectSortField,
  sortDirection: 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' {
  if (field !== sortBy) return 'none';
  return sortDirection === 'asc' ? 'ascending' : 'descending';
}

export function ObjectListTable({
  items,
  sortBy,
  sortDirection,
  onSort,
}: ObjectListTableProps): React.JSX.Element {
  const router = useRouter();

  if (!items.length) {
    return <div className="page-card">Объекты не найдены.</div>;
  }

  const renderSortButton = (
    field: ObjectSortField,
    label: string,
  ): React.JSX.Element => (
    <button
      type="button"
      className="object-table-sort"
      onClick={() => onSort(field)}
      aria-label={`Сортировать: ${label}`}
    >
      {label}
      {sortBy === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  return (
    <div className="page-card object-table-scroll">
      <table className="object-registry-table">
        <thead>
          <tr>
            <th aria-sort={getAriaSort('name', sortBy, sortDirection)}>
              {renderSortButton('name', 'Название')}
            </th>
            <th>Внутреннее название</th>
            <th>Адрес</th>
            <th>Статус</th>
            <th>Сезонность</th>
            <th>Ставка объекта</th>
            <th>Сотрудники</th>
            <th>Ответственный</th>
            <th>Менеджеры</th>
            <th aria-sort={getAriaSort('updatedAt', sortBy, sortDirection)}>
              {renderSortButton('updatedAt', 'Обновлён')}
            </th>
            <th>Действия</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => {
            const href = `/objects/${item.id}`;

            return (
              <tr
                key={item.id}
                className="object-registry-row"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') router.push(href);
                }}
                aria-label={`Открыть объект ${item.name}`}
              >
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>{item.internalName ?? '—'}</td>
                <td>{item.address}</td>
                <td>
                  <span className="status-pill" data-status={item.status}>
                    {getStatusLabel(item.status)}
                  </span>
                </td>
                <td>{getSeasonLabel(item.seasonMode)}</td>
                <td>{item.dailyRate.toLocaleString('ru-RU')} ₽/день</td>
                <td>{item.employees.length}</td>
                <td>
                  {item.responsible
                    ? getUserDisplayName(item.responsible)
                    : 'Не назначен'}
                </td>
                <td>{renderPeople(item.managers)}</td>
                <td>{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                <td>
                  <Link
                    href={href}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Открыть карточку ${item.name}`}
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
