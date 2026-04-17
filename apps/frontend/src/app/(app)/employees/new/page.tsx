'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createEmployee } from '@/entities/employee/api/employee-client';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function NewEmployeePage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const canManageEmployeesHr = user?.capabilities?.canManageEmployeesHr ?? false;

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    residenceAddress: '',
    shiftPreferences: '',
    baseDailyRate: '',
    notes: '',
    employmentStatus: 'active',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <>
      <PageTitle title="Создать сотрудника" />

      {!canManageEmployeesHr ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          У вас нет прав на создание employee-карточек.
        </div>
      ) : (
        <form
          className="page-card"
          style={{ display: 'grid', gap: 16, maxWidth: 900 }}
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setIsSubmitting(true);

            try {
              const created = await createEmployee({
                fullName: form.fullName.trim(),
                phone: form.phone.trim() || undefined,
                residenceAddress: form.residenceAddress.trim() || undefined,
                shiftPreferences: form.shiftPreferences.trim() || undefined,
                baseDailyRate: form.baseDailyRate.trim()
                  ? Number(form.baseDailyRate)
                  : undefined,
                notes: form.notes.trim() || undefined,
                employmentStatus: form.employmentStatus,
              });

              router.push(`/employees/${created.id}`);
            } catch (caughtError) {
              if (caughtError instanceof Error && caughtError.message) {
                setError(caughtError.message);
              } else {
                setError('Не удалось создать сотрудника.');
              }
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 18 }}>Новая employee-карточка</div>

          {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

          <label>
            <div style={{ marginBottom: 6 }}>ФИО</div>
            <input
              value={form.fullName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, fullName: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Телефон</div>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Место проживания</div>
            <input
              value={form.residenceAddress}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  residenceAddress: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Пожелания по выходам</div>
            <textarea
              value={form.shiftPreferences}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  shiftPreferences: event.target.value,
                }))
              }
              style={{ width: '100%', minHeight: 100, padding: 10 }}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Базовая ставка</div>
            <input
              type="number"
              min="0"
              step="1"
              value={form.baseDailyRate}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  baseDailyRate: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Статус занятости</div>
            <select
              value={form.employmentStatus}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  employmentStatus: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="active">Активен</option>
              <option value="inactive">Неактивен</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
              style={{ width: '100%', minHeight: 100, padding: 10 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Создание...' : 'Создать сотрудника'}
            </button>

            <button
              type="button"
              onClick={() => router.push('/employees')}
              disabled={isSubmitting}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </>
  );
}
