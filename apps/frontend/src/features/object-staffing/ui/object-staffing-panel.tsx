'use client';

import React, { useEffect, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import type { UpdateObjectEmployeeRatePolicyPayload } from '@/entities/object/api/object-operations-client';

interface ObjectStaffingPanelProps {
  assignedEmployees: ObjectEmployeeOption[];
  directoryEmployees: ObjectEmployeeOption[];
  search: string;
  isSearching: boolean;
  searchError: string | null;
  onSearchChange: (value: string) => void;
  onAdd: (employeeId: string) => Promise<void>;
  onRemove: (employeeId: string) => Promise<void>;
  canManageAssignments?: boolean;
  canManageRatePolicy?: boolean;
  onUpdateRatePolicy?: (
    employeeId: string,
    payload: UpdateObjectEmployeeRatePolicyPayload,
  ) => Promise<void>;
}

const RATE_POLICY_OPTIONS = [
  ['daily_rate', 'Дневная ставка'],
  ['per_attendance', 'За выход'],
  ['monthly_fixed', 'Оклад по графику'],
  ['monthly_excluding_holidays', 'Оклад без праздников'],
  ['shift_2_2_fixed', '2/2 фикс'],
  ['shift_2_2_by_actual_shifts', '2/2 по сменам'],
  ['partial_shift', 'Частичная смена'],
  ['agreed_substitution_rate', 'Подмена по договоренности'],
] as const;

const SCHEDULE_OPTIONS = ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'];

function buildInitialRateForm(employee: ObjectEmployeeOption): {
  ratePolicyType: string;
  baseAmount: string;
  scheduleCode: string;
  roundingMode: string;
  roundingStep: string;
  standardShiftHours: string;
  workingDaysInMonth: string;
  excludedHolidayDays: string;
  notes: string;
} {
  const policy = employee.ratePolicy;

  return {
    ratePolicyType: policy?.ratePolicyType ?? 'daily_rate',
    baseAmount: String(policy?.baseAmount ?? 0),
    scheduleCode: policy?.scheduleCode ?? '5/2',
    roundingMode: policy?.roundingMode ?? 'none',
    roundingStep: String(policy?.roundingStep ?? 50),
    standardShiftHours: String(policy?.standardShiftHours ?? 8),
    workingDaysInMonth: String(policy?.workingDaysInMonth ?? ''),
    excludedHolidayDays: String(policy?.excludedHolidayDays ?? 0),
    notes: policy?.notes ?? '',
  };
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
  canManageAssignments = false,
  canManageRatePolicy = false,
  onUpdateRatePolicy,
}: ObjectStaffingPanelProps): React.JSX.Element {
  const [editingRateEmployee, setEditingRateEmployee] =
    useState<ObjectEmployeeOption | null>(null);
  const [rateForm, setRateForm] = useState(
    editingRateEmployee
      ? buildInitialRateForm(editingRateEmployee)
      : buildInitialRateForm({
          id: '',
          fullName: '',
          position: null,
          baseDailyRate: null,
          workScheduleCode: null,
          workScheduleCustom: null,
          workTimeText: null,
          isAssignedToObject: false,
          ratePolicy: null,
          availability: {
            isUnavailable: false,
            availabilityMode: null,
            startDate: null,
            endDate: null,
            comment: null,
          },
          activeSubstitutions: [],
        }),
  );
  const [isSavingRate, setIsSavingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const assigned = assignedEmployees ?? [];
  const directory = directoryEmployees ?? [];
  const assignedIds = new Set(assigned.map((employee) => employee.id));
  const visibleSubstitutions = Array.from(
    assigned.reduce<
      Map<
        string,
        ObjectEmployeeOption['activeSubstitutions'][number] & {
          primaryEmployeeName: string;
        }
      >
    >((accumulator, employee) => {
      for (const substitution of employee.activeSubstitutions.filter(
        (item) => item.role === 'primary',
      )) {
        accumulator.set(substitution.id, {
          ...substitution,
          primaryEmployeeName: employee.fullName,
        });
      }

      return accumulator;
    }, new Map()).values(),
  );

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

  useEffect(() => {
    if (!editingRateEmployee) {
      return;
    }

    setRateForm(buildInitialRateForm(editingRateEmployee));
    setRateError(null);
  }, [editingRateEmployee]);

  const submitRatePolicy = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!editingRateEmployee || !onUpdateRatePolicy) {
      return;
    }

    setIsSavingRate(true);
    setRateError(null);

    try {
      await onUpdateRatePolicy(editingRateEmployee.id, {
        ratePolicyType: rateForm.ratePolicyType,
        baseAmount: Number(rateForm.baseAmount) || 0,
        scheduleCode: rateForm.scheduleCode || undefined,
        roundingMode: rateForm.roundingMode,
        roundingStep:
          rateForm.roundingMode === 'nearest_step'
            ? Number(rateForm.roundingStep) || 50
            : undefined,
        standardShiftHours: Number(rateForm.standardShiftHours) || 8,
        workingDaysInMonth: rateForm.workingDaysInMonth
          ? Number(rateForm.workingDaysInMonth)
          : undefined,
        excludedHolidayDays: rateForm.excludedHolidayDays
          ? Number(rateForm.excludedHolidayDays)
          : undefined,
        notes: rateForm.notes,
      });
      setEditingRateEmployee(null);
    } catch {
      setRateError('Не удалось сохранить расчетную политику.');
    } finally {
      setIsSavingRate(false);
    }
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title">Состав сотрудников объекта</div>
          <div className="section-subtitle">
            Staffing отдельно от attendance и табеля.
          </div>
        </div>
      </div>

      {canManageAssignments ? <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}>Поиск сотрудника</div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Введите ФИО сотрудника"
          style={{ width: '100%', padding: 10 }}
        />
      </label> : null}

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Текущий состав</div>

      {assigned.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Сотрудники пока не добавлены.
        </div>
      ) : (
        <div className="record-list" style={{ marginBottom: 16 }}>
          {assigned.map((employee) => (
            <div
              key={employee.id}
              className="record-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: employee.availability.isUnavailable
                  ? '1px solid #f59e0b'
                  : undefined,
                background: employee.availability.isUnavailable
                  ? '#fffbeb'
                  : undefined,
              }}
              title={getAvailabilityExplanation(employee) ?? undefined}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{employee.fullName}</span>
                  {employee.availability.isUnavailable ? (
                    <span className="status-pill" data-status="under_repair">
                      Недоступен
                    </span>
                  ) : null}
                  {employee.activeSubstitutions
                    .filter((item) => item.role === 'primary')
                    .map((item) => (
                      <span key={item.id} className="page-muted">
                        Замещается: {item.counterpartEmployeeName}
                      </span>
                    ))}
                  {employee.activeSubstitutions
                    .filter((item) => item.role === 'replacement')
                    .map((item) => (
                      <span key={item.id} className="page-muted">
                        Замещает: {item.counterpartEmployeeName}
                      </span>
                    ))}
                </div>
                <div className="rate-policy-line">
                  <span>
                    {employee.ratePolicy?.label ?? 'Дневная ставка объекта'}
                  </span>
                  {canManageRatePolicy && onUpdateRatePolicy ? (
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => setEditingRateEmployee(employee)}
                    >
                      Настроить расчет
                    </button>
                  ) : null}
                </div>
                <div className="page-muted">
                  {employee.position ?? 'Должность не указана'} · базовая ставка
                  сотрудника:{' '}
                  {employee.baseDailyRate === null
                    ? 'не указана'
                    : `${employee.baseDailyRate.toLocaleString('ru-RU')} ₽/день`}
                </div>
                <div className="page-muted">
                  График:{' '}
                  {employee.workScheduleCode === 'custom'
                    ? employee.workScheduleCustom
                    : employee.workScheduleCode?.replace('_', '/') ?? 'не указан'}
                  {employee.workTimeText ? ` · ${employee.workTimeText}` : ''}
                </div>
                {employee.availability.isUnavailable ? (
                  <div style={{ color: '#b45309', fontSize: 13 }}>
                    {getAvailabilityExplanation(employee)}
                  </div>
                ) : null}
              </div>

              {canManageAssignments ? (
                <button type="button" onClick={() => void onRemove(employee.id)}>
                  Завершить назначение
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editingRateEmployee ? (
        <div
          className="chat-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingRateEmployee(null);
            }
          }}
        >
          <form className="chat-modal chat-modal--wide" onSubmit={submitRatePolicy}>
            <div className="section-header">
              <div>
                <div className="section-title">Настроить расчет</div>
                <div className="section-subtitle">
                  {editingRateEmployee.fullName} · ставка хранится на назначении
                  сотрудника к объекту.
                </div>
              </div>
              <button type="button" onClick={() => setEditingRateEmployee(null)}>
                Закрыть
              </button>
            </div>

            <div className="rate-policy-form-grid">
              <label>
                <span>Тип расчета</span>
                <select
                  value={rateForm.ratePolicyType}
                  onChange={(event) =>
                    setRateForm((current) => ({
                      ...current,
                      ratePolicyType: event.target.value,
                    }))
                  }
                >
                  {RATE_POLICY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Сумма / ставка</span>
                <input
                  type="number"
                  min="0"
                  value={rateForm.baseAmount}
                  onChange={(event) =>
                    setRateForm((current) => ({
                      ...current,
                      baseAmount: event.target.value,
                    }))
                  }
                />
              </label>

              {['monthly_fixed'].includes(rateForm.ratePolicyType) ? (
                <label>
                  <span>График</span>
                  <select
                    value={rateForm.scheduleCode}
                    onChange={(event) =>
                      setRateForm((current) => ({
                        ...current,
                        scheduleCode: event.target.value,
                      }))
                    }
                  >
                    {SCHEDULE_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {rateForm.ratePolicyType === 'monthly_excluding_holidays' ? (
                <>
                  <label>
                    <span>Рабочих дней</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={rateForm.workingDaysInMonth}
                      onChange={(event) =>
                        setRateForm((current) => ({
                          ...current,
                          workingDaysInMonth: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Праздничных дней</span>
                    <input
                      type="number"
                      min="0"
                      max="31"
                      value={rateForm.excludedHolidayDays}
                      onChange={(event) =>
                        setRateForm((current) => ({
                          ...current,
                          excludedHolidayDays: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

              {rateForm.ratePolicyType === 'shift_2_2_by_actual_shifts' ? (
                <>
                  <label>
                    <span>Округление</span>
                    <select
                      value={rateForm.roundingMode}
                      onChange={(event) =>
                        setRateForm((current) => ({
                          ...current,
                          roundingMode: event.target.value,
                        }))
                      }
                    >
                      <option value="none">Без шага</option>
                      <option value="nearest_step">До шага</option>
                    </select>
                  </label>
                  {rateForm.roundingMode === 'nearest_step' ? (
                    <label>
                      <span>Шаг</span>
                      <select
                        value={rateForm.roundingStep}
                        onChange={(event) =>
                          setRateForm((current) => ({
                            ...current,
                            roundingStep: event.target.value,
                          }))
                        }
                      >
                        <option value="50">50</option>
                        <option value="100">100</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}

              {rateForm.ratePolicyType === 'partial_shift' ? (
                <label>
                  <span>Стандартные часы смены</span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="0.5"
                    value={rateForm.standardShiftHours}
                    onChange={(event) =>
                      setRateForm((current) => ({
                        ...current,
                        standardShiftHours: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}

              {rateForm.ratePolicyType === 'agreed_substitution_rate' ? (
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>Основание договорной ставки</span>
                  <textarea
                    value={rateForm.notes}
                    onChange={(event) =>
                      setRateForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    rows={3}
                  />
                </label>
              ) : null}
            </div>

            {rateError ? <div style={{ color: '#b91c1c' }}>{rateError}</div> : null}

            <div className="action-row">
              <button type="submit" disabled={isSavingRate}>
                {isSavingRate ? 'Сохраняем...' : 'Сохранить расчет'}
              </button>
              <button type="button" onClick={() => setEditingRateEmployee(null)}>
                Отмена
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div style={{ fontWeight: 600, marginBottom: 8 }}>Подмены на сегодня</div>

      {visibleSubstitutions.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Активных подмен на сегодня нет.
        </div>
      ) : (
        <div className="record-list" style={{ marginBottom: 16 }}>
          {visibleSubstitutions.map((substitution) => (
            <div
              key={substitution.id}
              className="record-card"
            >
              <div>
                <strong>{substitution.primaryEmployeeName}</strong> замещается{' '}
                <strong>{substitution.counterpartEmployeeName}</strong>
              </div>
              <div className="page-muted">
                {new Date(substitution.startDate).toLocaleString('ru-RU')} —{' '}
                {substitution.endDate
                  ? new Date(substitution.endDate).toLocaleString('ru-RU')
                  : 'без даты окончания'}
              </div>
              <div className="page-muted">
                Статус: {substitution.status}. Причина: {substitution.reason}
              </div>
              {substitution.comment ? (
                <div className="page-muted">{substitution.comment}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManageAssignments ? <>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Результаты поиска</div>

      {searchError ? (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>{searchError}</div>
      ) : null}

      {isSearching ? (
        <div className="page-muted">Поиск...</div>
      ) : directory.length === 0 ? (
        <div className="page-muted">Подходящих сотрудников не найдено.</div>
      ) : (
        <div className="record-list">
          {directory.map((employee) => (
            <div
              key={employee.id}
              className="record-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: employee.availability.isUnavailable
                  ? '1px solid #f59e0b'
                  : undefined,
                background: employee.availability.isUnavailable
                  ? '#fffbeb'
                  : undefined,
              }}
              title={getAvailabilityExplanation(employee) ?? undefined}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{employee.fullName}</span>
                  {employee.availability.isUnavailable ? (
                    <span className="status-pill" data-status="under_repair">
                      Недоступен
                    </span>
                  ) : null}
                </div>
                {employee.availability.isUnavailable ? (
                  <div style={{ color: '#b45309', fontSize: 13 }}>
                    {getAvailabilityExplanation(employee)}
                  </div>
                ) : null}
              </div>

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
      </> : null}
    </div>
  );
}
