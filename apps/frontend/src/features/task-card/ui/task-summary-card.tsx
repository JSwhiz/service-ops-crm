import Link from 'next/link';
import React from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatTaskDeadline,
  getCompletionRequirementLabel,
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';

export function TaskSummaryCard({
  item,
  autoCloseSeconds,
}: {
  item: TaskItem;
  autoCloseSeconds: number | null;
}): React.JSX.Element {
  return (
    <div className="page-card hero-card task-summary">
      <div className="section-header">
        <div>
          <div className="hero-title">{item.title}</div>
          <div className="hero-meta">Создал(а): {getUserDisplayName(item.createdBy)}</div>
        </div>
        <div className="task-summary__status">
          <span className="status-pill" data-status={item.status}>{getTaskStatusLabel(item.status)}</span>
          {item.isOverdue ? <span className="task-overdue">Просрочено</span> : null}
        </div>
      </div>

      <div className="task-progress" aria-label={`Выполнено ${item.completionProgress.completed} из ${item.completionProgress.total}`}>
        <span style={{ width: `${item.completionProgress.total ? (item.completionProgress.completed / item.completionProgress.total) * 100 : 0}%` }} />
      </div>
      <div className="task-progress__label">Выполнено {item.completionProgress.completed} из {item.completionProgress.total}</div>

      <div className="detail-grid">
        <Field label="Приоритет" value={getTaskPriorityLabel(item.priority)} />
        <Field label="Срок" value={formatTaskDeadline(item.dueAt, item.dueTimeSpecified)} />
        <Field label="Подтверждение" value={item.requiresConfirmation ? 'Требуется' : 'Не требуется'} />
        <Field label="Отчёт" value={getCompletionRequirementLabel(item.completionRequirement)} />
        <div className="detail-field">
          <div className="detail-label">Связи</div>
          <div className="detail-value task-links">
            {item.object ? <Link href={`/objects/${item.object.id}`}>{item.object.name}</Link> : null}
            {item.oneTimeOrder ? <Link href={`/one-time-orders/${item.oneTimeOrder.id}`}>{item.oneTimeOrder.title}</Link> : null}
            {!item.object && !item.oneTimeOrder ? 'Без привязки' : null}
          </div>
        </div>
        <Field
          label="Видимость"
          value={item.visibilityMode === 'scope' ? 'По рабочему контуру' : `Выбранные пользователи: ${item.visibleUsers.length}`}
        />
      </div>

      {item.description ? <div className="task-description">{item.description}</div> : null}
      {item.status === 'pending_auto_close' && autoCloseSeconds !== null ? (
        <div className="task-countdown">Автоматическое завершение через {formatCountdown(autoCloseSeconds)}</div>
      ) : null}
      {item.status === 'cancelled' && item.cancellationReason ? (
        <div className="task-alert task-alert--danger">Причина отмены: {item.cancellationReason}</div>
      ) : null}
    </div>
  );
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="detail-field"><div className="detail-label">{label}</div><div className="detail-value">{value}</div></div>;
}
