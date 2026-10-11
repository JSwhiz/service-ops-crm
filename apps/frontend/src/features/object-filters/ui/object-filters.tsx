'use client';

import React from 'react';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

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

      <div>
        <SearchableSelect
          label="Статус"
          value={status}
          onChange={onStatusChange}
          options={[
            { value: '', label: 'Все' },
            { value: 'active', label: 'Активный' },
            { value: 'frozen', label: 'Заморожен' },
            { value: 'archived', label: 'Архив' },
          ]}
          searchable={false}
          clearable={false}
          viewportAware
        />
      </div>
    </div>
  );
}
