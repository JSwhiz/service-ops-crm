'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import type { ObjectSortField } from '@/entities/object/api/object-client';
import type { ObjectAssignedUser, ServiceObject } from '@/entities/object/model/object.types';
import { ObjectPreviewDrawer } from '@/features/object-registry/ui/object-preview-drawer';
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
  const [previewItem, setPreviewItem] = useState<ServiceObject | null>(null);

  if (!items.length) {
    return <div className="page-card workspace-surface workspace-empty">Объекты не найдены.</div>;
  }

  const renderSortButton = (field: ObjectSortField, label: string): React.JSX.Element => (
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
    <>
      <div className="page-card workspace-surface data-table-shell object-table-scroll">
        <table className="object-registry-table object-registry-table--operational">
          <thead>
            <tr>
              <th aria-sort={getAriaSort('name', sortBy, sortDirection)}>
                {renderSortButton('name', 'Объект')}
              </th>
              <th>Статус</th>
              <th>Ответственный</th>
              <th>Команда</th>
              <th>Менеджеры</th>
              <th aria-sort={getAriaSort('updatedAt', sortBy, sortDirection)}>
                {renderSortButton('updatedAt', 'Обновлён')}
              </th>
              <th aria-label="Действия" />
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
                  onClick={() => setPreviewItem(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setPreviewItem(item);
                    }
                  }}
                  aria-label={`Быстрый просмотр объекта ${item.name}`}
                >
                  <td>
                    <strong>{item.name}</strong>
                    <div className="object-registry-primary-meta">
                      {[item.internalName, item.address].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <span className="status-pill" data-status={item.status}>{getStatusLabel(item.status)}</span>
                  </td>
                  <td>{item.responsible ? getUserDisplayName(item.responsible) : <span className="object-registry-attention">Не назначен</span>}</td>
                  <td>
                    <strong>{item.employees.length}</strong>
                    <span className="object-registry-secondary"> сотрудников</span>
                  </td>
                  <td>{renderPeople(item.managers)}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                  <td>
                    <Link
                      href={href}
                      className="object-registry-open-link"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Открыть объект ${item.name} полностью`}
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

      <ObjectPreviewDrawer item={previewItem} onClose={() => setPreviewItem(null)} />
    </>
  );
}
