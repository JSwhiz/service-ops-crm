import Link from 'next/link';
import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatTaskDeadline,
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';

export function TaskListTable({ items, embedded = false }: { items: TaskItem[]; embedded?: boolean }): React.JSX.Element {
  if (items.length === 0) {
    return <div className={embedded ? 'page-muted' : 'page-card workspace-surface workspace-empty'}>Задачи не найдены.</div>;
  }

  return (
    <div className={embedded ? 'task-table-scroll' : 'page-card workspace-surface data-table-shell task-table-scroll'}>
      <table className="task-table">
        <thead>
          <tr>
            <th>Задача</th>
            <th>Связи</th>
            <th>Исполнители</th>
            <th>Прогресс</th>
            <th>Срок</th>
            <th>Статус</th>
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
                <span className="status-pill" data-status={item.status}>{getTaskStatusLabel(item.status)}</span>
                {item.requiresConfirmation ? <span className="task-table__meta">С подтверждением</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
