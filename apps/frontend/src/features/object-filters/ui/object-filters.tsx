'use client';

import React from 'react';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { Field } from '@/shared/ui/foundation';

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
      <Field label="Поиск">
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Название, внутреннее имя, адрес"
        />
      </Field>

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
