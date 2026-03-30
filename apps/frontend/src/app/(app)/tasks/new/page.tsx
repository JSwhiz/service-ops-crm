'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createTask } from '@/entities/task/api/task-client';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function NewTaskPage(): React.JSX.Element {
  const router = useRouter();

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'important_not_urgent',
    objectId: '11111111-1111-1111-1111-111111111111',
    assigneeUserIds: '1',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const created = await createTask({
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as
          | 'urgent_important'
          | 'urgent_not_important'
          | 'important_not_urgent'
          | 'not_important_not_urgent',
        objectId: form.objectId,
        assigneeUserIds: form.assigneeUserIds
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });

      router.push(`/tasks/${created.id}`);
    } catch {
      setError('Не удалось создать задачу.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageTitle title="Создать задачу" />

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
            <div style={{ marginBottom: 6 }}>Приоритет</div>
            <select
              value={form.priority}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, priority: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="urgent_important">Срочно / важно</option>
              <option value="urgent_not_important">Срочно / неважно</option>
              <option value="important_not_urgent">Несрочно / важно</option>
              <option value="not_important_not_urgent">Несрочно / неважно</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>ID объекта</div>
            <input
              value={form.objectId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, objectId: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>ID исполнителей через запятую</div>
            <input
              value={form.assigneeUserIds}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assigneeUserIds: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
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
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Создаем...' : 'Создать'}
          </button>
        </div>
      </form>
    </>
  );
}
