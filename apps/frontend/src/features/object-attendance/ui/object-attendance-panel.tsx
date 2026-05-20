'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';

interface ObjectAttendancePanelProps {
  employees: ObjectEmployeeOption[];
  initialEmployeeIds: string[];
  initialEmployeeFacts: Array<{
    employeeId: string;
    workedHours: number | null;
  }>;
  operationDate: string;
  onSave: (payload: {
    operationDate: string;
    employeeIds: string[];
    employeeFacts?: Array<{
      employeeId: string;
      workedHours?: number;
    }>;
  }) => Promise<void>;
}

export function ObjectAttendancePanel({
  employees,
  initialEmployeeIds,
  initialEmployeeFacts,
  operationDate,
  onSave,
}: ObjectAttendancePanelProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialEmployeeIds);
  const [workedHoursById, setWorkedHoursById] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeEmployees = useMemo(() => employees ?? [], [employees]);
  const employeeById = useMemo(
    () => new Map(safeEmployees.map((employee) => [employee.id, employee])),
    [safeEmployees],
  );
  const initialFactsById = useMemo(
    () =>
      new Map(
        initialEmployeeFacts.map((fact) => [fact.employeeId, fact.workedHours]),
      ),
    [initialEmployeeFacts],
  );
  const initialFactsSignature = useMemo(
    () =>
      initialEmployeeFacts
        .map((fact) => `${fact.employeeId}:${fact.workedHours ?? ''}`)
        .sort()
        .join('|'),
    [initialEmployeeFacts],
  );

  const getDefaultWorkedHours = useCallback((employeeId: string): string => {
    const standardShiftHours =
      employeeById.get(employeeId)?.ratePolicy?.standardShiftHours ?? 8;

    return String(standardShiftHours);
  }, [employeeById]);

  useEffect(() => {
    setSelectedIds(initialEmployeeIds);
    setWorkedHoursById((current) => {
      const next = { ...current };
      const selectedIdSet = new Set(initialEmployeeIds);

      for (const employeeId of Object.keys(next)) {
        if (!selectedIdSet.has(employeeId)) {
          delete next[employeeId];
        }
      }

      for (const employeeId of initialEmployeeIds) {
        const savedWorkedHours = initialFactsById.get(employeeId);

        next[employeeId] =
          savedWorkedHours !== undefined && savedWorkedHours !== null
            ? String(savedWorkedHours)
            : next[employeeId] ?? getDefaultWorkedHours(employeeId);
      }

      return next;
    });
  }, [
    initialEmployeeIds,
    initialFactsById,
    initialFactsSignature,
    operationDate,
    getDefaultWorkedHours,
  ]);

  const getAvailabilityExplanation = (employee: ObjectEmployeeOption): string | null => {
    if (!employee.availability.isUnavailable) {
      return null;
    }

    const modeLabel =
      employee.availability.availabilityMode === 'full_day'
        ? 'Недоступен весь день'
        : 'Недоступен по времени';
    const periodLabel =
      employee.availability.startDate && employee.availability.endDate
        ? `${new Date(employee.availability.startDate).toLocaleString('ru-RU')} — ${new Date(employee.availability.endDate).toLocaleString('ru-RU')}`
        : employee.availability.startDate
          ? `с ${new Date(employee.availability.startDate).toLocaleString('ru-RU')}`
          : 'период не указан';

    return employee.availability.comment
      ? `${modeLabel}. ${periodLabel}. Причина: ${employee.availability.comment}`
      : `${modeLabel}. ${periodLabel}.`;
  };

  const toggleEmployee = (employeeId: string): void => {
    setSelectedIds((prev) => {
      if (prev.includes(employeeId)) {
        return prev.filter((id) => id !== employeeId);
      }

      setWorkedHoursById((current) => ({
        ...current,
        [employeeId]: current[employeeId] ?? getDefaultWorkedHours(employeeId),
      }));
      return [...prev, employeeId];
    });
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
        employeeFacts: selectedIds.map((employeeId) => ({
          employeeId,
          workedHours:
            Number(workedHoursById[employeeId] || getDefaultWorkedHours(employeeId)) ||
            8,
        })),
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
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Кто был сегодня на объекте</div>
          <div className="section-subtitle">{operationDate}</div>
        </div>
      </div>

      {safeEmployees.length === 0 ? (
        <div className="page-muted">
          Для объекта пока не задан состав сотрудников.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="record-list">
            {safeEmployees.map((employee) => (
              <label
                key={employee.id}
                className="record-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: employee.availability.isUnavailable
                    ? '1px solid #f59e0b'
                    : undefined,
                  background: employee.availability.isUnavailable
                    ? '#fffbeb'
                    : undefined,
                  opacity:
                    employee.availability.isUnavailable &&
                    !selectedIds.includes(employee.id)
                      ? 0.75
                      : 1,
                }}
                title={getAvailabilityExplanation(employee) ?? undefined}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                  disabled={
                    employee.availability.isUnavailable &&
                    !selectedIds.includes(employee.id)
                  }
                />
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{employee.fullName}</span>
                    {!employee.isAssignedToObject ? (
                      <span className="status-pill">Подмена</span>
                    ) : null}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'replacement')
                      .map((item) => (
                        <span key={item.id} className="page-muted">
                          Замещает: {item.counterpartEmployeeName}
                        </span>
                      ))}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'primary')
                      .map((item) => (
                        <span key={item.id} className="page-muted">
                          Замещается: {item.counterpartEmployeeName}
                        </span>
                      ))}
                  </div>
                  {employee.availability.isUnavailable ? (
                    <div style={{ color: '#b45309', fontSize: 13 }}>
                      {getAvailabilityExplanation(employee)}
                    </div>
                  ) : null}
                  {selectedIds.includes(employee.id) ? (
                    <label className="attendance-hours-control">
                      <span>Часы</span>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={
                          workedHoursById[employee.id] ??
                          getDefaultWorkedHours(employee.id)
                        }
                        onChange={(event) =>
                          setWorkedHoursById((current) => ({
                            ...current,
                            [employee.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
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
