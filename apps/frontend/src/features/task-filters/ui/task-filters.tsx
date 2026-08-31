'use client';

import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { TASK_STATUS_OPTIONS } from '@/shared/lib/task-presentation';

export interface TaskFilterValue {
  q: string;
  mode: 'all' | 'assigned' | 'created' | 'objects';
  status: string;
  overdue: boolean;
  objectId: string;
  assigneeUserId: string;
  sortBy: 'createdAt' | 'updatedAt' | 'dueAt' | 'title';
  sortDirection: 'asc' | 'desc';
}

export function TaskFilters({
  value,
  objects,
  users,
  onChange,
}: {
  value: TaskFilterValue;
  objects: ServiceObject[];
  users: SystemUserOption[];
  onChange: (next: Partial<TaskFilterValue>) => void;
}): React.JSX.Element {
  return (
    <div className="page-card workspace-surface filter-panel task-filters">
      <label className="task-field task-field--search">
        <span>Поиск</span>
        <input
          type="search"
          value={value.q}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder="Задача, объект, автор или исполнитель"
        />
      </label>
      <label className="task-field">
        <span>Контур</span>
        <select
          value={value.mode}
          onChange={(event) => onChange({ mode: event.target.value as TaskFilterValue['mode'] })}
        >
          <option value="all">Все доступные</option>
          <option value="assigned">Мои задачи</option>
          <option value="created">Созданные мной</option>
          <option value="objects">Мои объекты</option>
        </select>
      </label>
      <label className="task-field">
        <span>Статус</span>
        <select value={value.status} onChange={(event) => onChange({ status: event.target.value })}>
          <option value="">Все статусы</option>
          {TASK_STATUS_OPTIONS.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
      </label>
      <label className="task-field">
        <span>Объект</span>
        <select value={value.objectId} onChange={(event) => onChange({ objectId: event.target.value })}>
          <option value="">Все объекты</option>
          {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
        </select>
      </label>
      <label className="task-field">
        <span>Исполнитель</span>
        <select
          value={value.assigneeUserId}
          onChange={(event) => onChange({ assigneeUserId: event.target.value })}
        >
          <option value="">Все исполнители</option>
          {users.map((user) => <option key={user.id} value={user.id}>{getUserDisplayName(user)}</option>)}
        </select>
      </label>
      <label className="task-field">
        <span>Сортировка</span>
        <select
          value={`${value.sortBy}:${value.sortDirection}`}
          onChange={(event) => {
            const [sortBy, sortDirection] = event.target.value.split(':') as [
              TaskFilterValue['sortBy'],
              TaskFilterValue['sortDirection'],
            ];
            onChange({ sortBy, sortDirection });
          }}
        >
          <option value="createdAt:desc">Сначала новые</option>
          <option value="updatedAt:desc">Недавно изменённые</option>
          <option value="dueAt:asc">Ближайший срок</option>
          <option value="title:asc">По названию</option>
        </select>
      </label>
      <label className="task-check task-filters__overdue">
        <input
          type="checkbox"
          checked={value.overdue}
          onChange={(event) => onChange({ overdue: event.target.checked })}
        />
        Только просроченные
      </label>
    </div>
  );
}
