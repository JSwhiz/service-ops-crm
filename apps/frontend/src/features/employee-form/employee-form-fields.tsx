'use client';

import React from 'react';

import {
  EMPLOYEE_SCHEDULE_OPTIONS,
  EMPLOYEE_TYPE_OPTIONS,
} from '@/entities/employee/lib/employee-presentation';
import type {
  EmployeeType,
  EmployeeWorkScheduleCode,
} from '@/entities/employee/model/employee.types';

export interface EmployeeFormValue {
  fullName: string;
  phone: string;
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

export function EmployeeFormFields({
  value,
  onChange,
  disabled = false,
}: EmployeeFormFieldsProps): React.JSX.Element {
  const update = <K extends keyof EmployeeFormValue>(
    key: K,
    nextValue: EmployeeFormValue[K],
  ): void => onChange({ ...value, [key]: nextValue });

  return (
    <div className="employee-form-sections">
      <fieldset disabled={disabled}>
        <legend>Основное</legend>
        <div className="employee-form-grid">
          <label>
            <span className="detail-label">ФИО *</span>
            <input value={value.fullName} maxLength={200} required onChange={(event) => update('fullName', event.target.value)} />
          </label>
          <label>
            <span className="detail-label">Телефон</span>
            <input value={value.phone} maxLength={50} onChange={(event) => update('phone', event.target.value)} />
          </label>
          <label>
            <span className="detail-label">Дата рождения</span>
            <input type="date" value={value.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => update('birthDate', event.target.value)} />
          </label>
          <label>
            <span className="detail-label">Адрес проживания</span>
            <input value={value.residenceAddress} maxLength={1000} onChange={(event) => update('residenceAddress', event.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Работа</legend>
        <div className="employee-form-grid">
          <label>
            <span className="detail-label">Тип сотрудника *</span>
            <select value={value.employeeType} required onChange={(event) => update('employeeType', event.target.value as EmployeeType)}>
              {EMPLOYEE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span className="detail-label">Должность</span>
            <input value={value.position} maxLength={150} onChange={(event) => update('position', event.target.value)} />
          </label>
          <label>
            <span className="detail-label">Статус работы *</span>
            <select value={value.employmentStatus} required onChange={(event) => update('employmentStatus', event.target.value)}>
              <option value="active">Работает</option>
              <option value="inactive">Неактивен</option>
            </select>
          </label>
          <label>
            <span className="detail-label">Базовая ставка за день</span>
            <input type="number" min="0" step="0.01" value={value.baseDailyRate} onChange={(event) => update('baseDailyRate', event.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>График</legend>
        <div className="employee-form-grid">
          <label>
            <span className="detail-label">График работы</span>
            <select value={value.workScheduleCode} onChange={(event) => {
              const nextCode = event.target.value as EmployeeWorkScheduleCode | '';
              onChange({ ...value, workScheduleCode: nextCode, workScheduleCustom: nextCode === 'custom' ? value.workScheduleCustom : '' });
            }}>
              <option value="">Не указан</option>
              {EMPLOYEE_SCHEDULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {value.workScheduleCode === 'custom' ? (
            <label>
              <span className="detail-label">Описание графика *</span>
              <input value={value.workScheduleCustom} maxLength={500} required
                placeholder="Например: Пн, Ср, Пт и каждая вторая суббота"
                onChange={(event) => update('workScheduleCustom', event.target.value)} />
            </label>
          ) : null}
          <label>
            <span className="detail-label">Время работы</span>
            <input value={value.workTimeText} maxLength={200} placeholder="Например: 08:00–17:00" onChange={(event) => update('workTimeText', event.target.value)} />
            <small className="page-muted">Время вводится вручную, можно указать произвольный режим.</small>
          </label>
          <label>
            <span className="detail-label">Предпочтения по сменам</span>
            <textarea value={value.shiftPreferences} maxLength={2000} onChange={(event) => update('shiftPreferences', event.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Дополнительно</legend>
        <label>
          <span className="detail-label">Примечание</span>
          <textarea value={value.notes} maxLength={4000} onChange={(event) => update('notes', event.target.value)} />
        </label>
      </fieldset>
    </div>
  );
}
