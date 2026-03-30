import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';

export function TaskSummaryCard({
  item,
}: {
  item: TaskItem;
}): React.JSX.Element {
  return (
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      <Field label="Название" value={item.title} />
      <Field label="Объект" value={item.objectName} />
      <Field label="Приоритет" value={item.priority} />
      <Field label="Статус" value={item.status} />
      <Field
        label="Исполнители"
        value={item.assignees.map((assignee) => assignee.fullName).join(', ') || '—'}
      />
      <Field label="Описание" value={item.description ?? '—'} />
      <Field label="Результат" value={item.resultText ?? '—'} />
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
    <div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
    </div>
  );
}
