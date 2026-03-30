'use client';

import React from 'react';

interface ObjectFiltersProps {
  search: string;
  status: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}

export function ObjectFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: ObjectFiltersProps): React.JSX.Element {
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
          placeholder="Название, внутреннее имя, адрес"
          style={{ width: '100%', padding: 10 }}
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
          <option value="active">Активный</option>
          <option value="frozen">Заморожен</option>
          <option value="archived">Архив</option>
        </select>
      </label>
    </div>
  );
}
