import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import {
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';

export function TaskSummaryCard({
  item,
}: {
  item: TaskItem;
}): React.JSX.Element {
  return (
    <div
      className="page-card hero-card"
      style={{ display: 'grid', gap: 18 }}
    >
      <div className="section-header">
        <div>
          <div className="hero-title">{item.title}</div>
          <div className="hero-meta">
            {item.targetType === 'one_time_order'
              ? `Разовый заказ: ${item.targetName}`
              : item.targetName}
          </div>
        </div>
        <span className="status-pill" data-status={item.status}>
          {getTaskStatusLabel(item.status)}
        </span>
      </div>

      <div className="detail-grid">
        <Field label="Приоритет" value={getTaskPriorityLabel(item.priority)} />
        <Field
          label="Исполнители"
          value={
            item.assignees.map((assignee) => assignee.fullName).join(', ') || '—'
          }
        />
        <Field label="Описание" value={item.description ?? '—'} />
        <Field label="Результат" value={item.resultText ?? '—'} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}
