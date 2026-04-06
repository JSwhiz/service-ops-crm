'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createObject } from '@/entities/object/api/object-client';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function NewObjectPage(): React.JSX.Element {
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    internalName: '',
    address: '',
    status: 'active',
    seasonMode: 'summer',
    dailyRate: '0',
    notes: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await createObject({
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        status: form.status,
        seasonMode: form.seasonMode,
        dailyRate: Number(form.dailyRate) || 0,
        notes: form.notes.trim() || undefined,
        managerUserIds: [],
      });

      router.push('/objects');
    } catch {
      setError('Не удалось создать объект.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageTitle title="Создать объект" />

      <form
        className="page-card"
        onSubmit={handleSubmit}
        style={{ display: 'grid', gap: 16, maxWidth: 720 }}
      >
        <div style={{ fontWeight: 600, fontSize: 18 }}>Новый объект</div>

        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          <label>
            <div style={{ marginBottom: 6 }}>Название</div>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Внутреннее имя</div>
            <input
              value={form.internalName}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  internalName: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 6 }}>Адрес</div>
            <input
              value={form.address}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, address: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
              required
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Статус</div>
            <select
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="active">Активный</option>
              <option value="frozen">Заморожен</option>
              <option value="archived">Архив</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Сезон</div>
            <select
              value={form.seasonMode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  seasonMode: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="summer">Летний</option>
              <option value="winter">Зимний</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Ставка за день</div>
            <input
              type="number"
              min="0"
              step="1"
              value={form.dailyRate}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  dailyRate: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 6 }}>Комментарий</div>
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
              style={{ width: '100%', minHeight: 120, padding: 10 }}
            />
          </label>
        </div>

        <div className="page-muted">
          Создатель объекта автоматически станет ответственным. Сотрудники на объект
          назначаются позже менеджером объекта.
        </div>

        {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Создаем...' : 'Создать объект'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/objects')}
            disabled={isSubmitting}
          >
            Отмена
          </button>
        </div>
      </form>
    </>
  );
}
