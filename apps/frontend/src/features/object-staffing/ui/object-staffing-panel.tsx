'use client';

import React, { useEffect, useId, useState } from 'react';

import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  createObjectCompensationRate,
  listObjectCompensationRates,
  updateObjectCompensationRate,
  type ObjectCompensationRate,
  type SaveObjectCompensationRatePayload,
} from '@/entities/object/api/object-operations-client';
import type { UpdateObjectEmployeeRatePolicyPayload } from '@/entities/object/api/object-operations-client';
import sharedStyles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getAvailabilityLabel } from '@/shared/lib/employee-availability-label';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './object-staffing-panel.module.css';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Button } from '@/shared/ui/foundation';

interface ObjectStaffingPanelProps {
  object: ServiceObject;
  assignedEmployees: ObjectEmployeeOption[];
  directoryEmployees: ObjectEmployeeOption[];
  search: string;
  isSearching: boolean;
  searchError: string | null;
  onSearchChange: (value: string) => void;
  onAdd: (employeeId: string) => Promise<void>;
  onRemove: (employeeId: string) => Promise<void>;
  canManageAssignments?: boolean;
  canViewRateOptions?: boolean;
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
  ['complex_shift', 'Сложный выход'],
  ['side_job', 'Подработка'],
] as const;

const SCHEDULE_OPTIONS = ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'];
const WEEKDAY_OPTIONS = [
  ['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'],
  ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс'],
] as const;
type ScheduleMode = 'template' | 'weekdays';

function inferScheduleMode(weekdays: string[] | null | undefined): ScheduleMode {
  return weekdays?.length ? 'weekdays' : 'template';
}

function requiresCycleStartDate(scheduleMode: ScheduleMode, scheduleCode: string): boolean {
  return scheduleMode === 'template' && Boolean(scheduleCode) && scheduleCode !== '5/2';
}

function RateSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  searchable = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
  searchable?: boolean;
}): React.JSX.Element {
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      searchable={searchable}
      clearable={false}
      viewportAware
      disabled={disabled}
    />
  );
}

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
  rateOptionId: string;
  scheduleWeekdays: string[];
  scheduleCycleStartDate: string;
  scheduleMode: ScheduleMode;
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
    rateOptionId: policy?.rateOptionId ?? '',
    scheduleWeekdays: policy?.scheduleWeekdays ?? [],
    scheduleCycleStartDate: policy?.scheduleCycleStartDate?.slice(0, 10) ?? '',
    scheduleMode: inferScheduleMode(policy?.scheduleWeekdays),
  };
}

function WeekdayPicker({ value, onChange, disabled }: { value: string[]; onChange: (value: string[]) => void; disabled: boolean }): React.JSX.Element {
  return <div className={styles.weekdayPicker} aria-label="Рабочие дни недели">
    {WEEKDAY_OPTIONS.map(([code, label]) => <label key={code}>
      <input type="checkbox" checked={value.includes(code)} disabled={disabled || (value.length === 1 && value.includes(code))} onChange={(event) => onChange(event.target.checked ? [...value, code] : value.filter((day) => day !== code))} />
      <span>{label}</span>
    </label>)}
  </div>;
}

