'use client';

import React, { useEffect, useMemo, useState } from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

interface ObjectEditPanelProps {
  item: ServiceObject;
  canEditCard: boolean;
  canEditDailyRate: boolean;
  canOverrideFrozen: boolean;
  onSave: (payload: {
    name?: string;
    internalName?: string;
    address?: string;
    status?: string;
    seasonMode?: string;
    dailyRate?: number;
    notes?: string;
  }) => Promise<void>;
}

interface FormState {
  name: string;
  internalName: string;
  address: string;
  status: string;
  seasonMode: string;
  dailyRate: string;
  notes: string;
}

function buildInitialForm(item: ServiceObject): FormState {
  return {
    name: item.name,
    internalName: item.internalName ?? '',
    address: item.address,
    status: item.status,
    seasonMode: item.seasonMode,
    dailyRate: String(item.dailyRate),
    notes: item.notes ?? '',
  };
}

export function ObjectEditPanel({
  item,
  canEditCard,
  canEditDailyRate,
  canOverrideFrozen,
  onSave,
}: ObjectEditPanelProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(buildInitialForm(item));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setForm(buildInitialForm(item));
  }, [item]);

  const allowStatusEdit = useMemo(() => {
    if (item.status === 'frozen') {
      return canOverrideFrozen;
    }

    return canEditCard;
  }, [item.status, canEditCard, canOverrideFrozen]);

  const allowBaseFieldsEdit = useMemo(() => {
    if (item.status === 'frozen') {
      return canOverrideFrozen;
    }

    return canEditCard;
  }, [item.status, canEditCard, canOverrideFrozen]);

  const allowDailyRateEdit = useMemo(() => {
    if (!canEditDailyRate) {
      return false;
    }

    if (item.status === 'frozen') {
      return canOverrideFrozen;
    }

    return true;
  }, [item.status, canEditDailyRate, canOverrideFrozen]);

  const resetForm = (): void => {
    setForm(buildInitialForm(item));
    setError(null);
    setIsEditing(false);
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!allowBaseFieldsEdit && !allowDailyRateEdit && !allowStatusEdit) {
      setError('У вашей роли нет прав на редактирование объекта.');
      return;
    }

    const payload: {
      name?: string;
      internalName?: string;
      address?: string;
      status?: string;
      seasonMode?: string;
      dailyRate?: number;
      notes?: string;
    } = {};

    if (allowBaseFieldsEdit) {
      payload.name = form.name.trim();
      payload.internalName = form.internalName.trim();
      payload.address = form.address.trim();
      payload.seasonMode = form.seasonMode;
      payload.notes = form.notes.trim();
    }

    if (allowStatusEdit) {
      payload.status = form.status;
    }

    if (allowDailyRateEdit) {
      payload.dailyRate = Number(form.dailyRate) || 0;
    }

    setIsSubmitting(true);

    try {
      await onSave(payload);
      setIsEditing(false);
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
    <div className="page-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 18 }}>
          Редактирование объекта
        </div>

        {!isEditing ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsEditing(true);
            }}
            disabled={!canEditCard && !canEditDailyRate && !canOverrideFrozen}
          >
            Редактировать
          </button>
        ) : null}
      </div>

      {!isEditing ? (
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <div>
            <div className="page-muted">Название</div>
            <div>{item.name}</div>
          </div>

          <div>
            <div className="page-muted">Внутреннее имя</div>
            <div>{item.internalName ?? '—'}</div>
          </div>

          <div>
            <div className="page-muted">Статус</div>
            <div>{item.status}</div>
          </div>

          <div>
            <div className="page-muted">Сезон</div>
            <div>{item.seasonMode}</div>
          </div>

          <div>
            <div className="page-muted">Ставка за день</div>
            <div>{item.dailyRate}</div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="page-muted">Адрес</div>
            <div>{item.address}</div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="page-muted">Комментарий</div>
            <div>{item.notes?.trim() ? item.notes : '—'}</div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
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
                disabled={!allowBaseFieldsEdit || isSubmitting}
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
                disabled={!allowBaseFieldsEdit || isSubmitting}
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
                disabled={!allowBaseFieldsEdit || isSubmitting}
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
                disabled={!allowStatusEdit || isSubmitting}
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
                disabled={!allowBaseFieldsEdit || isSubmitting}
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
                disabled={!allowDailyRateEdit || isSubmitting}
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
                disabled={!allowBaseFieldsEdit || isSubmitting}
              />
            </label>
          </div>

          {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Сохраняем...' : 'Сохранить изменения'}
            </button>

            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
