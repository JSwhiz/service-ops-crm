'use client';

import React from 'react';

import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './object-compensation-profiles.module.css';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert } from '@/shared/ui/foundation';

export interface ObjectCompensationProfilesValue {
  paymentType: 'monthly' | 'daily';
  dailyRate: string;
  monthlySalary: string;
  paymentScheduleCode: string;
  paymentScheduleWeekdays: string[];
  paymentScheduleCycleStartDate: string;
  summerPaymentType: 'monthly' | 'daily';
  summerDailyRate: string;
  summerMonthlySalary: string;
  summerScheduleCode: string;
  summerScheduleWeekdays: string[];
  summerScheduleCycleStartDate: string;
  winterPaymentType: 'monthly' | 'daily';
  winterDailyRate: string;
  winterMonthlySalary: string;
  winterScheduleCode: string;
  winterScheduleWeekdays: string[];
  winterScheduleCycleStartDate: string;
}

interface ObjectCompensationProfilesProps {
  value: ObjectCompensationProfilesValue;
  onChange: (value: ObjectCompensationProfilesValue) => void;
  disabled?: boolean;
  showSeasonalProfiles?: boolean;
}

const PAYMENT_OPTIONS = [
  { value: 'monthly', label: 'Фиксированный оклад за месяц' },
  { value: 'daily', label: 'Ставка за фактический выход' },
];

const SCHEDULE_OPTIONS = ['5/2', '1/6', '2/5', '3/4', '4/3', '6/1', '7/0'].map((code) => ({
  value: code,
  label: code,
}));

const WEEKDAYS = [
  ['mon', 'Пн'],
  ['tue', 'Вт'],
  ['wed', 'Ср'],
  ['thu', 'Чт'],
  ['fri', 'Пт'],
  ['sat', 'Сб'],
  ['sun', 'Вс'],
] as const;

type ScheduleMode = 'template' | 'weekdays';

