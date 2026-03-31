'use client';

import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

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
    <div
      className="page-card"
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <label>
        <div style={{ marginBottom: 6 }}>Объект</div>
        <select
          value={selectedObjectId}
          onChange={(event) => onObjectChange(event.target.value)}
          style={{ width: '100%', padding: 10 }}
        >
          {objects.map((object) => (
            <option key={object.id} value={object.id}>
              {object.name} {object.internalName ? `(${object.internalName})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label>
        <div style={{ marginBottom: 6 }}>Год</div>
        <input
          type="number"
          value={selectedYear}
          onChange={(event) => onYearChange(Number(event.target.value))}
          style={{ width: '100%', padding: 10 }}
          min={2024}
          max={2100}
        />
      </label>

      <label>
        <div style={{ marginBottom: 6 }}>Месяц</div>
        <input
          type="number"
          value={selectedMonth}
          onChange={(event) => onMonthChange(Number(event.target.value))}
          style={{ width: '100%', padding: 10 }}
          min={1}
          max={12}
        />
      </label>
    </div>
  );
}
