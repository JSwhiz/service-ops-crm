'use client';

import React from 'react';

interface TaskFiltersProps {
  search: string;
  status: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}

export function TaskFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: TaskFiltersProps): React.JSX.Element {
  return (
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <label>
        <div style={{ marginBottom: 6 }}>Поиск</div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          style={{ width: '100%', padding: 10 }}
          placeholder="Название или описание"
        />
      </label>

      <label>
        <div style={{ marginBottom: 6 }}>Статус</div>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          style={{ width: '100%', padding: 10 }}
        >
          <option value="">Все</option>
          <option value="assigned">Назначена</option>
          <option value="in_progress">В работе</option>
          <option value="partially_completed">Частично выполнена</option>
          <option value="awaiting_confirmation">Ожидает подтверждения</option>
          <option value="returned_to_work">Возвращена в работу</option>
          <option value="closed">Закрыта</option>
        </select>
      </label>
    </div>
  );
}