function ScheduleEditor({
  code, weekdays, cycleStartDate, mode, disabled, ratePolicyType, onModeChange, onCodeChange, onWeekdaysChange, onCycleStartDateChange,
}: {
  code: string; weekdays: string[]; cycleStartDate: string; mode: ScheduleMode; disabled: boolean;
  ratePolicyType?: string;
  onModeChange: (value: ScheduleMode) => void;
  onCodeChange: (value: string) => void; onWeekdaysChange: (value: string[]) => void;
  onCycleStartDateChange: (value: string) => void;
}): React.JSX.Element {
  const scheduleModeName = useId();
  const isMonthlyCalculation = ratePolicyType === 'monthly_fixed' || ratePolicyType === 'monthly_excluding_holidays';

  return <div className={styles.scheduleEditor}>
    <fieldset className={styles.scheduleModeField}>
      <legend className={sharedStyles.fieldLabel}>Режим графика</legend>
      <div className={styles.scheduleModeChoices} role="radiogroup" aria-label="Режим графика">
        <label className={styles.scheduleModeChoice}>
          <input type="radio" name={scheduleModeName} checked={mode === 'template'} disabled={disabled} onChange={() => onModeChange('template')} />
          <span>Стандартный график</span>
        </label>
        <label className={styles.scheduleModeChoice}>
          <input type="radio" name={scheduleModeName} checked={mode === 'weekdays'} disabled={disabled} onChange={() => onModeChange('weekdays')} />
          <span>Дни недели</span>
        </label>
      </div>
    </fieldset>
    {mode === 'template' ? (
      <>
        <RateSelect label="Шаблон графика" value={code || '5/2'} options={SCHEDULE_OPTIONS.map((item) => ({ value: item, label: item }))} disabled={disabled} onChange={onCodeChange} />
        {requiresCycleStartDate(mode, code) ? (
          <label>
            <span>Дата первого рабочего дня цикла *</span>
            <DatePicker value={cycleStartDate} required aria-required="true" disabled={disabled} onChange={(nextValue) => onCycleStartDateChange(nextValue)} />
            <small>{cycleStartDate ? `От этой даты повторяется цикл графика ${code}.` : 'Обязательное поле: задаёт точку отсчёта цикла.'}</small>
          </label>
        ) : (
          <small>График 5/2 рассчитывается по производственному календарю.</small>
        )}
      </>
    ) : (
      <div className={styles.weekdayMode}>
        <span className={sharedStyles.fieldLabel}>Выберите рабочие дни, например только среду. Оставьте выбранным минимум один день.</span>
        <WeekdayPicker value={weekdays} onChange={onWeekdaysChange} disabled={disabled} />
        {weekdays.length === 0 ? <small className={styles.scheduleError} role="alert" aria-live="polite">Выберите хотя бы один день недели, чтобы сохранить график.</small> : null}
      </div>
    )}
    <small>{mode === 'weekdays'
      ? isMonthlyCalculation
        ? 'Для месячного расчёта учитывается фактическое число выбранных дней в этом месяце.'
        : 'График задаёт план; начисление за выход фиксируется только по фактическому табелю.'
      : isMonthlyCalculation
        ? 'Стандартный график используется для месячного расчёта.'
        : 'График задаёт план; начисление за выход фиксируется только по фактическому табелю.'}</small>
  </div>;
}

