'use client';

import React, { useEffect, useMemo, useState } from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';

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
    seasonMode?: string | null;
    dailyRate?: number;
    notes?: string;
  }) => Promise<void>;
}

interface FormState {
  name: string;
  internalName: string;
  address: string;
  status: string;
  dailyRate: string;
  notes: string;
}

function buildInitialForm(item: ServiceObject): FormState {
  return {
    name: item.name,
    internalName: item.internalName ?? '',
    address: item.address,
    status: item.status,
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
      seasonMode?: string | null;
      dailyRate?: number;
      notes?: string;
    } = {};

    if (allowBaseFieldsEdit) {
      payload.name = form.name.trim();
      payload.internalName = form.internalName.trim();
      payload.address = form.address.trim();
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
    <Surface padding="md">
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
          <Button
            onClick={() => {
              setError(null);
              setIsEditing(true);
            }}
            disabled={!canEditCard && !canEditDailyRate && !canOverrideFrozen}
          >
            Редактировать
          </Button>
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
            <div className="ui-text-muted">Название</div>
            <div>{item.name}</div>
          </div>

          <div>
            <div className="ui-text-muted">Внутреннее имя</div>
            <div>{item.internalName ?? '—'}</div>
          </div>

          <div>
            <div className="ui-text-muted">Статус</div>
            <div>{item.status}</div>
          </div>

          <div>
            <div className="ui-text-muted">Сезон</div>
            <div>
              {item.seasonMode === 'summer'
                ? 'Летний'
                : item.seasonMode === 'winter'
                  ? 'Зимний'
                  : 'Без сезонности'}
            </div>
          </div>

          <div>
            <div className="ui-text-muted">Ставка за день</div>
            <div>{item.dailyRate}</div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ui-text-muted">Адрес</div>
            <div>{item.address}</div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ui-text-muted">Комментарий</div>
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
            <Field label="Название">
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                disabled={!allowBaseFieldsEdit || isSubmitting}
                required
              />
            </Field>

            <Field label="Внутреннее имя">
              <input
                value={form.internalName}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    internalName: event.target.value,
                  }))
                }
                disabled={!allowBaseFieldsEdit || isSubmitting}
                required
              />
            </Field>

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

            <div>
              <SearchableSelect
                label="Статус"
                value={form.status}
                onChange={(status) => setForm((prev) => ({ ...prev, status }))}
                options={[
                  { value: 'active', label: 'Активный' },
                  { value: 'frozen', label: 'Заморожен' },
                  { value: 'archived', label: 'Архив' },
                ]}
                searchable={false}
                clearable={false}
                viewportAware
                disabled={!allowStatusEdit || isSubmitting}
              />
            </div>

            <Field label="Ставка за день">
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
                disabled={!allowDailyRateEdit || isSubmitting}
              />
            </Field>

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

          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Сохраняем...' : 'Сохранить изменения'}
            </Button>

            <Button
              onClick={resetForm}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Surface>
  );
}
