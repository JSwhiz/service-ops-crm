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
import type { TaskFilterValue } from '@/features/task-filters/ui/task-filters';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { TASK_STATUS_OPTIONS } from '@/shared/lib/task-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';

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
  const [objectFilterActive, setObjectFilterActive] = useState(false);
  const [assigneeFilterActive, setAssigneeFilterActive] = useState(false);
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
    setObjectFilterActive(Boolean(filters.objectId));
  }, [filters.objectId]);
  useEffect(() => {
    setAssigneeFilterActive(Boolean(filters.assigneeUserId));
  }, [filters.assigneeUserId]);

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

  const filterOptions = {
    mode: [
      { value: 'assigned', label: 'Мои задачи' },
      { value: 'created', label: 'Созданные мной' },
      { value: 'objects', label: 'Мои объекты' },
    ],
    status: TASK_STATUS_OPTIONS.map(({ value, label }) => ({ value, label })),
    object: objects.map((object) => ({ value: object.id, label: object.name })),
    assignee: users.map((user) => ({ value: user.id, label: getUserDisplayName(user) })),
    overdue: [{ value: 'true', label: 'Только просроченные' }],
    sort: [
      { value: 'createdAt:desc', label: 'Сначала новые' },
      { value: 'updatedAt:desc', label: 'Недавно изменённые' },
      { value: 'dueAt:asc', label: 'Ближайший срок' },
      { value: 'title:asc', label: 'По названию' },
    ],
  };
  const selectedAssignee = users.find((user) => user.id === filters.assigneeUserId);

  const activeFilters = [
    filters.mode !== 'all' ? { id: 'mode', label: 'Контур', value: filters.mode, options: filterOptions.mode, onChange: (value: string) => updateQuery({ mode: value }), onRemove: () => updateQuery({ mode: 'all' }) } : null,
    filters.status ? { id: 'status', label: 'Статус', value: filters.status, options: filterOptions.status, onChange: (value: string) => updateQuery({ status: value }), onRemove: () => updateQuery({ status: '' }) } : null,
    objectFilterActive || filters.objectId ? { id: 'object', label: 'Объект', value: filters.objectId, options: filterOptions.object, onChange: (value: string) => updateQuery({ objectId: value }), onRemove: () => { setObjectFilterActive(false); updateQuery({ objectId: '' }); }, customControl: <SearchableSelect label="Объект" hideLabel value={filters.objectId} options={filterOptions.object} placeholder="Все объекты" searchPlaceholder="Введите название объекта" minimumSearchLength={2} searchPromptText="Введите не менее 2 символов, чтобы найти объект" searchInputVariant="registry" onChange={(value) => updateQuery({ objectId: value })} /> } : null,
    assigneeFilterActive || filters.assigneeUserId ? { id: 'assignee', label: 'Исполнитель', value: filters.assigneeUserId, options: selectedAssignee ? [{ value: selectedAssignee.id, label: getUserDisplayName(selectedAssignee) }] : [], onChange: (value: string) => updateQuery({ assigneeUserId: value }), onRemove: () => { setAssigneeFilterActive(false); updateQuery({ assigneeUserId: '' }); }, customControl: <SearchableSelect label="Исполнитель" hideLabel value={filters.assigneeUserId} options={filterOptions.assignee} selectedOption={selectedAssignee ? { value: selectedAssignee.id, label: getUserDisplayName(selectedAssignee) } : null} placeholder="Все исполнители" searchPlaceholder="Введите имя исполнителя" minimumSearchLength={2} searchPromptText="Введите не менее 2 символов, чтобы найти исполнителя" searchInputVariant="registry" onChange={(value) => updateQuery({ assigneeUserId: value })} /> } : null,
    filters.overdue ? { id: 'overdue', label: 'Срок', value: 'true', options: filterOptions.overdue, onChange: () => undefined, onRemove: () => updateQuery({ overdue: false }) } : null,
    (filters.sortBy !== 'createdAt' || filters.sortDirection !== 'desc') ? { id: 'sort', label: 'Сортировка', value: `${filters.sortBy}:${filters.sortDirection}`, options: filterOptions.sort, onChange: (value: string) => { const [sortBy, sortDirection] = value.split(':') as [TaskFilterValue['sortBy'], TaskFilterValue['sortDirection']]; updateQuery({ sortBy, sortDirection }); }, onRemove: () => updateQuery({ sortBy: 'createdAt', sortDirection: 'desc' }) } : null,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);

  const availableFilters = [
    filters.mode === 'all' ? { id: 'mode', label: 'Контур', options: filterOptions.mode, onAdd: (value: string) => updateQuery({ mode: value }) } : null,
    !filters.status ? { id: 'status', label: 'Статус', options: filterOptions.status, onAdd: (value: string) => updateQuery({ status: value }) } : null,
    !objectFilterActive && !filters.objectId ? { id: 'object', label: 'Объект', options: [{ value: 'object', label: 'Выбрать объект' }], onAdd: () => setObjectFilterActive(true) } : null,
    !assigneeFilterActive && !filters.assigneeUserId ? { id: 'assignee', label: 'Исполнитель', options: [{ value: 'assignee', label: 'Выбрать исполнителя' }], onAdd: () => setAssigneeFilterActive(true) } : null,
    !filters.overdue ? { id: 'overdue', label: 'Срок', options: filterOptions.overdue, onAdd: () => updateQuery({ overdue: true }) } : null,
    filters.sortBy === 'createdAt' && filters.sortDirection === 'desc' ? { id: 'sort', label: 'Сортировка', options: filterOptions.sort, onAdd: (value: string) => { const [sortBy, sortDirection] = value.split(':') as [TaskFilterValue['sortBy'], TaskFilterValue['sortDirection']]; updateQuery({ sortBy, sortDirection }); } } : null,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);

  return (
    <div className="page-stack workspace-page task-registry">
      <RegistryToolbar
        searchValue={filters.q}
        searchLabel="Поиск по задачам"
        searchPlaceholder="Задача, объект, автор или исполнитель"
        onSearchChange={(value) => updateQuery({ q: value })}
        activeFilters={activeFilters}
        availableFilters={availableFilters}
        actions={<Link className="button-link button-link--primary" href="/tasks/new">Создать задачу</Link>}
      />
      {isLoading ? <div className="page-card">Загрузка…</div> : error ? (
        <div className="page-card task-error" role="alert">{error}</div>
      ) : <TaskListTable items={result.items} />}
      {!isLoading && !error ? <TablePagination page={result.page} totalPages={result.totalPages} label="Страницы задач"
        summary={result.total > 0 ? `Показано ${(result.page - 1) * result.limit + 1}–${Math.min(result.page * result.limit, result.total)} из ${result.total}` : 'Задачи не найдены'}
        onPageChange={(page) => updateQuery({ page })} /> : null}
    </div>
  );
}
