'use client';

import React, { useEffect, useState } from 'react';

import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listObjectResponsibleCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { UserSearchSelect } from '@/shared/ui/user-search-select/user-search-select';

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
    responsibleUserId: item.responsible?.id ?? '',
    seasonMode: item.seasonMode ?? '',
    dailyRate: String(item.dailyRate),
    notes: item.notes ?? '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [responsibleCandidates, setResponsibleCandidates] = useState<
    SystemUserOption[]
  >([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [isCandidatesLoading, setIsCandidatesLoading] = useState(true);

  useEffect(() => {
    setForm({
      name: item.name,
      internalName: item.internalName ?? '',
      address: item.address,
      responsibleUserId: item.responsible?.id ?? '',
      seasonMode: item.seasonMode ?? '',
      dailyRate: String(item.dailyRate),
      notes: item.notes ?? '',
    });
  }, [item]);

  useEffect(() => {
    let cancelled = false;

    const loadCandidates = async (): Promise<void> => {
      setIsCandidatesLoading(true);
      setCandidatesError(null);

      try {
        const candidates = await listObjectResponsibleCandidates(item.id);

        if (!cancelled) {
          setResponsibleCandidates(candidates);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setCandidatesError(
            caughtError instanceof Error && caughtError.message
              ? caughtError.message
              : 'Не удалось загрузить ответственных.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsCandidatesLoading(false);
        }
      }
    };

    void loadCandidates();

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.responsibleUserId) {
      setError('Выберите ответственного за объект.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: UpdateObjectPayload = {
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        seasonMode: form.seasonMode || null,
        notes: form.notes.trim() || undefined,
        responsibleUserId: form.responsibleUserId,
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

        <div style={{ gridColumn: '1 / -1' }}>
          {isCandidatesLoading ? (
            <div className="page-muted">Загрузка ответственных...</div>
          ) : candidatesError ? (
            <div style={{ color: '#b91c1c' }}>{candidatesError}</div>
          ) : (
            <UserSearchSelect
              label="Ответственный"
              options={responsibleCandidates}
              value={form.responsibleUserId}
              onChange={(responsibleUserId) =>
                setForm((prev) => ({ ...prev, responsibleUserId }))
              }
              disabled={isSubmitting}
              required
            />
          )}
        </div>

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
            <option value="">Без сезонности</option>
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
        <button
          type="submit"
          disabled={
            isSubmitting || isCandidatesLoading || !form.responsibleUserId
          }
        >
          {isSubmitting ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}
