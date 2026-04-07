'use client';

import React from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/api/object-client';

interface ObjectStaffingPanelProps {
  assignedEmployees: ObjectEmployeeOption[];
  directoryEmployees: ObjectEmployeeOption[];
  search: string;
  isSearching: boolean;
  searchError: string | null;
  onSearchChange: (value: string) => void;
  onAdd: (employeeId: string) => Promise<void>;
  onRemove: (employeeId: string) => Promise<void>;
}

export function ObjectStaffingPanel({
  assignedEmployees,
  directoryEmployees,
  search,
  isSearching,
  searchError,
  onSearchChange,
  onAdd,
  onRemove,
}: ObjectStaffingPanelProps): React.JSX.Element {
  const assigned = assignedEmployees ?? [];
  const directory = directoryEmployees ?? [];
  const assignedIds = new Set(assigned.map((employee) => employee.id));

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Состав сотрудников объекта
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}>Поиск сотрудника</div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Введите ФИО сотрудника"
          style={{ width: '100%', padding: 10 }}
        />
      </label>

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Текущий состав</div>

      {assigned.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Сотрудники пока не добавлены.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {assigned.map((employee) => (
            <div
              key={employee.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: 10,
                border: '1px solid #d1d5db',
                borderRadius: 10,
              }}
            >
              <span>{employee.fullName}</span>

              <button type="button" onClick={() => void onRemove(employee.id)}>
                Убрать
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Результаты поиска</div>

      {searchError ? (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>{searchError}</div>
      ) : null}

      {isSearching ? (
        <div className="page-muted">Поиск...</div>
      ) : directory.length === 0 ? (
        <div className="page-muted">Подходящих сотрудников не найдено.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {directory.map((employee) => (
            <div
              key={employee.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: 10,
                border: '1px solid #d1d5db',
                borderRadius: 10,
              }}
            >
              <span>{employee.fullName}</span>

              {assignedIds.has(employee.id) ? (
                <span className="page-muted">Уже в составе</span>
              ) : (
                <button type="button" onClick={() => void onAdd(employee.id)}>
                  Добавить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
