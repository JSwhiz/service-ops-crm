import Link from 'next/link';
import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';

export function TaskListTable({
  items,
}: {
  items: TaskItem[];
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="page-card">
        <div className="page-muted">Задачи не найдены.</div>
      </div>
    );
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
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
            <th style={thStyle}>Объект</th>
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
              <td style={tdStyle}>{item.objectName}</td>
              <td style={tdStyle}>{renderPriority(item.priority)}</td>
              <td style={tdStyle}>{renderStatus(item.status)}</td>
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

function renderPriority(priority: string): string {
  switch (priority) {
    case 'urgent_important':
      return 'Срочно / важно';
    case 'urgent_not_important':
      return 'Срочно / неважно';
    case 'important_not_urgent':
      return 'Несрочно / важно';
    case 'not_important_not_urgent':
      return 'Несрочно / неважно';
    default:
      return priority;
  }
}

function renderStatus(status: string): string {
  switch (status) {
    case 'assigned':
      return 'Назначена';
    case 'in_progress':
      return 'В работе';
    case 'partially_completed':
      return 'Частично выполнена';
    case 'awaiting_confirmation':
      return 'Ожидает подтверждения';
    case 'returned_to_work':
      return 'Возвращена в работу';
    case 'closed':
      return 'Закрыта';
    default:
      return status;
  }
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
