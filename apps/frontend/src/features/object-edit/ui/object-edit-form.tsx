'use client';

import React, { useEffect, useState } from 'react';

import { listCounterpartyReferences } from '@/entities/counterparty/api/counterparty-client';
import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listObjectResponsibleCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { UserSearchSelect } from '@/shared/ui/user-search-select/user-search-select';

interface ObjectEditFormProps {
  item: ServiceObject;
  canEditMonthlySalary: boolean;
  canLinkCounterparty: boolean;
  onSubmit: (payload: UpdateObjectPayload) => Promise<void>;
}

export function ObjectEditForm({
  item,
  canEditMonthlySalary,
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
    monthlySalary: String(item.monthlySalary),
    dailyRate: String(item.dailyRate),
    summerPaymentType: item.summerPaymentType ?? item.paymentType,
    summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary),
    summerDailyRate: String(item.summerDailyRate ?? item.dailyRate),
    winterPaymentType: item.winterPaymentType ?? item.paymentType,
    winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary),
    winterDailyRate: String(item.winterDailyRate ?? item.dailyRate),
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
      monthlySalary: String(item.monthlySalary),
      dailyRate: String(item.dailyRate),
      summerPaymentType: item.summerPaymentType ?? item.paymentType,
      summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary),
      summerDailyRate: String(item.summerDailyRate ?? item.dailyRate),
      winterPaymentType: item.winterPaymentType ?? item.paymentType,
      winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary),
      winterDailyRate: String(item.winterDailyRate ?? item.dailyRate),
      notes: item.notes ?? '',
      counterpartyId: item.counterparty?.id ?? '',
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
        summerWindowCleaning: form.summerWindowCleaning,
        engineeringRequired: form.engineeringRequired,
        winterTractorMode: form.winterTractorMode,
        instructionSteps: form.instructionStepsText.split('\n').map((step) => step.trim()).filter(Boolean),
        notes: form.notes.trim() || undefined,
        responsibleUserId: form.responsibleUserId,
        ...(canLinkCounterparty
          ? { counterpartyId: form.counterpartyId || null }
          : {}),
      };

      if (canEditMonthlySalary) {
        payload.paymentType = form.paymentType as 'monthly' | 'daily';
        payload.monthlySalary = Number(form.monthlySalary) || 0;
        payload.dailyRate = Number(form.dailyRate) || 0;
        payload.summerPaymentType = form.summerPaymentType;
        payload.summerMonthlySalary = Number(form.summerMonthlySalary) || 0;
        payload.summerDailyRate = Number(form.summerDailyRate) || 0;
        payload.winterPaymentType = form.winterPaymentType;
        payload.winterMonthlySalary = Number(form.winterMonthlySalary) || 0;
        payload.winterDailyRate = Number(form.winterDailyRate) || 0;
      }

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
      </div>

      <section className={styles.formGrid} aria-label="Сезонные профили">
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Летний профиль</span>
          <label><input type="checkbox" checked={form.summerWindowCleaning} onChange={(event) => setForm((prev) => ({ ...prev, summerWindowCleaning: event.target.checked }))} disabled={isSubmitting} /> Мыть окна</label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Зимний профиль: трактор</span>
          <select value={form.winterTractorMode} onChange={(event) => setForm((prev) => ({ ...prev, winterTractorMode: event.target.value as typeof prev.winterTractorMode }))} disabled={isSubmitting}>
            <option value="none">Не нужен</option>
            <option value="with_removal">С вывозом</option>
            <option value="without_removal">Без вывоза</option>
          </select>
        </label>
      </section>

      <section className={styles.formGrid} aria-label="Дополнительные работы">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Дополнительные работы</span>
          <span><input type="checkbox" checked={form.engineeringRequired} onChange={(event) => setForm((prev) => ({ ...prev, engineeringRequired: event.target.checked }))} disabled={isSubmitting} /> Инженерка</span>
        </label>
      </section>

      <section className={styles.formGrid} aria-label="Инструкции для объекта">
        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Постоянные инструкции — один шаг на строку</span>
          <textarea value={form.instructionStepsText} onChange={(event) => setForm((prev) => ({ ...prev, instructionStepsText: event.target.value }))} disabled={isSubmitting} rows={4} />
        </label>
      </section>

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

        {canLinkCounterparty ? (
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
              disabled={isSubmitting}
            />
          </div>
        ) : null}

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
            disabled={isSubmitting}
            onChange={(seasonMode) => setForm((prev) => ({ ...prev, seasonMode }))}
          />
        </div>

        <fieldset className={`${styles.field} ${styles.fullWidth}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, border: '1px solid var(--ui-border)', borderRadius: 10, padding: 16 }}>
          <legend className={styles.fieldLabel}>Оплата по сезонам</legend>
          {(['summer', 'winter'] as const).map((season) => {
            const seasonLabel = season === 'summer' ? 'Летняя ставка' : 'Зимняя ставка';
            const typeKey = season === 'summer' ? 'summerPaymentType' : 'winterPaymentType';
            const type = season === 'summer' ? form.summerPaymentType : form.winterPaymentType;
            const amountKey = season === 'summer' ? type === 'monthly' ? 'summerMonthlySalary' : 'summerDailyRate' : type === 'monthly' ? 'winterMonthlySalary' : 'winterDailyRate';
            return <div className={styles.field} key={season}>
              <span className={styles.fieldLabel}>{seasonLabel}</span>
              <SearchableSelect label={`Тип расчёта — ${seasonLabel.toLocaleLowerCase('ru-RU')}`} value={type} options={[{ value: 'monthly', label: 'Фиксированная сумма за месяц' }, { value: 'daily', label: 'Ставка за выход' }]} searchable={false} clearable={false} viewportAware disabled={!canEditMonthlySalary || isSubmitting} onChange={(value) => setForm((previous) => ({ ...previous, [typeKey]: value as 'monthly' | 'daily' }))} />
              <label className={styles.field}><span className={styles.fieldLabel}>{type === 'monthly' ? 'Сумма за месяц, ₽' : 'За один выход, ₽'}</span><input type="number" min="0" step="1" value={form[amountKey]} onChange={(event) => setForm((previous) => ({ ...previous, [amountKey]: event.target.value }))} disabled={!canEditMonthlySalary || isSubmitting} /></label>
            </div>;
          })}
          {!canEditMonthlySalary ? <span className={styles.inlineHelp}>Изменение условий оплаты доступно только учредителю и директору.</span> : null}
        </fieldset>

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
