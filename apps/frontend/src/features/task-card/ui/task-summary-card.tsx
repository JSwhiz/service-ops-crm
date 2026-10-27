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
import { FactStrip, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export function TaskSummaryCard({
  item,
  autoCloseSeconds,
}: {
  item: TaskItem;
  autoCloseSeconds: number | null;
}): React.JSX.Element {
  return (
    <Surface as="section" padding="md" className={taskStyles.taskSummary} aria-labelledby="task-title">
      <div className="ui-section-header">
        <div>
          <h1 id="task-title" className={taskStyles.taskTitle}>{item.title}</h1>
          <div className="ui-section-subtitle">Создал(а): {getUserDisplayName(item.createdBy)}</div>
        </div>
        <div className={taskStyles.taskSummaryStatus}>
          <StatusBadge status={item.status}>{getTaskStatusLabel(item.status)}</StatusBadge>
          {item.isOverdue ? <StatusBadge tone="danger">Просрочено</StatusBadge> : null}
        </div>
      </div>

      <div className={taskStyles.taskProgress} aria-label={`Выполнено ${item.completionProgress.completed} из ${item.completionProgress.total}`}>
        <span style={{ width: `${item.completionProgress.total ? (item.completionProgress.completed / item.completionProgress.total) * 100 : 0}%` }} />
      </div>
      <div className={taskStyles.taskProgressLabel}>Выполнено {item.completionProgress.completed} из {item.completionProgress.total}</div>

      <FactStrip items={[
        { label: 'Срок', value: formatTaskDeadline(item.dueAt, item.dueTimeSpecified) },
        { label: 'Приоритет', value: getTaskPriorityLabel(item.priority) },
        { label: 'Подтверждение', value: item.requiresConfirmation ? 'Требуется' : 'Не требуется' },
        { label: 'Отчёт', value: getCompletionRequirementLabel(item.completionRequirement) },
      ]} />
      <div className={taskStyles.taskContext}>
        <Stack gap="xs">
          <span className="ui-detail-label">Связи</span>
          <div className={taskStyles.taskLinks}>
            {item.object ? <Link href={`/objects/${item.object.id}`}>{item.object.name}</Link> : null}
            {item.oneTimeOrder ? <Link href={`/one-time-orders/${item.oneTimeOrder.id}`}>{item.oneTimeOrder.title}</Link> : null}
            {!item.object && !item.oneTimeOrder ? 'Без привязки' : null}
          </div>
        </Stack>
        <Stack gap="xs">
          <span className="ui-detail-label">Видимость</span>
          <span>{{
            all_users: 'Все активные пользователи',
            selected_users: `Выбранные пользователи: ${item.visibleUsers.length}`,
            target_participants: 'Участники связанного объекта или заказа',
            private: 'Только участники задачи',
          }[item.visibilityType]}</span>
        </Stack>
      </div>

      <div className={taskStyles.taskDescription}>
        <h2 className="ui-section-title">Описание задачи</h2>
        <p>{item.description || 'Описание не добавлено.'}</p>
      </div>
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
