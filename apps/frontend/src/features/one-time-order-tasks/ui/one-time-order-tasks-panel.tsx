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
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Button, Field, Stack } from '@/shared/ui/foundation';

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
    linkToObject: boolean;
    dueDate: string;
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
  const [dueDate, setDueDate] = useState('');
  const [linkToObject, setLinkToObject] = useState(Boolean(linkedObject));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const toggleAssignee = (userId: string): void => {
    setAssigneeUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  return (
    <Stack gap="lg">
      <div className="page-card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <div>
            <div className="section-title">Связанные задачи</div>
            <div className="section-subtitle">
              Задачи заказа также доступны в общем реестре задач.
            </div>
          </div>
        </div>
        <TaskListTable items={items} embedded />
      </div>

      {canCreateTask ? (
        <div className="action-row">
          <Button onClick={() => setIsCreating((value) => !value)}>
            {isCreating ? 'Скрыть форму' : 'Добавить задачу'}
          </Button>
        </div>
      ) : null}

      {canCreateTask && isCreating ? (
        <form
          className="page-card"
          onSubmit={async (event) => {
            event.preventDefault();

            setIsSubmitting(true);

            try {
              await onCreate({
                title,
                description: description || undefined,
                priority,
                assigneeUserIds,
                linkToObject,
                dueDate,
              });
              setTitle('');
              setDescription('');
              setPriority('important_not_urgent');
              setAssigneeUserIds([]);
              setDueDate('');
              setIsCreating(false);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="section-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="section-title">Новая задача</div>
              <div className="section-subtitle">
                Задача будет связана с этим заказом и, при выборе, с объектом.
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
            <div className="page-muted" style={{ gridColumn: '1 / -1' }}>
              Связи: текущий разовый заказ
              {linkedObject && linkToObject
                ? ` + объект «${linkedObject.name}»`
                : ''}
              .
            </div>
            {linkedObject ? (
              <label
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={linkToObject}
                  onChange={(event) => setLinkToObject(event.target.checked)}
                />
                Также привязать к объекту «{linkedObject.name}»
              </label>
            ) : null}
            <Field label="Название">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>

            <SearchableSelect
                label="Приоритет"
                value={priority}
                options={TASK_PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                searchable={false}
                clearable={false}
                onChange={(value) =>
                  setPriority(
                    value as
                      | 'urgent_important'
                      | 'urgent_not_important'
                      | 'important_not_urgent'
                      | 'not_important_not_urgent',
                  )
                }
            />

            <Field label="Срок *">
              <DatePicker value={dueDate} onChange={(nextValue) => setDueDate(nextValue)} required />
            </Field>

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
                        border: '1px solid var(--ui-border)',
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
            <Button variant="primary"
              type="submit"
              disabled={
                isSubmitting || !title.trim() || assigneeUserIds.length === 0
              }
            >
              {isSubmitting ? 'Создаем...' : 'Создать задачу'}
            </Button>
          </div>
        </form>
      ) : null}
    </Stack>
  );
}
