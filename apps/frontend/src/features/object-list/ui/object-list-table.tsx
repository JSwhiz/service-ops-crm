'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import type {
  ObjectRegistrySignal,
  ObjectSortField,
} from '@/entities/object/api/object-client';
import type { ObjectAssignedUser, ServiceObject } from '@/entities/object/model/object.types';
import { ObjectPreviewDrawer } from '@/features/object-registry/ui/object-preview-drawer';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './object-list-table.module.css';

interface ObjectListTableProps {
  items: ServiceObject[];
  signals: Map<string, ObjectRegistrySignal>;
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
  signals,
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
        <table className={`object-registry-table ${styles.table}`}>
          <thead>
            <tr>
              <th aria-sort={getAriaSort('name', sortBy, sortDirection)}>{renderSortButton('name', 'Объект')}</th>
              <th>Статус</th>
              <th>Ответственный</th>
              <th>Команда</th>
              <th>Сегодня</th>
              <th>Менеджеры</th>
              <th aria-sort={getAriaSort('updatedAt', sortBy, sortDirection)}>{renderSortButton('updatedAt', 'Обновлён')}</th>
              <th aria-label="Действия" />
            </tr>
          </thead>

          <tbody>
            {items.map((item) => {
              const href = `/objects/${item.id}`;
              const today = signals.get(item.id);
              return (
                <tr
                  key={item.id}
                  className={styles.row}
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
                  <td className={styles.objectCell}>
                    <strong>{item.name}</strong>
                    <div className={styles.primaryMeta}>{[item.internalName, item.address].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><span className="status-pill" data-status={item.status}>{getStatusLabel(item.status)}</span></td>
                  <td>{item.responsible ? getUserDisplayName(item.responsible) : <span className={styles.attention}>Не назначен</span>}</td>
                  <td><strong>{item.employees.length}</strong><span className={styles.secondary}> сотрудников</span></td>
                  <td>
                    {item.capabilities.canViewOperationalSections ? (
                      today ? (
                        <div className={styles.todaySignals}>
                          <span data-state={today.attendanceSubmitted ? 'ok' : 'attention'}>
                            {today.attendanceSubmitted ? '✓ Присутствие' : '! Нет присутствия'}
                          </span>
                          <span data-state={today.dailyReportSubmitted ? 'ok' : 'attention'}>
                            {today.dailyReportSubmitted ? '✓ Отчёт' : '! Нет отчёта'}
                          </span>
                        </div>
                      ) : <span className={styles.secondary}>Загрузка…</span>
                    ) : <span className={styles.secondary}>—</span>}
                  </td>
                  <td>{renderPeople(item.managers)}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                  <td>
                    <Link
                      href={href}
                      className={styles.openLink}
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
