'use client';

import React, { useEffect, useState } from 'react';

import {
  getTaskById,
  submitTaskResult,
  updateTaskStatus,
} from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import { TaskSummaryCard } from '@/features/task-card/ui/task-summary-card';
import { TaskResultPanel } from '@/features/task-result/ui/task-result-panel';
import {
  TASK_STATUS_OPTIONS,
  getTaskStatusLabel,
} from '@/shared/lib/task-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<TaskItem | null>(null);
  const [taskId, setTaskId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTask = async (id: string): Promise<void> => {
    const response = await getTaskById(id);
    setItem(response);
  };

  useEffect(() => {
    const resolveAndLoad = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const resolved = await params;
        setTaskId(resolved.id);
        await loadTask(resolved.id);
      } catch {
        setError('Не удалось загрузить карточку задачи.');
      } finally {
        setIsLoading(false);
      }
    };

    void resolveAndLoad();
  }, [params]);

  return (
    <>
      <PageTitle title={item ? item.title : 'Карточка задачи'} />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : item ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <TaskSummaryCard item={item} />

          <div className="page-card">
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div>
                <div className="section-title">Статус задачи</div>
                <div className="section-subtitle">
                  Доступные переходы рассчитаны backend rules.
                </div>
              </div>
              <span className="status-pill">{getTaskStatusLabel(item.status)}</span>
            </div>
            {item.capabilities.allowedStatusTransitions.length > 0 ? (
              <div className="action-row">
                {TASK_STATUS_OPTIONS.filter((status) =>
                  item.capabilities.allowedStatusTransitions.includes(
                    status.value,
                  ),
                ).map((status) => (
                <button
                  key={status.value}
                  type="button"
                  onClick={async () => {
                    await updateTaskStatus(taskId, status.value);
                    await loadTask(taskId);
                  }}
                >
                  {status.label}
                </button>
                ))}
              </div>
            ) : (
              <div className="page-muted">
                Для этой задачи сейчас нет доступных ручных смен статуса.
              </div>
            )}
          </div>

          <TaskResultPanel
            initialValue={item.resultText ?? ''}
            canSubmit={item.capabilities.canSubmitResult}
            onSubmit={async (value) => {
              await submitTaskResult(taskId, value);
              await loadTask(taskId);
            }}
          />
        </div>
      ) : (
        <div className="page-card">Задача не найдена.</div>
      )}
    </>
  );
}
