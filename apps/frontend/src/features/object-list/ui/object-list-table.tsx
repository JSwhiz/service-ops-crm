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

const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});

const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function getStatusLabel(status: string): string {
  if (status === 'active') return 'Активный';
  if (status === 'frozen') return 'Заморожен';
  if (status === 'archived') return 'Архив';
  return status;
}

function getEmployeeLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сотрудник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сотрудника';
  return 'сотрудников';
}

function renderManagers(items: ObjectAssignedUser[]): React.JSX.Element {
  if (!items.length) return <span className={styles.secondary}>—</span>;

  const names = items.map(getUserDisplayName);
  const visibleNames = names.slice(0, 2);
  const hiddenCount = Math.max(0, names.length - visibleNames.length);
  const fullLabel = names.join(', ');

  return (
    <span className={styles.managerSummary} title={fullLabel} aria-label={`Менеджеры: ${fullLabel}`}>
      <span className={styles.managerNames}>{visibleNames.join(', ')}</span>
      {hiddenCount > 0 ? <span className={styles.morePeople}>+{hiddenCount}</span> : null}
    </span>
  );
}

function renderTodaySignal(signal: ObjectRegistrySignal): React.JSX.Element {
  const missing: string[] = [];
  if (!signal.attendanceSubmitted) missing.push('нет присутствия');
  if (!signal.dailyReportSubmitted) missing.push('нет отчёта');

  if (!missing.length) {
    return (
      <span className={styles.todaySignal} data-state="ok" title="Присутствие и дневной отчёт отмечены">
        <span className={styles.signalDot} aria-hidden="true" />
        В порядке
      </span>
    );
  }

  const label = missing.length === 1 ? '1 сигнал' : `${missing.length} сигнала`;
  const details = missing.join(' · ');
  return (
    <span
      className={styles.todaySignal}
      data-state="attention"
      title={details}
      aria-label={`${label}: ${details}`}
    >
      <span className={styles.signalDot} aria-hidden="true" />
      {label}
    </span>
  );
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
              <th aria-label="Открыть полную карточку" />
            </tr>
          </thead>

          <tbody>
            {items.map((item) => {
              const href = `/objects/${item.id}`;
              const today = signals.get(item.id);
              const responsibleName = item.responsible ? getUserDisplayName(item.responsible) : null;
              const updatedAt = new Date(item.updatedAt);
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
                    <strong title={item.name}>{item.name}</strong>
                    <div className={styles.primaryMeta} title={[item.internalName, item.address].filter(Boolean).join(' · ')}>
                      {[item.internalName, item.address].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <span className={styles.status} data-status={item.status}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      {getStatusLabel(item.status)}
                    </span>
                  </td>
                  <td>
                    {responsibleName ? (
                      <span className={styles.personText} title={responsibleName}>{responsibleName}</span>
                    ) : (
                      <span className={styles.attention}>Не назначен</span>
                    )}
                  </td>
                  <td className={styles.teamCell}>
                    <strong>{item.employees.length}</strong>
                    <span className={styles.secondary}>{getEmployeeLabel(item.employees.length)}</span>
                  </td>
                  <td>
                    {item.capabilities.canViewOperationalSections ? (
                      today ? renderTodaySignal(today) : <span className={styles.secondary}>Загрузка…</span>
                    ) : <span className={styles.secondary}>—</span>}
                  </td>
                  <td>{renderManagers(item.managers)}</td>
                  <td className={styles.updatedCell} title={fullDateFormatter.format(updatedAt)}>
                    {shortDateFormatter.format(updatedAt)}
                  </td>
                  <td className={styles.actionCell}>
                    <Link
                      href={href}
                      className={styles.openLink}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Открыть объект ${item.name} полностью`}
                      title="Открыть полную карточку"
                    >
                      <span aria-hidden="true">›</span>
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
