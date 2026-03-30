'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { listTasks } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import { TaskFilters } from '@/features/task-filters/ui/task-filters';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TasksPage(): React.JSX.Element {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listTasks({
          search: search || undefined,
          status: status || undefined,
        });
        setItems(response);
      } catch {
        setError('Не удалось загрузить задачи.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [search, status]);

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <PageTitle title="Задачи" />
        <Link href="/tasks/new">Создать задачу</Link>
      </div>

      <TaskFilters
        search={search}
        status={status}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
      />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <TaskListTable items={items} />
      )}
    </>
  );
}
