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
    position: '',
    birthDate: '',
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
          У вас нет прав на создание карточек сотрудников.
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
                phone: form.phone.trim() || null,
                position: form.position.trim() || null,
                birthDate: form.birthDate || null,
                residenceAddress: form.residenceAddress.trim() || null,
                shiftPreferences: form.shiftPreferences.trim() || null,
                baseDailyRate: form.baseDailyRate.trim()
                  ? Number(form.baseDailyRate)
                  : undefined,
                notes: form.notes.trim() || null,
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
          <div className="section-header">
            <div>
              <div className="section-title">Новая карточка сотрудника</div>
              <div className="section-subtitle">
                Назначения на объекты настраиваются отдельно после создания.
              </div>
            </div>
          </div>

          {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

          <label>
            <div style={{ marginBottom: 6 }}>ФИО</div>
            <input
              value={form.fullName}
              maxLength={200}
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
              maxLength={50}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <div className="field-grid">
            <label>
              <div style={{ marginBottom: 6 }}>Должность</div>
              <input
                value={form.position}
                maxLength={150}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, position: event.target.value }))
                }
                style={{ width: '100%' }}
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Дата рождения</div>
              <input
                type="date"
                value={form.birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, birthDate: event.target.value }))
                }
                style={{ width: '100%' }}
              />
            </label>
          </div>

          <label>
            <div style={{ marginBottom: 6 }}>Место проживания</div>
            <input
              value={form.residenceAddress}
              maxLength={1000}
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
              maxLength={2000}
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
              maxLength={4000}
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
