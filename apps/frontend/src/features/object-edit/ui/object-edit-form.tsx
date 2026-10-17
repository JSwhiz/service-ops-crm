'use client';

import React, { useEffect, useState } from 'react';

import { listCounterpartyReferences } from '@/entities/counterparty/api/counterparty-client';
import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listObjectResponsibleCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { ObjectCompensationProfiles } from '@/features/object-compensation/ui/object-compensation-profiles';
import type { ObjectCompensationProfilesValue } from '@/features/object-compensation/ui/object-compensation-profiles';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { UserSearchSelect } from '@/shared/ui/user-search-select/user-search-select';

interface ObjectEditFormProps {
  item: ServiceObject;
  canEditObject: boolean;
  canManageCompensationRates: boolean;
  canLinkCounterparty: boolean;
  onSubmit: (payload: UpdateObjectPayload) => Promise<void>;
}

export function ObjectEditForm({
  item,
  canEditObject,
  canManageCompensationRates,
  canLinkCounterparty,
  onSubmit,
}: ObjectEditFormProps): React.JSX.Element {
  const [form, setForm] = useState({
    name: item.name,
    internalName: item.internalName ?? '',
    address: item.address,
    responsibleUserId: item.responsible?.id ?? '',
    seasonMode: item.seasonMode ?? '',
    summerWindowCleaning: item.summerWindowCleaning,
    engineeringRequired: item.engineeringRequired,
    winterTractorMode: item.winterTractorMode,
    instructionStepsText: item.instructionSteps.join('\n'),
    paymentType: item.paymentType ?? 'monthly',
    monthlySalary: String(item.monthlySalary ?? 0),
    dailyRate: String(item.dailyRate ?? 0),
    paymentScheduleCode: item.paymentScheduleCode ?? '5/2',
    paymentScheduleWeekdays: item.paymentScheduleWeekdays ?? [],
    summerPaymentType: item.summerPaymentType ?? item.paymentType ?? 'monthly',
    summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary ?? 0),
    summerDailyRate: String(item.summerDailyRate ?? item.dailyRate ?? 0),
    summerScheduleCode: item.summerScheduleCode ?? '5/2',
    summerScheduleWeekdays: item.summerScheduleWeekdays ?? [],
    winterPaymentType: item.winterPaymentType ?? item.paymentType ?? 'monthly',
    winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary ?? 0),
    winterDailyRate: String(item.winterDailyRate ?? item.dailyRate ?? 0),
    winterScheduleCode: item.winterScheduleCode ?? '5/2',
    winterScheduleWeekdays: item.winterScheduleWeekdays ?? [],
    notes: item.notes ?? '',
    counterpartyId: item.counterparty?.id ?? '',
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
      summerWindowCleaning: item.summerWindowCleaning,
      engineeringRequired: item.engineeringRequired,
      winterTractorMode: item.winterTractorMode,
      instructionStepsText: item.instructionSteps.join('\n'),
      paymentType: item.paymentType ?? 'monthly',
      monthlySalary: String(item.monthlySalary ?? 0),
      dailyRate: String(item.dailyRate ?? 0),
      paymentScheduleCode: item.paymentScheduleCode ?? '5/2',
      paymentScheduleWeekdays: item.paymentScheduleWeekdays ?? [],
      summerPaymentType: item.summerPaymentType ?? item.paymentType ?? 'monthly',
      summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary ?? 0),
      summerDailyRate: String(item.summerDailyRate ?? item.dailyRate ?? 0),
      summerScheduleCode: item.summerScheduleCode ?? '5/2',
      summerScheduleWeekdays: item.summerScheduleWeekdays ?? [],
      winterPaymentType: item.winterPaymentType ?? item.paymentType ?? 'monthly',
      winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary ?? 0),
      winterDailyRate: String(item.winterDailyRate ?? item.dailyRate ?? 0),
      winterScheduleCode: item.winterScheduleCode ?? '5/2',
      winterScheduleWeekdays: item.winterScheduleWeekdays ?? [],
      notes: item.notes ?? '',
      counterpartyId: item.counterparty?.id ?? '',
    });
  }, [item]);

  useEffect(() => {
    let cancelled = false;

    if (!canEditObject) {
      setResponsibleCandidates([]);
      setCandidatesError(null);
      setIsCandidatesLoading(false);
      return () => { cancelled = true; };
    }

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
  }, [item.id, canEditObject]);

  const compensationProfiles: ObjectCompensationProfilesValue = {
    paymentType: form.paymentType,
    dailyRate: form.dailyRate,
    monthlySalary: form.monthlySalary,
    paymentScheduleCode: form.paymentScheduleCode,
    paymentScheduleWeekdays: form.paymentScheduleWeekdays,
    summerPaymentType: form.summerPaymentType as 'monthly' | 'daily',
    summerDailyRate: form.summerDailyRate,
    summerMonthlySalary: form.summerMonthlySalary,
    summerScheduleCode: form.summerScheduleCode,
    summerScheduleWeekdays: form.summerScheduleWeekdays,
    winterPaymentType: form.winterPaymentType as 'monthly' | 'daily',
    winterDailyRate: form.winterDailyRate,
    winterMonthlySalary: form.winterMonthlySalary,
    winterScheduleCode: form.winterScheduleCode,
    winterScheduleWeekdays: form.winterScheduleWeekdays,
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (canEditObject && !form.responsibleUserId) {
      setError('Выберите ответственного за объект.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: UpdateObjectPayload = canEditObject ? {
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        seasonMode: form.seasonMode || null,
        summerWindowCleaning: form.summerWindowCleaning,
        engineeringRequired: form.engineeringRequired,
        winterTractorMode: form.winterTractorMode,
        instructionSteps: form.instructionStepsText.split('\n').map((step) => step.trim()).filter(Boolean),
        notes: form.notes.trim() || undefined,
        responsibleUserId: form.responsibleUserId,
        ...(canLinkCounterparty
          ? { counterpartyId: form.counterpartyId || null }
          : {}),
      } : {};

      if (canManageCompensationRates) {
        payload.paymentType = form.paymentType as 'monthly' | 'daily';
        payload.monthlySalary = Number(form.monthlySalary) || 0;
        payload.dailyRate = Number(form.dailyRate) || 0;
        payload.paymentScheduleCode = form.paymentScheduleCode || null;
        payload.paymentScheduleWeekdays = form.paymentScheduleWeekdays;
        payload.summerPaymentType = form.summerPaymentType;
        payload.summerMonthlySalary = Number(form.summerMonthlySalary) || 0;
        payload.summerDailyRate = Number(form.summerDailyRate) || 0;
        payload.summerScheduleCode = form.summerScheduleCode || null;
        payload.summerScheduleWeekdays = form.summerScheduleWeekdays;
        payload.winterPaymentType = form.winterPaymentType;
        payload.winterMonthlySalary = Number(form.winterMonthlySalary) || 0;
        payload.winterDailyRate = Number(form.winterDailyRate) || 0;
        payload.winterScheduleCode = form.winterScheduleCode || null;
        payload.winterScheduleWeekdays = form.winterScheduleWeekdays;
      }

      await onSubmit(payload);
      setSuccess(canEditObject ? 'Изменения по объекту сохранены.' : 'Условия оплаты сохранены.');
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
      </div>

      <section className={styles.formGrid} aria-label="Сезонные параметры">
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Летний профиль</span>
          <label><input type="checkbox" checked={form.summerWindowCleaning} onChange={(event) => setForm((prev) => ({ ...prev, summerWindowCleaning: event.target.checked }))} disabled={!canEditObject || isSubmitting} /> Мыть окна</label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Зимний профиль: трактор</span>
          <select value={form.winterTractorMode} onChange={(event) => setForm((prev) => ({ ...prev, winterTractorMode: event.target.value as typeof prev.winterTractorMode }))} disabled={!canEditObject || isSubmitting}>
            <option value="none">Не нужен</option>
            <option value="with_removal">С вывозом</option>
            <option value="without_removal">Без вывоза</option>
          </select>
        </label>
      </section>

      <section className={styles.formGrid} aria-label="Дополнительные работы">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Дополнительные работы</span>
          <span><input type="checkbox" checked={form.engineeringRequired} onChange={(event) => setForm((prev) => ({ ...prev, engineeringRequired: event.target.checked }))} disabled={!canEditObject || isSubmitting} /> Инженерка</span>
        </label>
      </section>

      <section aria-label="Условия оплаты">
        <ObjectCompensationProfiles
          value={compensationProfiles}
          disabled={!canManageCompensationRates || isSubmitting}
          onChange={(nextValue) => setForm((previous) => ({ ...previous, ...nextValue }))}
        />
        {!canManageCompensationRates ? (
          <p className={styles.inlineHelp}>У вашей роли нет права изменять условия оплаты объекта.</p>
        ) : null}
      </section>

      <section className={styles.formGrid} aria-label="Инструкции для объекта">
        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Постоянные инструкции — один шаг на строку</span>
          <textarea value={form.instructionStepsText} onChange={(event) => setForm((prev) => ({ ...prev, instructionStepsText: event.target.value }))} disabled={!canEditObject || isSubmitting} rows={4} />
        </label>
      </section>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Название</span>
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required={canEditObject}
            disabled={!canEditObject || isSubmitting}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Внутреннее имя</span>
          <input
            value={form.internalName}
            onChange={(event) => setForm((prev) => ({ ...prev, internalName: event.target.value }))}
            required={canEditObject}
            disabled={!canEditObject || isSubmitting}
          />
        </label>

        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Адрес</span>
          <input
            value={form.address}
            onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            required={canEditObject}
            disabled={!canEditObject || isSubmitting}
          />
        </label>

        {canEditObject && canLinkCounterparty ? (
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <SearchableSelect
              label="Контрагент"
              value={form.counterpartyId}
              selectedOption={
                item.counterparty
                  ? {
                      value: item.counterparty.id,
                      label: item.counterparty.name,
                      description: item.counterparty.legalName ?? undefined,
                    }
                  : null
              }
              options={[]}
              placeholder="Без привязки"
              searchPlaceholder="Название или юридическое название"
              emptyText="Контрагенты не найдены"
              viewportAware
              asyncSearch={async (query) =>
                (await listCounterpartyReferences({ q: query, limit: 20 })).map(
                  (counterparty): SearchableSelectOption => ({
                    value: counterparty.id,
                    label: counterparty.name,
                    description: counterparty.legalName ?? undefined,
                    searchText: [
                      counterparty.name,
                      counterparty.legalName,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  }),
                )
              }
              onChange={(counterpartyId) =>
                setForm((prev) => ({ ...prev, counterpartyId }))
              }
              disabled={!canEditObject || isSubmitting}
            />
          </div>
        ) : null}

        {canEditObject ? <div className={`${styles.field} ${styles.fullWidth}`}>
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
        </div> : null}

        <div className={styles.field}>
          <SearchableSelect
            label="Сезон"
            value={form.seasonMode}
            options={[
              { value: '', label: 'Без сезонности' },
              { value: 'summer', label: 'Летний' },
              { value: 'winter', label: 'Зимний' },
            ]}
            searchable={false}
            clearable={false}
            viewportAware
            disabled={!canEditObject || isSubmitting}
            onChange={(seasonMode) => setForm((prev) => ({ ...prev, seasonMode }))}
          />
        </div>

        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Комментарий</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            disabled={!canEditObject || isSubmitting}
          />
        </label>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <div className={styles.actions}>
        <button type="submit" disabled={isSubmitting || (canEditObject && (isCandidatesLoading || !form.responsibleUserId)) || (!canEditObject && !canManageCompensationRates)}>
          {isSubmitting ? 'Сохраняем...' : canEditObject ? 'Сохранить изменения' : 'Сохранить тарифы'}
        </button>
      </div>
    </form>
  );
}