export function ObjectStaffingPanel({
  object,
  assignedEmployees,
  directoryEmployees,
  search,
  isSearching,
  searchError,
  onSearchChange,
  onAdd,
  onRemove,
  canManageAssignments = false,
  canViewRateOptions = false,
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
  const [rateOptions, setRateOptions] = useState<ObjectCompensationRate[]>([]);
  const [rateOptionsError, setRateOptionsError] = useState<string | null>(null);
  const [rateEditor, setRateEditor] = useState<ObjectCompensationRate | null | false>(false);
  const [rateOptionForm, setRateOptionForm] = useState({ name: '', category: 'standard' as 'standard' | 'substitution', ratePolicyType: 'daily_rate' as 'daily_rate' | 'monthly_fixed', baseAmount: '', scheduleCode: '5/2', scheduleWeekdays: [] as string[], scheduleCycleStartDate: '', scheduleMode: 'template' as ScheduleMode, notes: '' });
  const [isSavingRateOption, setIsSavingRateOption] = useState(false);
  const assigned = assignedEmployees ?? [];
  const directory = directoryEmployees ?? [];
  const assignedIds = new Set(assigned.map((employee) => employee.id));
  const addableEmployees = directory.filter((employee) => !assignedIds.has(employee.id));
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

  useEffect(() => {
    if (!canViewRateOptions) return;
    let active = true;
    void listObjectCompensationRates(object.id).then((items) => {
      if (active) setRateOptions(items);
    }).catch(() => {
      if (active) setRateOptionsError('Не удалось загрузить варианты оплаты.');
    });
    return () => { active = false; };
  }, [canViewRateOptions, object.id]);

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

    if (!canManageRatePolicy || !editingRateEmployee || !onUpdateRatePolicy) {
      return;
    }
    if (rateForm.scheduleMode === 'weekdays' && rateForm.scheduleWeekdays.length === 0) {
      setRateError('Выберите хотя бы один день недели.');
      return;
    }
    if (requiresCycleStartDate(rateForm.scheduleMode, rateForm.scheduleCode) && !rateForm.scheduleCycleStartDate) {
      setRateError('Укажите дату первого рабочего дня цикла.');
      return;
    }

    setIsSavingRate(true);
    setRateError(null);

    try {
      await onUpdateRatePolicy(editingRateEmployee.id, {
        ratePolicyType: rateForm.ratePolicyType,
        baseAmount: Number(rateForm.baseAmount) || 0,
        scheduleCode: rateForm.scheduleMode === 'template' ? rateForm.scheduleCode || '5/2' : null,
        scheduleWeekdays: rateForm.scheduleMode === 'weekdays' ? rateForm.scheduleWeekdays : [],
        scheduleCycleStartDate: requiresCycleStartDate(rateForm.scheduleMode, rateForm.scheduleCode) ? rateForm.scheduleCycleStartDate : null,
        rateOptionId: rateForm.rateOptionId || undefined,
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

  const beginRateOptionEdit = (item?: ObjectCompensationRate): void => {
    if (!canManageRatePolicy) return;
    setRateEditor(item ?? null);
    setRateOptionForm({
      name: item?.name ?? '',
      category: item?.category ?? 'standard',
      ratePolicyType: item?.ratePolicyType ?? 'daily_rate',
      baseAmount: item ? String(item.baseAmount) : '',
      scheduleCode: item?.scheduleCode ?? '5/2',
      scheduleWeekdays: item?.scheduleWeekdays ?? [],
      scheduleCycleStartDate: item?.scheduleCycleStartDate?.slice(0, 10) ?? '',
      notes: item?.notes ?? '',
      scheduleMode: inferScheduleMode(item?.scheduleWeekdays),
    });
  };

  const saveRateOption = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canManageRatePolicy) return;
    if (rateOptionForm.scheduleMode === 'weekdays' && rateOptionForm.scheduleWeekdays.length === 0) {
      setRateOptionsError('Выберите хотя бы один день недели.');
      return;
    }
    if (requiresCycleStartDate(rateOptionForm.scheduleMode, rateOptionForm.scheduleCode) && !rateOptionForm.scheduleCycleStartDate) {
      setRateOptionsError('Укажите дату первого рабочего дня цикла.');
      return;
    }
    setIsSavingRateOption(true);
    setRateOptionsError(null);
    const payload: SaveObjectCompensationRatePayload = {
      name: rateOptionForm.name.trim(),
      category: rateOptionForm.category,
      ratePolicyType: rateOptionForm.ratePolicyType,
      baseAmount: Number(rateOptionForm.baseAmount) || 0,
      scheduleCode: rateOptionForm.scheduleMode === 'template' ? rateOptionForm.scheduleCode || '5/2' : null,
      scheduleWeekdays: rateOptionForm.scheduleMode === 'weekdays' ? rateOptionForm.scheduleWeekdays : [],
      scheduleCycleStartDate: requiresCycleStartDate(rateOptionForm.scheduleMode, rateOptionForm.scheduleCode) ? rateOptionForm.scheduleCycleStartDate : null,
      notes: rateOptionForm.notes.trim() || undefined,
    };
    try {
      if (rateEditor) await updateObjectCompensationRate(object.id, rateEditor.id, payload);
      else await createObjectCompensationRate(object.id, payload);
      setRateOptions(await listObjectCompensationRates(object.id));
      setRateEditor(false);
    } catch (caughtError) {
      setRateOptionsError(caughtError instanceof Error ? caughtError.message : 'Не удалось сохранить вариант оплаты.');
    } finally {
      setIsSavingRateOption(false);
    }
  };

  const toggleRateOption = async (item: ObjectCompensationRate): Promise<void> => {
    if (!canManageRatePolicy) return;
    try {
      const updated = await updateObjectCompensationRate(object.id, item.id, { isActive: !item.isActive });
      setRateOptions((current) => current.map((rate) => rate.id === updated.id ? updated : rate));
    } catch (caughtError) {
      setRateOptionsError(caughtError instanceof Error ? caughtError.message : 'Не удалось изменить статус варианта.');
    }
  };

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 14 }}>
        <div className="section-title">Сотрудники объекта</div>
      </div>

      {canViewRateOptions ? (
        <section aria-label="Варианты оплаты команды">
          <div className={styles.rateCatalogHeader}>
            <div><h3>Варианты оплаты команды</h3><p className="page-muted">Именные ставки и тарифы для подмены. Управлять вариантами и назначать их сотрудникам могут только пользователи с соответствующим правом.</p></div>
            {canManageRatePolicy ? <Button onClick={() => beginRateOptionEdit()}>Добавить вариант</Button> : null}
          </div>
          {rateOptionsError ? <div className={`${sharedStyles.error} ${styles.feedbackError}`}>{rateOptionsError}</div> : null}
          <div className={styles.rateCatalog}>
            {rateOptions.length === 0 ? <div className="page-muted">Варианты оплаты пока не созданы.</div> : rateOptions.map((rate) => <div className={styles.rateOption} key={rate.id}>
              <div><strong>{rate.name}</strong><span>{rate.category === 'substitution' ? 'Подмена' : 'Стандартный вариант'} · {rate.ratePolicyType === 'monthly_fixed' ? 'Оклад' : 'За выход'} · {rate.baseAmount.toLocaleString('ru-RU')} ₽ · {rate.isActive ? 'Активен' : 'Отключен'}</span>{rate.scheduleWeekdays.length ? <small>{rate.scheduleWeekdays.join(', ')}</small> : rate.scheduleCode ? <small>График {rate.scheduleCode}</small> : null}</div>
              {canManageRatePolicy ? <div className={styles.rateOptionActions}><Button onClick={() => beginRateOptionEdit(rate)}>Изменить</Button><Button onClick={() => void toggleRateOption(rate)}>{rate.isActive ? 'Отключить' : 'Включить'}</Button></div> : null}
            </div>)}
          </div>
        </section>
      ) : null}

      {canManageRatePolicy && rateEditor !== false ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRateEditor(false); }}>
          <form className={styles.modal} onSubmit={saveRateOption}>
            <div className="section-header"><div><div className="section-title">{rateEditor ? 'Изменить вариант оплаты' : 'Новый вариант оплаты'}</div><div className="section-subtitle">Изменение тарифа не меняет ранее сохранённые начисления.</div></div><Button onClick={() => setRateEditor(false)}>Закрыть</Button></div>
            <div className={styles.ratePolicyGrid}>
              <label><span>Название варианта</span><input value={rateOptionForm.name} required maxLength={120} onChange={(event) => setRateOptionForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <RateSelect label="Назначение" value={rateOptionForm.category} options={[{ value: 'standard', label: 'Обычная ставка' }, { value: 'substitution', label: 'Подмена' }]} disabled={isSavingRateOption} onChange={(value) => setRateOptionForm((current) => ({ ...current, category: value as 'standard' | 'substitution' }))} />
              <RateSelect label="Расчёт" value={rateOptionForm.ratePolicyType} options={[{ value: 'daily_rate', label: 'За выход' }, { value: 'monthly_fixed', label: 'За месяц' }]} disabled={isSavingRateOption} onChange={(value) => setRateOptionForm((current) => ({ ...current, ratePolicyType: value as 'daily_rate' | 'monthly_fixed' }))} />
              <label><span>{rateOptionForm.ratePolicyType === 'monthly_fixed' ? 'Сумма за месяц, ₽' : 'Ставка за выход, ₽'}</span><input type="number" min="0" required value={rateOptionForm.baseAmount} onChange={(event) => setRateOptionForm((current) => ({ ...current, baseAmount: event.target.value }))} /></label>
              <div className={styles.fullWidth}>
                <ScheduleEditor code={rateOptionForm.scheduleCode} weekdays={rateOptionForm.scheduleWeekdays} cycleStartDate={rateOptionForm.scheduleCycleStartDate} mode={rateOptionForm.scheduleMode} ratePolicyType={rateOptionForm.ratePolicyType} disabled={isSavingRateOption} onModeChange={(scheduleMode) => setRateOptionForm((current) => ({ ...current, scheduleMode, scheduleCode: scheduleMode === 'template' ? current.scheduleCode || '5/2' : '', scheduleWeekdays: [], scheduleCycleStartDate: '' }))} onCodeChange={(value) => setRateOptionForm((current) => ({ ...current, scheduleCode: value, scheduleCycleStartDate: value === '5/2' ? '' : current.scheduleCycleStartDate }))} onWeekdaysChange={(value) => setRateOptionForm((current) => ({ ...current, scheduleWeekdays: value }))} onCycleStartDateChange={(value) => setRateOptionForm((current) => ({ ...current, scheduleCycleStartDate: value }))} />
              </div>
              <label className={styles.fullWidth}><span>Примечание</span><textarea value={rateOptionForm.notes} rows={2} onChange={(event) => setRateOptionForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            {rateOptionsError ? <div className={sharedStyles.error}>{rateOptionsError}</div> : null}
            <div className="action-row"><Button variant="primary" type="submit" disabled={isSavingRateOption || (rateOptionForm.scheduleMode === 'weekdays' && rateOptionForm.scheduleWeekdays.length === 0) || (requiresCycleStartDate(rateOptionForm.scheduleMode, rateOptionForm.scheduleCode) && !rateOptionForm.scheduleCycleStartDate)}>{isSavingRateOption ? 'Сохраняем…' : 'Сохранить вариант'}</Button><Button onClick={() => setRateEditor(false)}>Отмена</Button></div>
          </form>
        </div>
      ) : null}

      {canManageAssignments ? (
        <label className={styles.searchField}>
          <span className={sharedStyles.fieldLabel}>Поиск сотрудника</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Введите ФИО сотрудника"
          />
        </label>
      ) : null}

      <div className={styles.sectionHeading}>На объекте <span>{assigned.length}</span></div>

      {assigned.length === 0 ? (
        <div className="page-muted" style={{ marginBottom: 16 }}>
          Сотрудники пока не добавлены.
        </div>
      ) : (
        <div className="record-list" style={{ marginBottom: 16 }}>
          {assigned.map((employee) => (
            <div
              key={employee.id}
              className={`${styles.employeeCard} ${
                employee.availability.isUnavailable
                  ? styles.employeeCardUnavailable
                  : ''
              }`}
              title={getAvailabilityLabel(employee.availability) ?? undefined}
            >
              <div className={styles.employeeInfo}>
                <div className={styles.employeeNameRow}>
                  <span>{employee.fullName}</span>
                  {employee.availability.isUnavailable ? (
                    <span className={styles.availabilityBadge}>Недоступен</span>
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
                <div className={styles.ratePolicyLine}>
                  <span>
                    {employee.ratePolicy?.label ?? 'Условия оплаты объекта'}
                  </span>
                  {canManageRatePolicy && onUpdateRatePolicy ? (
                    <Button
                      onClick={() => setEditingRateEmployee(employee)}
                    >
                      Настроить расчет
                    </Button>
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
                  <div className={styles.availabilityText}>
                    {getAvailabilityLabel(employee.availability)}
                  </div>
                ) : null}
              </div>

              {canManageAssignments ? (
                <Button onClick={() => void onRemove(employee.id)}>
                  Завершить назначение
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editingRateEmployee ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingRateEmployee(null);
            }
          }}
        >
          <form
            className={`${styles.modal} ${styles.modalWide}`}
            onSubmit={submitRatePolicy}
          >
            <div className="section-header">
              <div>
                <div className="section-title">Настроить расчет</div>
                <div className="section-subtitle">
                  {editingRateEmployee.fullName} · ставка хранится на назначении
                  сотрудника к объекту.
                </div>
              </div>
              <Button onClick={() => setEditingRateEmployee(null)}>
                Закрыть
              </Button>
            </div>

            <div className={styles.ratePolicyGrid}>
              <div className={styles.fullWidth}>
                <RateSelect
                  label="Сохранённый вариант оплаты"
                  value={rateForm.rateOptionId || 'custom'}
                  options={[
                    { value: 'custom', label: 'Индивидуальные условия' },
                    ...rateOptions.filter((rate) => rate.isActive || rate.id === rateForm.rateOptionId).map((rate) => ({ value: rate.id, label: `${rate.name}${rate.isActive ? '' : ' · отключен'} · ${rate.category === 'substitution' ? 'подмена' : 'ставка'}` })),
                  ]}
                  searchable
                  disabled={isSavingRate}
                  onChange={(rateOptionId) => {
                    const option = rateOptions.find((rate) => rate.id === rateOptionId);
                    setRateForm((current) => option ? {
                      ...current,
                      rateOptionId: option.id,
                      ratePolicyType: option.ratePolicyType,
                      baseAmount: String(option.baseAmount),
                      scheduleCode: option.scheduleCode ?? '5/2',
                      scheduleWeekdays: option.scheduleWeekdays,
                      scheduleCycleStartDate: option.scheduleCycleStartDate?.slice(0, 10) ?? '',
                      scheduleMode: inferScheduleMode(option.scheduleWeekdays),
                      standardShiftHours: String(option.standardShiftHours),
                      notes: option.notes ?? '',
                    } : { ...current, rateOptionId: '' });
                  }}
                />
              </div>
              <RateSelect
                label="Тип расчета"
                value={rateForm.ratePolicyType}
                options={RATE_POLICY_OPTIONS.map(([value, label]) => ({ value, label }))}
                searchable
                disabled={isSavingRate || Boolean(rateForm.rateOptionId)}
                onChange={(ratePolicyType) =>
                  setRateForm((current) => ({
                    ...current,
                    rateOptionId: '',
                    ratePolicyType,
                  }))
                }
              />

              <label>
                <span>Сумма / ставка</span>
                <input
                  type="number"
                  min="0"
                  value={rateForm.baseAmount}
                  disabled={isSavingRate || Boolean(rateForm.rateOptionId)}
                  onChange={(event) =>
                    setRateForm((current) => ({
                      ...current,
                      baseAmount: event.target.value,
                    }))
                  }
                />
              </label>

              <div className={styles.fullWidth}>
                <ScheduleEditor code={rateForm.scheduleCode} weekdays={rateForm.scheduleWeekdays} cycleStartDate={rateForm.scheduleCycleStartDate} mode={rateForm.scheduleMode} ratePolicyType={rateForm.ratePolicyType} disabled={isSavingRate || Boolean(rateForm.rateOptionId)} onModeChange={(scheduleMode) => setRateForm((current) => ({ ...current, scheduleMode, scheduleCode: scheduleMode === 'template' ? current.scheduleCode || '5/2' : '', scheduleWeekdays: [], scheduleCycleStartDate: '' }))} onCodeChange={(scheduleCode) => setRateForm((current) => ({ ...current, scheduleCode, scheduleCycleStartDate: scheduleCode === '5/2' ? '' : current.scheduleCycleStartDate }))} onWeekdaysChange={(scheduleWeekdays) => setRateForm((current) => ({ ...current, scheduleWeekdays }))} onCycleStartDateChange={(scheduleCycleStartDate) => setRateForm((current) => ({ ...current, scheduleCycleStartDate }))} />
              </div>

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
                  <RateSelect
                    label="Округление"
                    value={rateForm.roundingMode}
                    options={[
                      { value: 'none', label: 'Без шага' },
                      { value: 'nearest_step', label: 'До шага' },
                    ]}
                    disabled={isSavingRate}
                    onChange={(roundingMode) =>
                      setRateForm((current) => ({
                        ...current,
                        roundingMode,
                      }))
                    }
                  />
                  {rateForm.roundingMode === 'nearest_step' ? (
                    <RateSelect
                      label="Шаг"
                      value={rateForm.roundingStep}
                      options={[
                        { value: '50', label: '50' },
                        { value: '100', label: '100' },
                      ]}
                      disabled={isSavingRate}
                      onChange={(roundingStep) =>
                        setRateForm((current) => ({
                          ...current,
                          roundingStep,
                        }))
                      }
                    />
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

              {['agreed_substitution_rate', 'complex_shift', 'side_job'].includes(rateForm.ratePolicyType) ? (
                <label className={styles.fullWidth}>
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

            {rateError ? (
              <div className={sharedStyles.error}>{rateError}</div>
            ) : null}

            <div className="action-row">
              <Button variant="primary" type="submit" disabled={isSavingRate || (rateForm.scheduleMode === 'weekdays' && rateForm.scheduleWeekdays.length === 0) || (requiresCycleStartDate(rateForm.scheduleMode, rateForm.scheduleCode) && !rateForm.scheduleCycleStartDate)}>
                {isSavingRate ? 'Сохраняем...' : 'Сохранить расчет'}
              </Button>
              <Button onClick={() => setEditingRateEmployee(null)}>
                Отмена
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {visibleSubstitutions.length > 0 ? (
        <>
          <div className={styles.sectionHeading}>Подмены сегодня <span>{visibleSubstitutions.length}</span></div>
          <div className="record-list" style={{ marginBottom: 16 }}>
            {visibleSubstitutions.map((substitution) => (
              <div key={substitution.id} className="record-card">
                <div>
                  <strong>{substitution.primaryEmployeeName}</strong> →{' '}
                  <strong>{substitution.counterpartEmployeeName}</strong>
                </div>
                <div className="page-muted">
                  {new Date(substitution.startDate).toLocaleString('ru-RU')} —{' '}
                  {substitution.endDate
                    ? new Date(substitution.endDate).toLocaleString('ru-RU')
                    : 'без даты окончания'}
                </div>
                {substitution.comment ? <div className="page-muted">{substitution.comment}</div> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {canManageAssignments ? (
        <>
          <div className={styles.sectionHeading}>Можно добавить <span>{addableEmployees.length}</span></div>

          {searchError ? (
            <div className={`${sharedStyles.error} ${styles.feedbackError}`}>
              {searchError}
            </div>
          ) : null}

          {isSearching ? (
            <div className="page-muted">Поиск...</div>
          ) : addableEmployees.length === 0 ? (
            <div className="page-muted">Подходящих сотрудников не найдено.</div>
          ) : (
            <div className={styles.directoryGrid}>
              {addableEmployees.map((employee) => (
                <div
                  key={employee.id}
                  className={`${styles.employeeCard} ${
                    employee.availability.isUnavailable
                      ? styles.employeeCardUnavailable
                      : ''
                  }`}
                  title={getAvailabilityLabel(employee.availability) ?? undefined}
                >
                  <div className={styles.employeeInfo}>
                    <div className={styles.employeeNameRow}>
                      <span>{employee.fullName}</span>
                      {employee.availability.isUnavailable ? (
                        <span className={styles.availabilityBadge}>
                          Недоступен
                        </span>
                      ) : null}
                    </div>
                    {employee.availability.isUnavailable ? (
                      <div className={styles.availabilityText}>
                        {getAvailabilityLabel(employee.availability)}
                      </div>
                    ) : null}
                  </div>

                  <Button onClick={() => void onAdd(employee.id)}>
                    В состав
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
