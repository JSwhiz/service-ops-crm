'use client';

import React, { useEffect, useState } from 'react';

import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listObjectResponsibleCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
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
  const [responsibleCandidates, setResponsibleCandidates] = useState<SystemUserOption[]>([]);
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
        if (!cancelled) setResponsibleCandidates(candidates);
      } catch (caughtError) {
        if (!cancelled) {
          setCandidatesError(
            caughtError instanceof Error && caughtError.message
              ? caughtError.message
              : 'Не удалось загрузить ответственных.',
          );
        }
      } finally {
        if (!cancelled) setIsCandidatesLoading(false);
      }
    };

    void loadCandidates();
    return () => { cancelled = true; };
  }, [item.id]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
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

      if (canEditDailyRate) payload.dailyRate = Number(form.dailyRate) || 0;

      await onSubmit(payload);
      setSuccess('Изменения по объекту сохранены.');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Не удалось сохранить изменения объекта.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={styles.surface} onSubmit={handleSubmit}>
      <div>
        <h2 className={styles.title}>Данные объекта</h2>
        <p className={styles.description}>Основные реквизиты и параметры, которые относятся к карточке объекта.</p>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Название</span>
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Внутреннее имя</span>
          <input
            value={form.internalName}
            onChange={(event) => setForm((prev) => ({ ...prev, internalName: event.target.value }))}
            required
          />
        </label>

        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Адрес</span>
          <input
            value={form.address}
            onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            required
          />
        </label>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          {isCandidatesLoading ? (
            <div className={styles.notice}>Загрузка ответственных...</div>
          ) : candidatesError ? (
            <div className={styles.error}>{candidatesError}</div>
          ) : (
            <UserSearchSelect
              label="Ответственный"
              options={responsibleCandidates}
              value={form.responsibleUserId}
              onChange={(responsibleUserId) => setForm((prev) => ({ ...prev, responsibleUserId }))}
              disabled={isSubmitting}
              required
            />
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Сезон</span>
          <select
            value={form.seasonMode}
            onChange={(event) => setForm((prev) => ({ ...prev, seasonMode: event.target.value }))}
          >
            <option value="">Без сезонности</option>
            <option value="summer">Летний</option>
            <option value="winter">Зимний</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Ставка за день</span>
          <input
            type="number"
            min="0"
            step="1"
            value={form.dailyRate}
            onChange={(event) => setForm((prev) => ({ ...prev, dailyRate: event.target.value }))}
            disabled={!canEditDailyRate}
          />
          {!canEditDailyRate ? (
            <span className={styles.inlineHelp}>Изменение ставки доступно только учредителю и директору.</span>
          ) : null}
        </label>

        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Комментарий</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </label>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <div className={styles.actions}>
        <button type="submit" disabled={isSubmitting || isCandidatesLoading || !form.responsibleUserId}>
          {isSubmitting ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}
