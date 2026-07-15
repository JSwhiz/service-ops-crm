'use client';

import React, { useState } from 'react';

import type { TaskItem } from '@/entities/task/model/task.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { TASK_PRIORITY_OPTIONS } from '@/shared/lib/task-presentation';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';

export function OneTimeOrderTasksPanel({
  items,
  assigneeOptions,
  canCreateTask,
  linkedObject,
  onCreate,
}: {
  items: TaskItem[];
  assigneeOptions: SystemUserOption[];
  canCreateTask: boolean;
  linkedObject: { id: string; name: string } | null;
  onCreate: (payload: {
    title: string;
    description?: string;
    priority:
      | 'urgent_important'
      | 'urgent_not_important'
      | 'important_not_urgent'
      | 'not_important_not_urgent';
    assigneeUserIds: string[];
  }) => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<
    | 'urgent_important'
    | 'urgent_not_important'
    | 'important_not_urgent'
    | 'not_important_not_urgent'
  >('important_not_urgent');
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleAssignee = (userId: string): void => {
    setAssigneeUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <div>
            <div className="section-title">Связанные задачи</div>
            <div className="section-subtitle">Task flow остается в общем tasks-модуле.</div>
          </div>
        </div>
        <TaskListTable items={items} embedded />
      </div>

      {canCreateTask ? (
        <form
          className="page-card"
          onSubmit={async (event) => {
            event.preventDefault();

            const targetLabel = linkedObject
              ? `заказом и объектом «${linkedObject.name}»`
              : 'заказом';
            if (!window.confirm(`Создать задачу со связью с ${targetLabel}?`)) {
              return;
            }

            setIsSubmitting(true);

            try {
              await onCreate({
                title,
                description: description || undefined,
                priority,
                assigneeUserIds,
              });
              setTitle('');
              setDescription('');
              setPriority('important_not_urgent');
              setAssigneeUserIds([]);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="section-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="section-title">Завести задачу по заказу</div>
              <div className="section-subtitle">
                Быстрый scoped create без выхода из карточки заказа.
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            }}
          >
            <div
              className="page-muted"
              style={{ gridColumn: '1 / -1' }}
            >
              Связи: текущий разовый заказ
              {linkedObject ? ` + объект «${linkedObject.name}»` : ''}.
            </div>
            <label>
              <div style={{ marginBottom: 6 }}>Название</div>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                style={{ width: '100%', padding: 10 }}
                required
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Приоритет</div>
              <select
                value={priority}
                onChange={(event) =>
                  setPriority(
                    event.target.value as
                      | 'urgent_important'
                      | 'urgent_not_important'
                      | 'important_not_urgent'
                      | 'not_important_not_urgent',
                  )
                }
                style={{ width: '100%', padding: 10 }}
              >
                {TASK_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6 }}>Описание</div>
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                style={{ width: '100%', padding: 10, resize: 'vertical' }}
              />
            </label>

            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 8 }}>Исполнители</div>
              {assigneeOptions.length === 0 ? (
                <div className="page-muted">
                  Для этого заказа нет доступных исполнителей.
                </div>
              ) : (
                <div
                  className="local-scroll local-scroll--sm"
                  style={{
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  }}
                >
                  {assigneeOptions.map((user) => (
                    <label
                      key={user.id}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={assigneeUserIds.includes(user.id)}
                        onChange={() => toggleAssignee(user.id)}
                      />
                      <span>
                        {getUserDisplayName(user)}
                        {getUserSecondaryLabel(user) ? (
                          <span className="identity-secondary">
                            {getUserSecondaryLabel(user)}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || assigneeUserIds.length === 0}
            >
              {isSubmitting ? 'Создаем...' : 'Создать задачу'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
