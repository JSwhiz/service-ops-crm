'use client';

import React from 'react';

import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './object-compensation-profiles.module.css';

export interface ObjectCompensationProfilesValue {
  paymentType: 'monthly' | 'daily';
  dailyRate: string;
  monthlySalary: string;
  paymentScheduleCode: string;
  paymentScheduleWeekdays: string[];
  summerPaymentType: 'monthly' | 'daily';
  summerDailyRate: string;
  summerMonthlySalary: string;
  summerScheduleCode: string;
  summerScheduleWeekdays: string[];
  winterPaymentType: 'monthly' | 'daily';
  winterDailyRate: string;
  winterMonthlySalary: string;
  winterScheduleCode: string;
  winterScheduleWeekdays: string[];
}

interface ObjectCompensationProfilesProps {
  value: ObjectCompensationProfilesValue;
  onChange: (value: ObjectCompensationProfilesValue) => void;
  disabled?: boolean;
}

const PAYMENT_OPTIONS = [
  { value: 'monthly', label: 'Фиксированный оклад за месяц' },
  { value: 'daily', label: 'Ставка за фактический выход' },
];

const SCHEDULE_OPTIONS = ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'].map((code) => ({
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

const PROFILES = [
  {
    id: 'default',
    title: 'По умолчанию',
    typeKey: 'paymentType',
    dailyRateKey: 'dailyRate',
    monthlySalaryKey: 'monthlySalary',
    scheduleCodeKey: 'paymentScheduleCode',
    weekdaysKey: 'paymentScheduleWeekdays',
  },
  {
    id: 'summer',
    title: 'Летний тариф',
    typeKey: 'summerPaymentType',
    dailyRateKey: 'summerDailyRate',
    monthlySalaryKey: 'summerMonthlySalary',
    scheduleCodeKey: 'summerScheduleCode',
    weekdaysKey: 'summerScheduleWeekdays',
  },
  {
    id: 'winter',
    title: 'Зимний тариф',
    typeKey: 'winterPaymentType',
    dailyRateKey: 'winterDailyRate',
    monthlySalaryKey: 'winterMonthlySalary',
    scheduleCodeKey: 'winterScheduleCode',
    weekdaysKey: 'winterScheduleWeekdays',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  typeKey: keyof ObjectCompensationProfilesValue;
  dailyRateKey: keyof ObjectCompensationProfilesValue;
  monthlySalaryKey: keyof ObjectCompensationProfilesValue;
  scheduleCodeKey: keyof ObjectCompensationProfilesValue;
  weekdaysKey: keyof ObjectCompensationProfilesValue;
}>;

export function ObjectCompensationProfiles({
  value,
  onChange,
  disabled = false,
}: ObjectCompensationProfilesProps): React.JSX.Element {
  const updateField = <Key extends keyof ObjectCompensationProfilesValue,>(
    key: Key,
    nextValue: ObjectCompensationProfilesValue[Key],
  ): void => {
    onChange({ ...value, [key]: nextValue } as ObjectCompensationProfilesValue);
  };

  return (
    <section className={styles.profiles} aria-labelledby="object-compensation-title">
      <div className={styles.intro}>
        <h3 id="object-compensation-title">Условия оплаты объекта</h3>
        <p>
          Сумма за выход и оклад хранятся отдельно. При месячной модели график
          участвует в расчёте начислений; конкретные дни недели имеют приоритет
          над шаблоном. Фактические значения формирует система, сохранённая
          история табеля не пересчитывается.
        </p>
      </div>

      <div className={styles.profileGrid}>
        {PROFILES.map((profile) => {
          const paymentType = value[profile.typeKey] as 'monthly' | 'daily';
          const weekdays = value[profile.weekdaysKey] as string[];

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

              <SearchableSelect
                label="Шаблон графика"
                value={value[profile.scheduleCodeKey] as string}
                options={SCHEDULE_OPTIONS}
                searchable={false}
                clearable={false}
                viewportAware
                disabled={disabled}
                onChange={(nextValue) => updateField(profile.scheduleCodeKey, nextValue)}
              />

              <fieldset className={styles.weekdaysField}>
                <legend>Или выберите конкретные рабочие дни</legend>
                <div className={styles.weekdayOptions}>
                  {WEEKDAYS.map(([code, label]) => (
                    <label className={styles.weekday} key={code}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(code)}
                        disabled={disabled}
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
              </fieldset>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
