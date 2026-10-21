'use client';

import React, { useEffect, useId, useState } from 'react';

import { listEmployeePositionReferences } from '@/entities/employee/api/employee-client';
import {
  EMPLOYEE_SCHEDULE_OPTIONS,
  EMPLOYEE_TYPE_OPTIONS,
} from '@/entities/employee/lib/employee-presentation';
import type {
  EmployeeType,
  EmployeeWorkScheduleCode,
} from '@/entities/employee/model/employee.types';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Field } from '@/shared/ui/foundation';
import {
  PhoneListField,
  type PhoneDraft,
} from '@/shared/ui/phone-list-field/phone-list-field';
import { SelectField } from '@/shared/ui/searchable-select/select-field';

import styles from './employee-form.module.css';

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Работает' },
  { value: 'inactive', label: 'Неактивен' },
];

export interface EmployeeFormValue {
  passportReceived: boolean;
  contractReceived: boolean;
  fullName: string;
  phones: PhoneDraft[];
  birthDate: string;
  residenceAddress: string;
  employeeType: EmployeeType;
  position: string;
  employmentStatus: string;
  baseDailyRate: string;
  workScheduleCode: EmployeeWorkScheduleCode | '';
  workScheduleCustom: string;
  workTimeText: string;
  shiftPreferences: string;
  notes: string;
}

interface EmployeeFormFieldsProps {
  value: EmployeeFormValue;
  onChange: (value: EmployeeFormValue) => void;
  disabled?: boolean;
}

function FormSection({
  title,
  description,
  disabled,
  children,
}: {
  title: string;
  description?: string;
  disabled: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <div className={styles.section} role="group" aria-labelledby={titleId}>
        <div className={styles.sectionHeading}>
          <h3 id={titleId} className={styles.sectionTitle}>{title}</h3>
          {description ? <p className={styles.sectionDescription}>{description}</p> : null}
        </div>
        <div className={styles.grid}>{children}</div>
      </div>
    </fieldset>
  );
}

/** Shared create/edit fields. Payload shape is owned by the pages and unchanged. */
export function EmployeeFormFields({
  value,
  onChange,
  disabled = false,
}: EmployeeFormFieldsProps): React.JSX.Element {
  const positionListId = useId();
  const [positions, setPositions] = useState<string[]>([]);
  const update = <K extends keyof EmployeeFormValue>(
    key: K,
    nextValue: EmployeeFormValue[K],
  ): void => onChange({ ...value, [key]: nextValue });

  useEffect(() => {
    let cancelled = false;
    // Suggestions only: free text stays allowed, but existing spellings are offered first.
    void listEmployeePositionReferences()
      .then((items) => { if (!cancelled) setPositions(items.map((item) => item.label)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.form}>
      <p className={styles.requiredNote}>* — обязательные поля</p>

      <FormSection title="Основное" disabled={disabled}>
        <Field className={styles.full} label="ФИО" required>
          <input value={value.fullName} maxLength={200} autoComplete="off"
            placeholder="Фамилия Имя Отчество"
            onChange={(event) => update('fullName', event.target.value)} />
        </Field>
        <PhoneListField phones={value.phones} disabled={disabled}
          onChange={(phones) => update('phones', phones)} />
        <Field label="Дата рождения">
          <DatePicker value={value.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(nextValue) => update('birthDate', nextValue)} />
        </Field>
        <Field className={styles.full} label="Адрес проживания">
          <input value={value.residenceAddress} maxLength={1000}
            onChange={(event) => update('residenceAddress', event.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Работа" disabled={disabled}>
        <SelectField
          label="Тип сотрудника"
          required
          value={value.employeeType}
          options={EMPLOYEE_TYPE_OPTIONS}
          clearable={false}
          searchable={false}
          disabled={disabled}
          onChange={(nextValue) => update('employeeType', nextValue as EmployeeType)}
        />
        <SelectField
          label="Статус работы"
          required
          value={value.employmentStatus}
          options={EMPLOYMENT_STATUS_OPTIONS}
          clearable={false}
          searchable={false}
          disabled={disabled}
          onChange={(nextValue) => update('employmentStatus', nextValue)}
        />
        <Field label="Должность">
          <input value={value.position} maxLength={150} list={positionListId}
            onChange={(event) => update('position', event.target.value)} />
        </Field>
        <Field label="Базовая ставка за день, ₽">
          <input inputMode="numeric" autoComplete="off" placeholder="Не задана"
            value={value.baseDailyRate}
            onChange={(event) => update('baseDailyRate', event.target.value.replace(/\D/g, '').slice(0, 9))} />
        </Field>
        <datalist id={positionListId}>
          {positions.map((position) => <option key={position} value={position} />)}
        </datalist>
      </FormSection>

      <FormSection
        title="Рабочий режим"
        description="Для подбора смен. Выходы считаются по табелю."
        disabled={disabled}
      >
        <SelectField
          label="График работы"
          value={value.workScheduleCode}
          options={EMPLOYEE_SCHEDULE_OPTIONS}
          placeholder="Не указан"
          searchable={false}
          disabled={disabled}
          onChange={(nextValue) => {
            const nextCode = nextValue as EmployeeWorkScheduleCode | '';
            onChange({
              ...value,
              workScheduleCode: nextCode,
              workScheduleCustom: nextCode === 'custom' ? value.workScheduleCustom : '',
            });
          }}
        />
        <Field label="Время работы">
          <input value={value.workTimeText} maxLength={200} placeholder="08:00–17:00"
            onChange={(event) => update('workTimeText', event.target.value)} />
        </Field>
        {value.workScheduleCode === 'custom' ? (
          <Field className={styles.full} label="Описание графика" required>
            <input value={value.workScheduleCustom} maxLength={300}
              placeholder="Например: Пн, Ср, Пт и каждая вторая суббота"
              onChange={(event) => update('workScheduleCustom', event.target.value)} />
          </Field>
        ) : null}
        <Field className={styles.full} label="Предпочтения по сменам">
          <textarea rows={3} value={value.shiftPreferences} maxLength={2000}
            onChange={(event) => update('shiftPreferences', event.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Документы" description="Дата и автор отметки сохраняются." disabled={disabled}>
        <div className={`${styles.full} ${styles.choices}`}>
          <label className={styles.choice}>
            <input type="checkbox" checked={value.passportReceived}
              onChange={(event) => update('passportReceived', event.target.checked)} />
            <span>Паспорт получен</span>
          </label>
          <label className={styles.choice}>
            <input type="checkbox" checked={value.contractReceived}
              onChange={(event) => update('contractReceived', event.target.checked)} />
            <span>Трудовой договор получен</span>
          </label>
        </div>
      </FormSection>

      <FormSection title="Примечание" disabled={disabled}>
        <Field className={styles.full} label="Комментарий для коллег">
          <textarea rows={4} value={value.notes} maxLength={4000}
            onChange={(event) => update('notes', event.target.value)} />
        </Field>
      </FormSection>
    </div>
  );
}
