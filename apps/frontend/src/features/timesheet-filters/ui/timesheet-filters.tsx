'use client';

import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import { Select } from '@/shared/ui/searchable-select/select';
import { Field, Surface } from '@/shared/ui/foundation';

export function TimesheetFilters({
  objects,
  selectedObjectId,
  selectedYear,
  selectedMonth,
  onObjectChange,
  onYearChange,
  onMonthChange,
}: {
  objects: ServiceObject[];
  selectedObjectId: string;
  selectedYear: number;
  selectedMonth: number;
  onObjectChange: (value: string) => void;
  onYearChange: (value: number) => void;
  onMonthChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <Surface padding="md"

      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <Field label="Объект">
        <Select
          value={selectedObjectId}
          onChange={(event) => onObjectChange(event.target.value)}
        >
          {objects.map((object) => (
            <option key={object.id} value={object.id}>
              {object.name} {object.internalName ? `(${object.internalName})` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Год">
        <input
          type="number"
          value={selectedYear}
          onChange={(event) => onYearChange(Number(event.target.value))}
          min={2024}
          max={2100}
        />
      </Field>

      <Field label="Месяц">
        <input
          type="number"
          value={selectedMonth}
          onChange={(event) => onMonthChange(Number(event.target.value))}
          min={1}
          max={12}
        />
      </Field>
    </Surface>
  );
}
