'use client';

import React, { useMemo, useState } from 'react';

function getLocalDateIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Не удалось сохранить присутствие сотрудников.';
}

export function ObjectAttendancePanel({
  employees,
  onSave,
}: {
  employees: Array<{
    id: string;
    fullName: string;
  }>;
  onSave: (payload: {
    operationDate: string;
    employeeIds: string[];
  }) => Promise<void>;
}): React.JSX.Element {
  const today = useMemo(() => getLocalDateIso(), []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const toggleEmployee = (employeeId: string): void => {
    setSelectedIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  };

  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Кто был сегодня на объекте
      </div>

      <div style={{ color: '#6b7280', marginBottom: 12 }}>{today}</div>

      {employees.length === 0 ? (
        <div style={{ color: '#6b7280' }}>
          Для объекта пока не задан состав сотрудников.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {employees.map((employee) => (
            <label
              key={employee.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: 10,
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
      )}

      {error ? (
        <div style={{ marginTop: 12, color: '#b91c1c', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div style={{ marginTop: 12, color: '#15803d' }}>
          {successMessage}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          disabled={isSaving || employees.length === 0}
          onClick={async () => {
            setIsSaving(true);
            setError(null);
            setSuccessMessage(null);

            try {
              await onSave({
                operationDate: today,
                employeeIds: selectedIds,
              });
              setSuccessMessage('Присутствие сотрудников сохранено.');
            } catch (error: unknown) {
              setError(getErrorMessage(error));
            } finally {
              setIsSaving(false);
            }
          }}
        >
          {isSaving ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
