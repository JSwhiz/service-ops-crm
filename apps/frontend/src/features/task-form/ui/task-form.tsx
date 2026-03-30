'use client';

import React, { useMemo, useState } from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TASK_PRIORITY_OPTIONS } from '@/shared/lib/task-presentation';

export function TaskForm({
  objects,
  users,
  onSubmit,
}: {
  objects: ServiceObject[];
  users: SystemUserOption[];
  onSubmit: (payload: {
    title: string;
    description?: string;
    priority:
      | 'urgent_important'
      | 'urgent_not_important'
      | 'important_not_urgent'
      | 'not_important_not_urgent';
    objectId: string;
    assigneeUserIds: string[];
  }) => Promise<void>;
}): React.JSX.Element {
  const defaultObjectId = objects[0]?.id ?? '';
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'important_not_urgent',
    objectId: defaultObjectId,
    assigneeUserIds: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeUsers = useMemo(
    () => users.filter((user) => user.isActive),
    [users],
  );

  const handleToggleUser = (userId: string): void => {
    setForm((prev) => ({
      ...prev,
      assigneeUserIds: prev.assigneeUserIds.includes(userId)
        ? prev.assigneeUserIds.filter((id) => id !== userId)
        : [...prev.assigneeUserIds, userId],
    }));
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as
          | 'urgent_important'
          | 'urgent_not_important'
          | 'important_not_urgent'
          | 'not_important_not_urgent',
        objectId: form.objectId,
        assigneeUserIds: form.assigneeUserIds,
      });
    } catch {
      setError('Не удалось создать задачу.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="page-card" onSubmit={handleSubmit}>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <label>
          <div style={{ marginBottom: 6 }}>Название</div>
          <input
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
            required
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Объект</div>
          <select
            value={form.objectId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, objectId: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
            required
          >
            {objects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name} {object.internalName ? `(${object.internalName})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Приоритет</div>
          <select
            value={form.priority}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, priority: event.target.value }))
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
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            rows={5}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ marginBottom: 8 }}>Исполнители</div>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {activeUsers.map((user) => (
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
                  checked={form.assigneeUserIds.includes(user.id)}
                  onChange={() => handleToggleUser(user.id)}
                />
                <span>
                  {user.fullName} ({user.login})
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button
          type="submit"
          disabled={isSubmitting || form.assigneeUserIds.length === 0}
        >
          {isSubmitting ? 'Создаем...' : 'Создать задачу'}
        </button>
      </div>
    </form>
  );
}
