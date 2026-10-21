'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { createEmployee } from '@/entities/employee/api/employee-client';
import {
  EmployeeFormFields,
  type EmployeeFormValue,
} from '@/features/employee-form/employee-form-fields';
import { phoneDrafts, phoneDraftsValid } from '@/shared/ui/phone-list-field/phone-list-field';
import { toEmployeeMutationPayload } from '@/features/employee-form/employee-form-payload';
import styles from '@/features/employee-workspace/ui/employee-workspace.module.css';
import { useAuth } from '@/shared/auth/use-auth';
import { Alert, BackLink, Button, PageHeader, Surface } from '@/shared/ui/foundation';

const INITIAL_FORM: EmployeeFormValue = {
  passportReceived: false,
  contractReceived: false,
  fullName: '',
  phones: phoneDrafts([]),
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
    <div className={`${styles.page} ${styles.formPage}`}>
      <BackLink href="/employees">Сотрудники</BackLink>
      <PageHeader title="Новый сотрудник" />

      {!canCreate ? (
        <Alert tone="warning">У вас нет прав на создание карточек сотрудников.</Alert>
      ) : (
        <Surface className={styles.formSurface}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!phoneDraftsValid(form.phones)) return;
              setError(null);
              setIsSubmitting(true);
              try {
                const created = await createEmployee({
                  ...toEmployeeMutationPayload(form),
                  fullName: form.fullName.trim(),
                });
                router.push(`/employees/${created.id}`);
              } catch (caughtError) {
                setError(caughtError instanceof Error && caughtError.message
                  ? caughtError.message : 'Не удалось создать сотрудника.');
                setIsSubmitting(false);
              }
            }}
          >
            {error ? (
              <Alert tone="danger" role="alert" title="Карточка не создана" className={styles.formAlert}>
                {error}
              </Alert>
            ) : null}
            <EmployeeFormFields value={form} onChange={setForm} disabled={isSubmitting} />
            <div className={styles.formActions}>
              <Button variant="ghost" disabled={isSubmitting} onClick={() => router.push('/employees')}>
                Отмена
              </Button>
              <Button type="submit" variant="primary" pending={isSubmitting} pendingLabel="Создание…">
                Создать сотрудника
              </Button>
            </div>
          </form>
        </Surface>
      )}
    </div>
  );
}
