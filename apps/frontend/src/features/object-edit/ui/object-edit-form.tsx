'use client';

import React, { useEffect, useState } from 'react';

import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';

interface ObjectEditFormProps {
  item: ServiceObject;
  canEditDailyRate: boolean;
  onSubmit: (payload: UpdateObjectPayload) => Promise<void>;
}

export function ObjectEditForm({
  item,
  canEditDailyRate,
  onSubmit,
}: ObjectEditFormProps): React.JSX.Element {
  const [form, setForm] = useState({
    name: item.name,
    internalName: item.internalName ?? '',
    address: item.address,
    seasonMode: item.seasonMode,
    dailyRate: String(item.dailyRate),
    notes: item.notes ?? '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: item.name,
      internalName: item.internalName ?? '',
      address: item.address,
      seasonMode: item.seasonMode,
      dailyRate: String(item.dailyRate),
      notes: item.notes ?? '',
    });
  }, [item]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const payload: UpdateObjectPayload = {
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        seasonMode: form.seasonMode,
        notes: form.notes.trim() || undefined,
      };

      if (canEditDailyRate) {
        payload.dailyRate = Number(form.dailyRate) || 0;
      }

      await onSubmit(payload);
      setSuccess('Изменения по объекту сохранены.');
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message) {
        setError(caughtError.message);
      } else {
        setError('Не удалось сохранить изменения объекта.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      className="page-card"
      onSubmit={handleSubmit}
      style={{ display: 'grid', gap: 16 }}
    >
      <div style={{ fontWeight: 600, fontSize: 18 }}>
        Редактирование карточки объекта
      </div>

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
            disabled={!canEditDailyRate}
          />
          {!canEditDailyRate ? (
            <div className="page-muted" style={{ marginTop: 6 }}>
              Изменение ставки доступно только учредителю и директору.
            </div>
          ) : null}
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

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      {success ? <div style={{ color: '#15803d' }}>{success}</div> : null}

      <div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}
