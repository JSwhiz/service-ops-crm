'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getAvailabilityLabel } from '@/shared/lib/employee-availability-label';

interface ObjectAttendancePanelProps {
  employees: ObjectEmployeeOption[];
  initialEmployeeIds: string[];
  initialEmployeeFacts: Array<{
    employeeId: string;
    workedHours: number | null;
    ratePolicyType: string | null;
    rateAmount: number;
    rateReason: string | null;
  }>;
  canEditRates: boolean;
  operationDate: string;
  onSave: (payload: {
    operationDate: string;
    employeeIds: string[];
    employeeFacts?: Array<{
      employeeId: string;
      workedHours?: number;
      ratePolicyType?: 'complex_shift' | 'side_job';
      rateAmount?: number;
      rateReason?: string;
      clearRateOverride?: true;
    }>;
  }) => Promise<void>;
}

export function ObjectAttendancePanel({
  employees,
  initialEmployeeIds,
  initialEmployeeFacts,
  canEditRates,
  operationDate,
  onSave,
}: ObjectAttendancePanelProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialEmployeeIds);
  const [workedHoursById, setWorkedHoursById] = useState<Record<string, string>>({});
  const [specialRateById, setSpecialRateById] = useState<Record<string, { type: '' | 'complex_shift' | 'side_job'; amount: string; reason: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeEmployees = useMemo(() => employees ?? [], [employees]);
  const employeeById = useMemo(
    () => new Map(safeEmployees.map((employee) => [employee.id, employee])),
    [safeEmployees],
  );
  const initialFactsById = useMemo(
    () => new Map(initialEmployeeFacts.map((fact) => [fact.employeeId, fact])),
    [initialEmployeeFacts],
  );
  const initialFactsSignature = useMemo(
    () => initialEmployeeFacts
      .map((fact) => `${fact.employeeId}:${fact.workedHours ?? ''}:${fact.ratePolicyType ?? ''}:${fact.rateAmount}:${fact.rateReason ?? ''}`)
      .sort()
      .join('|'),
    [initialEmployeeFacts],
  );

  const getDefaultWorkedHours = useCallback((employeeId: string): string => {
    const standardShiftHours = employeeById.get(employeeId)?.ratePolicy?.standardShiftHours ?? 8;
    return String(standardShiftHours);
  }, [employeeById]);

  useEffect(() => {
    setSelectedIds(initialEmployeeIds);
    setWorkedHoursById((current) => {
      const next = { ...current };
      const selectedIdSet = new Set(initialEmployeeIds);

      for (const employeeId of Object.keys(next)) {
        if (!selectedIdSet.has(employeeId)) delete next[employeeId];
      }

      for (const employeeId of initialEmployeeIds) {
        const savedFact = initialFactsById.get(employeeId);
        next[employeeId] =
          savedFact?.workedHours !== undefined && savedFact?.workedHours !== null
            ? String(savedFact.workedHours)
            : next[employeeId] ?? getDefaultWorkedHours(employeeId);
      }

      return next;
    });
    setSpecialRateById((current) => {
      const next = { ...current };
      const selectedIdSet = new Set(initialEmployeeIds);
      for (const employeeId of Object.keys(next)) if (!selectedIdSet.has(employeeId)) delete next[employeeId];
      for (const employeeId of initialEmployeeIds) {
        const fact = initialFactsById.get(employeeId);
        const savedType = fact?.ratePolicyType === 'complex_shift' || fact?.ratePolicyType === 'side_job' ? fact.ratePolicyType : '';
        next[employeeId] = { type: savedType, amount: savedType ? String(fact?.rateAmount ?? '') : '', reason: savedType ? fact?.rateReason ?? '' : '' };
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

  const toggleEmployee = (employeeId: string): void => {
    setSelectedIds((prev) => {
      if (prev.includes(employeeId)) return prev.filter((id) => id !== employeeId);

      setWorkedHoursById((current) => ({
        ...current,
        [employeeId]: current[employeeId] ?? getDefaultWorkedHours(employeeId),
      }));
      return [...prev, employeeId];
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSave({
        operationDate,
        employeeIds: selectedIds,
        employeeFacts: selectedIds.map((employeeId) => {
          const specialRate = specialRateById[employeeId];
          return {
            employeeId,
            workedHours: Number(workedHoursById[employeeId] || getDefaultWorkedHours(employeeId)) || 8,
            ...(specialRate?.type ? { ratePolicyType: specialRate.type, rateAmount: Number(specialRate.amount), rateReason: specialRate.reason.trim() } : {}),
            ...(!specialRate?.type && (initialFactsById.get(employeeId)?.ratePolicyType === 'complex_shift' || initialFactsById.get(employeeId)?.ratePolicyType === 'side_job') ? { clearRateOverride: true as const } : {}),
          };
        }),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Не удалось сохранить присутствие сотрудников.',
      );
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
        <div className="page-muted">Для объекта пока не задан состав сотрудников.</div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={`record-list ${styles.attendanceList}`}>
            {safeEmployees.map((employee) => (
              <div
                key={employee.id}
                className="record-card"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 8,
                  border: employee.availability.isUnavailable ? '1px solid #ead7d2' : undefined,
                  background: employee.availability.isUnavailable ? '#fbf4f2' : undefined,
                  opacity: employee.availability.isUnavailable && !selectedIds.includes(employee.id) ? 0.75 : 1,
                }}
                title={getAvailabilityLabel(employee.availability) ?? undefined}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                    disabled={employee.availability.isUnavailable && !selectedIds.includes(employee.id)}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{employee.fullName}</span>
                    {!employee.isAssignedToObject ? <span className="status-pill">Подмена</span> : null}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'replacement')
                      .map((item) => (
                        <span key={item.id} className="page-muted">Замещает: {item.counterpartEmployeeName}</span>
                      ))}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'primary')
                      .map((item) => (
                        <span key={item.id} className="page-muted">Замещается: {item.counterpartEmployeeName}</span>
                      ))}
                  </span>
                </label>
                {employee.availability.isUnavailable ? (
                  <div style={{ color: '#80655c', fontSize: 12 }}>{getAvailabilityLabel(employee.availability)}</div>
                ) : null}
                {selectedIds.includes(employee.id) ? (
                  <div style={{ display: 'grid', gridTemplateColumns: canEditRates ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'minmax(160px, 1fr)', alignItems: 'end', gap: 8 }}>
                    <label className="attendance-hours-control">
                      <span>Часы</span>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={workedHoursById[employee.id] ?? getDefaultWorkedHours(employee.id)}
                        onChange={(event) => setWorkedHoursById((current) => ({ ...current, [employee.id]: event.target.value }))}
                      />
                    </label>
                    {canEditRates ? (
                      <label className="attendance-hours-control">
                        <span>Особая ставка на этот выход</span>
                        <select value={specialRateById[employee.id]?.type ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { type: event.target.value as '' | 'complex_shift' | 'side_job', amount: current[employee.id]?.amount ?? '', reason: current[employee.id]?.reason ?? '' } }))}>
                          <option value="">Обычная ставка объекта</option>
                          <option value="complex_shift">Сложный выход</option>
                          <option value="side_job">Подработка</option>
                        </select>
                      </label>
                    ) : null}
                    {canEditRates && specialRateById[employee.id]?.type ? (
                      <>
                        <label className="attendance-hours-control">
                          <span>Сумма за выход, ₽</span>
                        <input type="number" min="0" step="1" value={specialRateById[employee.id]?.amount ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { ...(current[employee.id] ?? { type: 'complex_shift' as const, amount: '', reason: '' }), amount: event.target.value } }))} required />
                        </label>
                        <label className="attendance-hours-control" style={{ gridColumn: '1 / -1' }}>
                          <span>Основание</span>
                          <input type="text" maxLength={1000} value={specialRateById[employee.id]?.reason ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { ...(current[employee.id] ?? { type: 'complex_shift' as const, amount: '', reason: '' }), reason: event.target.value } }))} required />
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {error ? <div className={styles.error} style={{ marginTop: 12 }}>{error}</div> : null}

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
