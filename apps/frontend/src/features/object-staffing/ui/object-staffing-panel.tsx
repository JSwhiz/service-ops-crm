'use client';

import React, { useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object-operations.types';

interface ObjectStaffingPanelProps {
  currentEmployees: ObjectEmployeeOption[];
  foundEmployees: ObjectEmployeeOption[];
  search: string;
  onSearchChange: (value: string) => void;
  onAdd: (employeeId: string) => Promise<void>;
  onRemove: (employeeId: string) => Promise<void>;
}

export function ObjectStaffingPanel({
  currentEmployees,
  foundEmployees,
  search,
  onSearchChange,
  onAdd,
  onRemove,
}: ObjectStaffingPanelProps): React.JSX.Element {
  const [pendingEmployeeId, setPendingEmployeeId] = useState<string | null>(null);

  const currentIds = new Set(currentEmployees.map((item) => item.id));

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Состав сотрудников объекта
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}>Поиск сотрудника</div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Начните вводить ФИО"
          style={{ width: '100%', padding: 10 }}
        />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Текущий состав</div>

          {currentEmployees.length === 0 ? (
            <div className="page-muted">
              Для объекта пока не задан состав сотрудников.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {currentEmployees.map((employee) => (
                <div
                  key={employee.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    border: '1px solid #d1d5db',
                    borderRadius: 10,
                  }}
                >
                  <span>{employee.fullName}</span>
                  <button
                    type="button"
                    disabled={pendingEmployeeId === employee.id}
                    onClick={async () => {
                      setPendingEmployeeId(employee.id);
                      try {
                        await onRemove(employee.id);
                      } finally {
                        setPendingEmployeeId(null);
                      }
                    }}
                  >
                    Убрать
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Результаты поиска</div>

          {foundEmployees.length === 0 ? (
            <div className="page-muted">Сотрудники не найдены.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {foundEmployees.map((employee) => {
                const alreadyInObject = currentIds.has(employee.id);

                return (
                  <div
                    key={employee.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: 10,
                      border: '1px solid #d1d5db',
                      borderRadius: 10,
                    }}
                  >
                    <span>{employee.fullName}</span>
                    <button
                      type="button"
                      disabled={alreadyInObject || pendingEmployeeId === employee.id}
                      onClick={async () => {
                        setPendingEmployeeId(employee.id);
                        try {
                          await onAdd(employee.id);
                        } finally {
                          setPendingEmployeeId(null);
                        }
                      }}
                    >
                      {alreadyInObject ? 'Уже добавлен' : 'Добавить'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
