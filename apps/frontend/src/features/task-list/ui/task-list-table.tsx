import Link from 'next/link';
import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatTaskDeadline,
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryOpenLink } from '@/shared/ui/data-table/registry-open-link';
import { StatusBadge } from '@/shared/ui/foundation';

export function TaskListTable({
  items,
  embedded = false,
  emptyText = 'Задачи не найдены.',
}: {
  items: TaskItem[];
  embedded?: boolean;
  emptyText?: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className={embedded ? 'page-muted' : 'page-card workspace-surface workspace-empty'}>{emptyText}</div>;
  }

  return (
    <DataTable
      label="Таблица задач"
      className="task-table"
      frameClassName={embedded ? 'task-table-scroll' : 'page-card workspace-surface data-table-shell task-table-scroll'}
    >
        <thead>
          <tr>
            <th scope="col">Задача</th>
            <th scope="col">Связи</th>
            <th scope="col">Исполнители</th>
            <th scope="col">Прогресс</th>
            <th scope="col">Срок</th>
            <th scope="col">Статус</th>
            <th scope="col" aria-label="Открыть полную карточку" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link className="task-table__title" href={`/tasks/${item.id}`}>{item.title}</Link>
                <span className="task-table__meta">{getTaskPriorityLabel(item.priority)} · {getUserDisplayName(item.createdBy)}</span>
              </td>
              <td>
                {item.object ? <Link href={`/objects/${item.object.id}`}>{item.object.name}</Link> : null}
                {item.object && item.oneTimeOrder ? <span className="task-table__meta">+</span> : null}
                {item.oneTimeOrder ? <Link href={`/one-time-orders/${item.oneTimeOrder.id}`}>{item.oneTimeOrder.title}</Link> : null}
                {!item.object && !item.oneTimeOrder ? 'Без привязки' : null}
              </td>
              <td>{item.assignees.filter((user) => user.isActive).map(getUserDisplayName).join(', ')}</td>
              <td>{item.completionProgress.completed} из {item.completionProgress.total}</td>
              <td className={item.isOverdue ? 'task-overdue' : undefined}>
                {formatTaskDeadline(item.dueAt, item.dueTimeSpecified)}
                {item.isOverdue ? <span className="task-table__meta">Просрочено</span> : null}
              </td>
              <td>
                <StatusBadge status={item.status}>{getTaskStatusLabel(item.status)}</StatusBadge>
                {item.requiresConfirmation ? <span className="task-table__meta">С подтверждением</span> : null}
              </td>
              <td className="registry-open-cell"><RegistryOpenLink href={`/tasks/${item.id}`} label={`Открыть задачу ${item.title}`} /></td>
            </tr>
          ))}
        </tbody>
    </DataTable>
  );
}
