import Link from 'next/link';
import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import {
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';

export function TaskListTable({
  items,
  embedded = false,
}: {
  items: TaskItem[];
  embedded?: boolean;
}): React.JSX.Element {
  if (items.length === 0) {
    return embedded ? (
      <div className="page-muted">Задачи не найдены.</div>
    ) : (
      <div className="page-card">
        <div className="page-muted">Задачи не найдены.</div>
      </div>
    );
  }

  return (
    <div className={embedded ? undefined : 'page-card'} style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: 760,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Контур</th>
            <th style={thStyle}>Приоритет</th>
            <th style={thStyle}>Статус</th>
            <th style={thStyle}>Исполнители</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={tdStyle}>
                <Link href={`/tasks/${item.id}`}>{item.title}</Link>
              </td>
              <td style={tdStyle}>
                {item.targetType === 'one_time_order'
                  ? `Разовый заказ: ${item.targetName}`
                  : item.targetName}
              </td>
              <td style={tdStyle}>{getTaskPriorityLabel(item.priority)}</td>
              <td style={tdStyle}>
                <span className="status-pill" data-status={item.status}>
                  {getTaskStatusLabel(item.status)}
                </span>
              </td>
              <td style={tdStyle}>
                {item.assignees.map((assignee) => assignee.fullName).join(', ') || '—'}
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

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  borderBottom: '1px solid #f0f2f5',
  verticalAlign: 'top',
  fontSize: 14,
};