const PROFILES = [
  {
    id: 'default',
    title: 'По умолчанию',
    typeKey: 'paymentType',
    dailyRateKey: 'dailyRate',
    monthlySalaryKey: 'monthlySalary',
    scheduleCodeKey: 'paymentScheduleCode',
    weekdaysKey: 'paymentScheduleWeekdays',
    cycleStartDateKey: 'paymentScheduleCycleStartDate',
  },
  {
    id: 'summer',
    title: 'Летний тариф',
    typeKey: 'summerPaymentType',
    dailyRateKey: 'summerDailyRate',
    monthlySalaryKey: 'summerMonthlySalary',
    scheduleCodeKey: 'summerScheduleCode',
    weekdaysKey: 'summerScheduleWeekdays',
    cycleStartDateKey: 'summerScheduleCycleStartDate',
  },
  {
    id: 'winter',
    title: 'Зимний тариф',
    typeKey: 'winterPaymentType',
    dailyRateKey: 'winterDailyRate',
    monthlySalaryKey: 'winterMonthlySalary',
    scheduleCodeKey: 'winterScheduleCode',
    weekdaysKey: 'winterScheduleWeekdays',
    cycleStartDateKey: 'winterScheduleCycleStartDate',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  typeKey: keyof ObjectCompensationProfilesValue;
  dailyRateKey: keyof ObjectCompensationProfilesValue;
  monthlySalaryKey: keyof ObjectCompensationProfilesValue;
  scheduleCodeKey: keyof ObjectCompensationProfilesValue;
  weekdaysKey: keyof ObjectCompensationProfilesValue;
  cycleStartDateKey: keyof ObjectCompensationProfilesValue;
}>;

export function getInvalidObjectScheduleProfiles(value: ObjectCompensationProfilesValue): string[] {
  return PROFILES.filter((profile) => {
    const weekdays = value[profile.weekdaysKey] as string[];
    if (weekdays.length > 0) {
      return weekdays.some((day) => !WEEKDAYS.some(([code]) => code === day)) || new Set(weekdays).size !== weekdays.length;
    }
    const scheduleCode = value[profile.scheduleCodeKey] as string;
    return !SCHEDULE_OPTIONS.some((option) => option.value === scheduleCode)
      || (scheduleCode !== '5/2' && !/^\d{4}-\d{2}-\d{2}$/.test(value[profile.cycleStartDateKey] as string));
  }).map((profile) => profile.title);
}

export function ObjectCompensationProfiles({
  value,
  onChange,
  disabled = false,
  showSeasonalProfiles = true,
}: ObjectCompensationProfilesProps): React.JSX.Element {
  const invalidProfiles = new Set(getInvalidObjectScheduleProfiles(value));

  const updateField = <Key extends keyof ObjectCompensationProfilesValue,>(
    key: Key,
    nextValue: ObjectCompensationProfilesValue[Key],
  ): void => {
    onChange({ ...value, [key]: nextValue } as ObjectCompensationProfilesValue);
  };

  const changeScheduleMode = (profile: (typeof PROFILES)[number], mode: ScheduleMode): void => {
    const currentCode = value[profile.scheduleCodeKey] as string;
    onChange({
      ...value,
      [profile.weekdaysKey]: [],
      [profile.scheduleCodeKey]: mode === 'template' ? currentCode || '5/2' : '',
      [profile.cycleStartDateKey]: '',
    } as ObjectCompensationProfilesValue);
  };

  return (
    <section className={styles.profiles} aria-labelledby="object-compensation-title">
      <div className={styles.intro}>
        <h3 id="object-compensation-title">Условия оплаты объекта</h3>
        <p>
          Сумма за выход и оклад хранятся отдельно. График здесь задаёт норму
          месячного начисления, а плановые смены и сотрудников задают позиции ниже. Для каждого тарифа выберите один режим:
          стандартный график или конкретные дни недели. Сохранённая история
          табеля не пересчитывается.
        </p>
      </div>

      {!showSeasonalProfiles && [...invalidProfiles].some((title) => title !== 'По умолчанию') ? <Alert tone="warning">В сезонных тарифах остался незавершённый график. Включите сезонность и проверьте его перед сохранением. Введённые значения сохранены в черновике.</Alert> : null}

      <div className={styles.profileGrid}>
        {PROFILES.filter((profile) => showSeasonalProfiles || profile.id === 'default').map((profile) => {
          const paymentType = value[profile.typeKey] as 'monthly' | 'daily';
          const weekdays = value[profile.weekdaysKey] as string[];
          const scheduleCode = value[profile.scheduleCodeKey] as string;
          const cycleStartDate = value[profile.cycleStartDateKey] as string;
          const scheduleMode: ScheduleMode = weekdays.length > 0 || !SCHEDULE_OPTIONS.some((option) => option.value === scheduleCode)
            ? 'weekdays'
            : 'template';

          return (
            <fieldset className={styles.profile} key={profile.id}>
              <legend>{profile.title}</legend>

              <SearchableSelect
                label="Тип начисления"
                value={paymentType}
                options={PAYMENT_OPTIONS}
                searchable={false}
                clearable={false}
                viewportAware
                disabled={disabled}
                onChange={(nextValue) =>
                  updateField(profile.typeKey, nextValue as 'monthly' | 'daily')
                }
              />

              <label className={styles.field}>
                <span>Ставка за выход, ₽</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={value[profile.dailyRateKey] as string}
                  disabled={disabled}
                  onChange={(event) => updateField(profile.dailyRateKey, event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>Сумма за месяц, ₽</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={value[profile.monthlySalaryKey] as string}
                  disabled={disabled}
                  onChange={(event) => updateField(profile.monthlySalaryKey, event.target.value)}
                />
              </label>

              <fieldset className={styles.scheduleField}>
                <legend>Норма месячного начисления</legend>
                <div className={styles.scheduleModes} role="radiogroup" aria-label={`Режим графика: ${profile.title}`}>
                  <label className={styles.scheduleMode}>
                    <input
                      type="radio"
                      name={`${profile.id}-schedule-mode`}
                      checked={scheduleMode === 'template'}
                      disabled={disabled}
                      onChange={() => changeScheduleMode(profile, 'template')}
                    />
                    <span>Стандартный график</span>
                  </label>
                  <label className={styles.scheduleMode}>
                    <input
                      type="radio"
                      name={`${profile.id}-schedule-mode`}
                      checked={scheduleMode === 'weekdays'}
                      disabled={disabled}
                      onChange={() => changeScheduleMode(profile, 'weekdays')}
                    />
                    <span>Дни недели</span>
                  </label>
                </div>

                {scheduleMode === 'template' ? (
                  <>
                    <SearchableSelect
                      label="Шаблон графика"
                      value={scheduleCode || '5/2'}
                      options={SCHEDULE_OPTIONS}
                      searchable={false}
                      clearable={false}
                      viewportAware
                      disabled={disabled}
                      onChange={(nextValue) => {
                        onChange({
                          ...value,
                          [profile.scheduleCodeKey]: nextValue,
                          [profile.cycleStartDateKey]: nextValue === '5/2' ? '' : cycleStartDate,
                        } as ObjectCompensationProfilesValue);
                      }}
                    />
                    {scheduleCode !== '5/2' ? (
                      <label className={styles.field}>
                        <span>Дата первого рабочего дня цикла *</span>
                        <DatePicker value={cycleStartDate} required disabled={disabled} aria-describedby={`${profile.id}-cycle-start-hint`} onChange={(nextValue) => updateField(profile.cycleStartDateKey, nextValue)} />
                        <small id={`${profile.id}-cycle-start-hint`} className={styles.weekdayHint}>
                          Укажите дату, с которой начинается цикл графика {scheduleCode}.
                        </small>
                      </label>
                    ) : (
                      <span className={styles.weekdayHint}>Для графика 5/2 применяется производственный календарь.</span>
                    )}
                  </>
                ) : (
                  <div className={styles.weekdayMode}>
                    <span className={styles.weekdayHint}>Выберите рабочие дни — например, только среду.</span>
                    <div className={styles.weekdayOptions}>
                      {WEEKDAYS.map(([code, label]) => (
                        <label className={styles.weekday} key={code}>
                          <input
                            type="checkbox"
                            checked={weekdays.includes(code)}
                            disabled={disabled || (weekdays.length === 1 && weekdays.includes(code))}
                            onChange={(event) =>
                              updateField(
                                profile.weekdaysKey,
                                event.target.checked
                                  ? [...weekdays, code]
                                  : weekdays.filter((day) => day !== code),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {invalidProfiles.has(profile.title) ? (
                  <span className={styles.weekdayError} role="alert" aria-live="polite">
                    {scheduleMode === 'weekdays'
                      ? weekdays.length === 0
                        ? 'Выберите хотя бы один день недели.'
                        : 'Проверьте выбранные дни недели.'
                      : !SCHEDULE_OPTIONS.some((option) => option.value === scheduleCode)
                        ? 'Выберите стандартный график.'
                        : 'Укажите дату первого рабочего дня цикла.'}
                  </span>
                ) : null}
              </fieldset>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
