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
import { StatusBadge, Surface } from '@/shared/ui/foundation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export function TaskSummaryCard({
  item,
  autoCloseSeconds,
}: {
  item: TaskItem;
  autoCloseSeconds: number | null;
}): React.JSX.Element {
  return (
    <Surface padding="md" className={`hero-card ${taskStyles.taskSummary}`}>
      <div className="ui-section-header">
        <div>
          <div className="hero-title">{item.title}</div>
          <div className="hero-meta">Создал(а): {getUserDisplayName(item.createdBy)}</div>
        </div>
        <div className={taskStyles.taskSummaryStatus}>
          <StatusBadge status={item.status}>{getTaskStatusLabel(item.status)}</StatusBadge>
          {item.isOverdue ? <span className="task-overdue">Просрочено</span> : null}
        </div>
      </div>

      <div className={taskStyles.taskProgress} aria-label={`Выполнено ${item.completionProgress.completed} из ${item.completionProgress.total}`}>
        <span style={{ width: `${item.completionProgress.total ? (item.completionProgress.completed / item.completionProgress.total) * 100 : 0}%` }} />
      </div>
      <div className={taskStyles.taskProgressLabel}>Выполнено {item.completionProgress.completed} из {item.completionProgress.total}</div>

      <div className="ui-detail-grid">
        <Field label="Приоритет" value={getTaskPriorityLabel(item.priority)} />
        <Field label="Срок" value={formatTaskDeadline(item.dueAt, item.dueTimeSpecified)} />
        <Field label="Подтверждение" value={item.requiresConfirmation ? 'Требуется' : 'Не требуется'} />
        <Field label="Отчёт" value={getCompletionRequirementLabel(item.completionRequirement)} />
        <div className="ui-detail-field">
          <div className="ui-detail-label">Связи</div>
          <div className={`ui-detail-value ${taskStyles.taskLinks}`}>
            {item.object ? <Link href={`/objects/${item.object.id}`}>{item.object.name}</Link> : null}
            {item.oneTimeOrder ? <Link href={`/one-time-orders/${item.oneTimeOrder.id}`}>{item.oneTimeOrder.title}</Link> : null}
            {!item.object && !item.oneTimeOrder ? 'Без привязки' : null}
          </div>
        </div>
        <Field
          label="Видимость"
          value={{
            all_users: 'Все активные пользователи',
            selected_users: `Выбранные пользователи: ${item.visibleUsers.length}`,
            target_participants: 'Участники связанного объекта или заказа',
            private: 'Только участники задачи',
          }[item.visibilityType]}
        />
      </div>

      {item.description ? <div className={taskStyles.taskDescription}>{item.description}</div> : null}
      {item.status === 'pending_auto_close' && autoCloseSeconds !== null ? (
        <div className={taskStyles.taskCountdown}>Автоматическое завершение через {formatCountdown(autoCloseSeconds)}</div>
      ) : null}
      {item.status === 'cancelled' && item.cancellationReason ? (
        <div className={`${taskStyles.taskAlert} ${taskStyles.taskAlertDanger}`}>Причина отмены: {item.cancellationReason}</div>
      ) : null}
    </Surface>
  );
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="ui-detail-field"><div className="ui-detail-label">{label}</div><div className="ui-detail-value">{value}</div></div>;
}
