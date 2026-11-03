'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import styles from './object-attendance.module.css';
import { getAvailabilityLabel } from '@/shared/lib/employee-availability-label';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, Badge, Button, Surface } from '@/shared/ui/foundation';
import { ObjectSubstitutionPanel } from './object-substitution-panel';
import type { CompensationMutationResult } from '@/entities/object/model/object-compensation.types';

interface ObjectAttendancePanelProps {
  objectId?: string;
  onSubstitutionSaved?: () => Promise<void>;
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
  canAddExtraShift?: boolean;
  readOnlyReason?: string;
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
  }) => Promise<void | CompensationMutationResult>;
}

export function ObjectAttendancePanel({
  objectId,
  onSubstitutionSaved,
  employees,
  initialEmployeeIds,
  initialEmployeeFacts,
  canEditRates,
  canAddExtraShift = false,
  readOnlyReason,
  operationDate,
  onSave,
}: ObjectAttendancePanelProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialEmployeeIds);
  const [workedHoursById, setWorkedHoursById] = useState<Record<string, string>>({});
  const [specialRateById, setSpecialRateById] = useState<Record<string, { type: '' | 'complex_shift' | 'side_job'; amount: string; reason: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compensationResult, setCompensationResult] = useState<CompensationMutationResult | null>(null);
  useEffect(() => { setCompensationResult(null); }, [operationDate, objectId]);
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
    if (readOnlyReason || isSubmitting || compensationResult?.status === 'pending') return;
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await onSave({
        operationDate,
        employeeIds: selectedIds,
        employeeFacts: selectedIds.map((employeeId) => {
          const specialRate = specialRateById[employeeId];
          return {
            employeeId,
            workedHours: Number(workedHoursById[employeeId] || getDefaultWorkedHours(employeeId)),
            ...(specialRate?.type && (canEditRates || specialRate.type === 'side_job') ? { ratePolicyType: specialRate.type, rateAmount: Number(specialRate.amount), rateReason: specialRate.reason.trim() } : {}),
            ...(canEditRates && !specialRate?.type && (initialFactsById.get(employeeId)?.ratePolicyType === 'complex_shift' || initialFactsById.get(employeeId)?.ratePolicyType === 'side_job') ? { clearRateOverride: true as const } : {}),
          };
        }),
      });
      if (result) setCompensationResult(result);
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
    <Surface padding="md">
      <div className={`ui-section-header ${styles.header}`}>
        <div className={styles.headerCopy}>
          <div className="ui-section-title">Кто был сегодня на объекте</div>
          <div className="ui-section-subtitle">{new Date(`${operationDate}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}</div>
        </div>
      </div>

      {readOnlyReason ? <Alert tone="info">{readOnlyReason}</Alert> : null}

      {objectId && onSubstitutionSaved ? <ObjectSubstitutionPanel key={objectId} objectId={objectId} employees={safeEmployees} operationDate={operationDate} onSaved={onSubstitutionSaved} /> : null}
      {safeEmployees.length === 0 ? (
        <div className="ui-text-muted">Для объекта пока не задан состав сотрудников.</div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={`record-list ${styles.attendanceList}`}>
            {safeEmployees.map((employee) => (
              <Surface padding="sm"
                key={employee.id}
                className={`${styles.employeeCard} ${employee.availability.isUnavailable ? styles.unavailable : ''} ${employee.availability.isUnavailable && !selectedIds.includes(employee.id) ? styles.unselectedUnavailable : ''}`}
                title={getAvailabilityLabel(employee.availability) ?? undefined}
              >
                <label className={styles.employeeLabel}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                    disabled={!!readOnlyReason || isSubmitting || (employee.availability.isUnavailable && !selectedIds.includes(employee.id))}
                  />
                  <span className={styles.employeeIdentity}>
                    <span className={styles.employeeName}>{employee.fullName}</span>
                    {!employee.isAssignedToObject ? <Badge>Подмена</Badge> : null}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'replacement')
                      .map((item) => (
                        <span key={item.id} className="ui-text-muted">Замещает: {item.counterpartEmployeeName}</span>
                      ))}
                    {employee.activeSubstitutions
                      .filter((item) => item.role === 'primary')
                      .map((item) => (
                        <span key={item.id} className="ui-text-muted">Замещается: {item.counterpartEmployeeName}</span>
                      ))}
                  </span>
                </label>
                {employee.availability.isUnavailable ? (
                  <div className={styles.availability}>{getAvailabilityLabel(employee.availability)}</div>
                ) : null}
                {selectedIds.includes(employee.id) && !readOnlyReason ? (
                  <div className={`${styles.controls} ${canEditRates ? styles.rateControls : ''}`}>
                    <label className="attendance-hours-control">
                      <span>Часы</span>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={workedHoursById[employee.id] ?? getDefaultWorkedHours(employee.id)}
                        disabled={!!readOnlyReason || isSubmitting}
                        onChange={(event) => setWorkedHoursById((current) => ({ ...current, [employee.id]: event.target.value }))}
                      />
                    </label>
                    {canEditRates || canAddExtraShift ? (
                      <label className="attendance-hours-control">
                        <span>{canEditRates ? 'Изменение начисления' : 'Допработа'}</span>
                        <Select disabled={!!readOnlyReason || isSubmitting} value={specialRateById[employee.id]?.type ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { type: event.target.value as '' | 'complex_shift' | 'side_job', amount: current[employee.id]?.amount ?? '', reason: current[employee.id]?.reason ?? '' } }))}>
                          <option value="">Обычная ставка объекта</option>
                          {canEditRates ? <option value="complex_shift">Изменить цену выхода · заменяет</option> : null}
                          {canAddExtraShift ? <option value="side_job">Допработа · добавляет</option> : null}
                        </Select>
                      </label>
                    ) : null}
                    {(canEditRates || canAddExtraShift) && specialRateById[employee.id]?.type && (canEditRates || specialRateById[employee.id]?.type === 'side_job') ? (
                      <>
                        <label className="attendance-hours-control">
                          <span>{specialRateById[employee.id]?.type === 'side_job' ? 'Дополнительно, ₽' : 'Новая цена выхода, ₽'}</span>
                        <input type="number" min="0" step="1" disabled={!!readOnlyReason || isSubmitting} value={specialRateById[employee.id]?.amount ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { ...(current[employee.id] ?? { type: 'complex_shift' as const, amount: '', reason: '' }), amount: event.target.value } }))} required />
                        </label>
                        <label className={`attendance-hours-control ${styles.reasonControl}`}>
                          <span>Основание</span>
                          <input type="text" maxLength={1000} disabled={!!readOnlyReason || isSubmitting} value={specialRateById[employee.id]?.reason ?? ''} onChange={(event) => setSpecialRateById((current) => ({ ...current, [employee.id]: { ...(current[employee.id] ?? { type: 'complex_shift' as const, amount: '', reason: '' }), reason: event.target.value } }))} required />
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </Surface>
            ))}
          </div>

          {error ? <Alert tone="danger" className={styles.error}>{error}</Alert> : null}
          {compensationResult ? <Alert tone="info">{compensationResult.status === 'pending' ? 'Запрос ожидает согласования другим пользователем руководящего круга. Прежние факты и деньги сохраняются до решения.' : compensationResult.status === 'applied' ? 'Изменение применено.' : compensationResult.status === 'rejected' ? 'Запрос отклонён.' : 'Запрос отменён.'} <a href={`/approvals?${new URLSearchParams({ sourceEntityType: 'object_compensation_adjustment', sourceEntityId: compensationResult.adjustmentId })}`}>Открыть согласование</a></Alert> : null}

          <div className={styles.submit}>
            <Button variant="primary" type="submit" disabled={isSubmitting || !!readOnlyReason || compensationResult?.status === 'pending'}>
              {isSubmitting ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </div>
        </form>
      )}
    </Surface>
  );
}
