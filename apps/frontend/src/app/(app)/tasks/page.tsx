'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useMemo, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listTasks } from '@/entities/task/api/task-client';
import type { TaskListResponse } from '@/entities/task/model/task.types';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskFilters, type TaskFilterValue } from '@/features/task-filters/ui/task-filters';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const EMPTY_RESULT: TaskListResponse = { items: [], page: 1, limit: 20, total: 0, totalPages: 1 };

export default function TasksPage(): React.JSX.Element {
  return <Suspense fallback={<div className="page-card">Загрузка…</div>}><TasksRegistry /></Suspense>;
}

function TasksRegistry(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const [result, setResult] = useState(EMPTY_RESULT);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo<TaskFilterValue>(() => ({
    q: searchParams.get('q') ?? '',
    mode: (searchParams.get('mode') as TaskFilterValue['mode']) ?? 'all',
    status: searchParams.get('status') ?? '',
    overdue: searchParams.get('overdue') === 'true',
    objectId: searchParams.get('objectId') ?? '',
    assigneeUserId: searchParams.get('assigneeUserId') ?? '',
    sortBy: (searchParams.get('sortBy') as TaskFilterValue['sortBy']) ?? 'createdAt',
    sortDirection: (searchParams.get('sortDirection') as TaskFilterValue['sortDirection']) ?? 'desc',
  }), [queryKey, searchParams]);

  useEffect(() => {
    void Promise.all([
      listObjects(),
      listSystemUsers({ purpose: 'task_assignee' }),
    ]).then(([nextObjects, nextUsers]) => {
      setObjects(nextObjects);
      setUsers(nextUsers);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));

    void listTasks({
      q: filters.q || undefined,
      status: filters.status || undefined,
      objectId: filters.objectId || undefined,
      assigneeUserId: filters.assigneeUserId || undefined,
      assignedToMe: filters.mode === 'assigned',
      createdByMe: filters.mode === 'created',
      myObjects: filters.mode === 'objects',
      overdue: filters.overdue,
      sortBy: filters.sortBy,
      sortDirection: filters.sortDirection,
      page,
      limit: 20,
    }).then((next) => {
      if (!cancelled) setResult(next);
    }).catch(() => {
      if (!cancelled) setError('Не удалось загрузить задачи.');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [filters, queryKey, searchParams]);

  const updateQuery = (changes: Record<string, string | boolean | number>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === false || (key === 'mode' && value === 'all')) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in changes)) next.delete('page');
    router.replace(`/tasks${next.toString() ? `?${next.toString()}` : ''}`);
  };

  return (
    <div className="page-stack">
      <div className="task-page-heading">
        <div><PageTitle title="Задачи" /><div className="page-muted">{result.total} доступных задач</div></div>
        <Link className="task-primary-link" href="/tasks/new">Создать задачу</Link>
      </div>
      <TaskFilters value={filters} objects={objects} users={users} onChange={updateQuery} />
      {isLoading ? <div className="page-card">Загрузка…</div> : error ? (
        <div className="page-card task-error" role="alert">{error}</div>
      ) : <TaskListTable items={result.items} />}
      {!isLoading && result.totalPages > 1 ? (
        <div className="task-pagination" aria-label="Пагинация задач">
          <button type="button" disabled={result.page <= 1} onClick={() => updateQuery({ page: result.page - 1 })}>Назад</button>
          <span>Страница {result.page} из {result.totalPages}</span>
          <button type="button" disabled={result.page >= result.totalPages} onClick={() => updateQuery({ page: result.page + 1 })}>Далее</button>
        </div>
      ) : null}
    </div>
  );
}
