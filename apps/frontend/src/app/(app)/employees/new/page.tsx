'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { createEmployee } from '@/entities/employee/api/employee-client';
import {
  EmployeeFormFields,
  type EmployeeFormValue,
} from '@/features/employee-form/employee-form-fields';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const INITIAL_FORM: EmployeeFormValue = {
  fullName: '',
  phone: '',
  birthDate: '',
  residenceAddress: '',
  employeeType: 'regular',
  position: '',
  employmentStatus: 'active',
  baseDailyRate: '',
  workScheduleCode: '',
  workScheduleCustom: '',
  workTimeText: '',
  shiftPreferences: '',
  notes: '',
};

export default function NewEmployeePage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const canCreate = user?.capabilities?.canCreateEmployee ?? false;
  const [form, setForm] = useState<EmployeeFormValue>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <>
      <PageTitle title="Добавить сотрудника" />
      {!canCreate ? (
        <div className="page-card inline-notice inline-notice--warning">
          У вас нет прав на создание карточек сотрудников.
        </div>
      ) : (
        <form
          className="page-card employee-edit-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setIsSubmitting(true);
            try {
              const created = await createEmployee({
                fullName: form.fullName.trim(),
                phone: form.phone.trim() || null,
                birthDate: form.birthDate || null,
                residenceAddress: form.residenceAddress.trim() || null,
                employeeType: form.employeeType,
                position: form.position.trim() || null,
                employmentStatus: form.employmentStatus,
                baseDailyRate: form.baseDailyRate.trim() ? Number(form.baseDailyRate) : null,
                workScheduleCode: form.workScheduleCode || null,
                workScheduleCustom: form.workScheduleCustom.trim() || null,
                workTimeText: form.workTimeText.trim() || null,
                shiftPreferences: form.shiftPreferences.trim() || null,
                notes: form.notes.trim() || null,
              });
              router.push(`/employees/${created.id}`);
            } catch (caughtError) {
              setError(caughtError instanceof Error && caughtError.message
                ? caughtError.message : 'Не удалось создать сотрудника.');
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="section-header">
            <div>
              <div className="section-title">Новая карточка сотрудника</div>
              <div className="section-subtitle">Назначения на объекты настраиваются после создания карточки.</div>
            </div>
          </div>
          {error ? <div className="inline-notice inline-notice--warning">{error}</div> : null}
          <EmployeeFormFields value={form} onChange={setForm} disabled={isSubmitting} />
          <div className="action-row employee-form-actions">
            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Создание...' : 'Добавить сотрудника'}</button>
            <button type="button" className="button-secondary" onClick={() => router.push('/employees')} disabled={isSubmitting}>Отмена</button>
          </div>
        </form>
      )}
    </>
  );
}
