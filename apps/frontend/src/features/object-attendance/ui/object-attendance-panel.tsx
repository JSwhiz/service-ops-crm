'use client';

import React, { useEffect, useMemo, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';

interface ObjectAttendancePanelProps {
  employees: ObjectEmployeeOption[];
  initialEmployeeIds: string[];
  operationDate: string;
  onSave: (payload: {
    operationDate: string;
    employeeIds: string[];
  }) => Promise<void>;
}

export function ObjectAttendancePanel({
  employees,
  initialEmployeeIds,
  operationDate,
  onSave,
}: ObjectAttendancePanelProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialEmployeeIds);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIds(initialEmployeeIds);
  }, [initialEmployeeIds, operationDate]);

  const safeEmployees = useMemo(() => employees ?? [], [employees]);

  const toggleEmployee = (employeeId: string): void => {
    setSelectedIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSave({
        operationDate,
        employeeIds: selectedIds,
      });
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message) {
        setError(caughtError.message);
      } else {
        setError('Не удалось сохранить присутствие сотрудников.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Кто был сегодня на объекте
      </div>

      <div className="page-muted" style={{ marginBottom: 12 }}>
        {operationDate}
      </div>

      {safeEmployees.length === 0 ? (
        <div className="page-muted">
          Для объекта пока не задан состав сотрудников.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 10 }}>
            {safeEmployees.map((employee) => (
              <label
                key={employee.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                />
                <span>{employee.fullName}</span>
              </label>
            ))}
          </div>

          {error ? (
            <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
