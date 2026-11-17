'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';

import { getCounterparty, listCounterpartyReferences } from '@/entities/counterparty/api/counterparty-client';
import type { UpdateObjectPayload } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listObjectResponsibleCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { ObjectCompensationProfiles } from '@/features/object-compensation/ui/object-compensation-profiles';
import {
  getInvalidObjectScheduleProfiles,
  type ObjectCompensationProfilesValue,
} from '@/features/object-compensation/ui/object-compensation-profiles';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { UserSearchSelect } from '@/shared/ui/user-search-select/user-search-select';
import { Select } from '@/shared/ui/searchable-select/select';
import { Button } from '@/shared/ui/foundation';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { getAccessGeneration } from '@/shared/auth/access-generation';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import { ApiError } from '@/shared/api/fetcher';
import { getObjectCompensation } from '@/entities/object/api/object-compensation-client';
import { WindowCleaningFields } from '@/entities/object/ui/window-cleaning-fields';
import { windowCleaningDraft, windowCleaningPayload, windowCleaningValidation } from '@/entities/object/lib/window-cleaning';

interface ObjectEditFormProps {
  mode?: 'full' | 'compensation';
  preserveDraftOnRefresh?: boolean;
  onCancel?: () => void;
  item: ServiceObject;
  canEditObject: boolean;
  canManageCompensationRates: boolean;
  canLinkCounterparty: boolean;
  onSubmit: (payload: UpdateObjectPayload) => Promise<void | SavedWithoutAccess>;
}

export function ObjectEditForm({
  mode = 'full',
  preserveDraftOnRefresh = false,
  onCancel,
  item,
  canEditObject,
  canManageCompensationRates,
  canLinkCounterparty,
  onSubmit,
}: ObjectEditFormProps): React.JSX.Element {
  const surfaceMounted = useRef(true);
  const currentObjectId = useRef(item.id);
  currentObjectId.current = item.id;
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const accessBlocked = useContext(AccessSnapshotBlockedContext);
  const draftObjectId = useRef(item.id);
  const baseProfile = item.baseCompensationProfile ?? item;
  const [form, setForm] = useState({
    name: item.name,
    internalName: item.internalName ?? '',
    address: item.address,
    responsibleUserId: item.responsible?.id ?? '',
    summerWindowCleaning: item.summerWindowCleaning,
    ...windowCleaningDraft(item),
    engineeringRequired: item.engineeringRequired,
    winterTractorMode: item.winterTractorMode,
    instructionStepsText: item.instructionSteps.join('\n'),
    paymentType: baseProfile.paymentType ?? 'monthly',
    monthlySalary: String(baseProfile.monthlySalary ?? 0),
    dailyRate: String(baseProfile.dailyRate ?? 0),
    paymentScheduleCode: baseProfile.paymentScheduleCode ?? '5/2',
    paymentScheduleWeekdays: baseProfile.paymentScheduleWeekdays ?? [],
    paymentScheduleCycleStartDate: baseProfile.paymentScheduleCycleStartDate?.slice(0, 10) ?? '',
    summerPaymentType: item.summerPaymentType ?? item.paymentType ?? 'monthly',
    summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary ?? 0),
    summerDailyRate: String(item.summerDailyRate ?? item.dailyRate ?? 0),
    summerScheduleCode: item.summerScheduleCode ?? '5/2',
    summerScheduleWeekdays: item.summerScheduleWeekdays ?? [],
    summerScheduleCycleStartDate: item.summerScheduleCycleStartDate?.slice(0, 10) ?? '',
    winterPaymentType: item.winterPaymentType ?? item.paymentType ?? 'monthly',
    winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary ?? 0),
    winterDailyRate: String(item.winterDailyRate ?? item.dailyRate ?? 0),
    winterScheduleCode: item.winterScheduleCode ?? '5/2',
    winterScheduleWeekdays: item.winterScheduleWeekdays ?? [],
    winterScheduleCycleStartDate: item.winterScheduleCycleStartDate?.slice(0, 10) ?? '',
    notes: item.notes ?? '',
  });
  const accessRevision = useAccessRevision();
  const generation = getAccessGeneration();
  const [counterpartyIntent, setCounterpartyIntent] = useState<
    { kind: 'untouched' } | { kind: 'unlink'; generation: number } | { kind: 'select'; generation: number; option: SearchableSelectOption }
  >({ kind: 'untouched' });
  const counterpartyOptions = useRef<{ generation: number; options: Map<string, SearchableSelectOption> }>({ generation, options: new Map() });
  if (counterpartyOptions.current.generation !== generation) counterpartyOptions.current = { generation, options: new Map() };
  const currentCounterpartyIntent = counterpartyIntent.kind !== 'untouched' && counterpartyIntent.generation === generation;
  const visibleCounterparty = item.counterpartyAccessRestricted ? null : item.counterparty;
  const currentCounterpartyId = useRef(visibleCounterparty?.id);
  currentCounterpartyId.current = visibleCounterparty?.id;
  const [counterpartyAuthority, setCounterpartyAuthority] = useState<{ objectId: string; counterpartyId: string; generation: number; allowed: boolean } | null>(null);
  const currentCounterpartyAuthority = counterpartyAuthority?.objectId === item.id && counterpartyAuthority.counterpartyId === visibleCounterparty?.id && counterpartyAuthority.generation === generation;
  const canChangeCounterparty = !item.counterpartyAccessRestricted && (visibleCounterparty
    ? currentCounterpartyAuthority && counterpartyAuthority.allowed
    : canLinkCounterparty);
  useEffect(() => {
    const id = visibleCounterparty?.id, targetId = item.id;
    if (!id || item.counterpartyAccessRestricted) return;
    let active = true;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId && currentCounterpartyId.current === id);
    void getCounterparty(id).then(source => {
      if (active && fence.current() && source.id === id) setCounterpartyAuthority({ objectId: targetId, counterpartyId: id, generation, allowed: source.capabilities.canLinkObjects });
    }).catch(() => { if (active && fence.current()) setCounterpartyAuthority({ objectId: targetId, counterpartyId: id, generation, allowed: false }); });
    return () => { active = false; };
  }, [item.id, visibleCounterparty?.id, item.counterpartyAccessRestricted, accessRevision, generation]);
  const selectedCounterpartyId = counterpartyIntent.kind === 'select' && currentCounterpartyIntent ? counterpartyIntent.option.value : null;
  const latestSelectedCounterpartyId = useRef(selectedCounterpartyId); latestSelectedCounterpartyId.current = selectedCounterpartyId;
  const [selectedCounterpartyAuthority, setSelectedCounterpartyAuthority] = useState<{ id: string; generation: number; allowed: boolean } | null>(null);
  const selectedCounterpartyChecked = selectedCounterpartyAuthority?.id === selectedCounterpartyId && selectedCounterpartyAuthority?.generation === generation;
  const selectedCounterpartyAllowed = selectedCounterpartyAuthority?.id === selectedCounterpartyId && selectedCounterpartyAuthority?.generation === generation && selectedCounterpartyAuthority.allowed;
  useEffect(() => {
    const targetId = item.id, id = selectedCounterpartyId;
    if (!id || !canChangeCounterparty) return;
    let active = true;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId && latestSelectedCounterpartyId.current === id);
    void getCounterparty(id).then(source => {
      if (active && fence.current() && source.id === id) setSelectedCounterpartyAuthority({ id, generation, allowed: source.capabilities.canLinkObjects });
    }).catch(() => { if (active && fence.current()) setSelectedCounterpartyAuthority({ id, generation, allowed: false }); });
    return () => { active = false; };
  }, [item.id, selectedCounterpartyId, canChangeCounterparty, generation]);
  const counterpartyIntentBlocked = counterpartyIntent.kind !== 'untouched' && (!canChangeCounterparty || !currentCounterpartyIntent || (counterpartyIntent.kind === 'select' && !selectedCounterpartyAllowed));
  const counterpartyValue = counterpartyIntent.kind === 'untouched' ? visibleCounterparty?.id ?? ''
    : currentCounterpartyIntent && counterpartyIntent.kind === 'select' ? counterpartyIntent.option.value : '';
  const counterpartyOption = counterpartyIntent.kind === 'select' && currentCounterpartyIntent ? counterpartyIntent.option
    : counterpartyIntent.kind === 'untouched' && visibleCounterparty ? { value: visibleCounterparty.id, label: visibleCounterparty.name, description: visibleCounterparty.legalName ?? undefined } : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [responsibleCandidates, setResponsibleCandidates] = useState<SystemUserOption[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [isCandidatesLoading, setIsCandidatesLoading] = useState(true);
  const [legacyCompensation, setLegacyCompensation] = useState<{ objectId: string; allowed: boolean } | null>(null);
  const [compensationReadError, setCompensationReadError] = useState(false);
  const canChangeResponsible = canEditObject && item.capabilities.canManageResponsibles;
  const canEditLegacyCompensation = canManageCompensationRates && legacyCompensation?.objectId === item.id && legacyCompensation.allowed;
  useEffect(() => {
    let active = true;
    setLegacyCompensation(null); setCompensationReadError(false);
    if (canManageCompensationRates) void getObjectCompensation(item.id).then((response) => {
      if (active) setLegacyCompensation({ objectId: item.id, allowed: response.capabilities.manageRates && !response.versions.some((v) => v.scope === 'defaults' && v.scopeId === item.id && !v.cancelledAt) });
    }).catch(() => { if (active) setCompensationReadError(true); });
    return () => { active = false; };
  }, [item.id, canManageCompensationRates]);

  useEffect(() => {
    if (preserveDraftOnRefresh && draftObjectId.current === item.id) return;
    draftObjectId.current = item.id;
    setCounterpartyIntent({ kind: 'untouched' });
    setForm({
      name: item.name,
      internalName: item.internalName ?? '',
      address: item.address,
      responsibleUserId: item.responsible?.id ?? '',
      summerWindowCleaning: item.summerWindowCleaning,
      ...windowCleaningDraft(item),
      engineeringRequired: item.engineeringRequired,
      winterTractorMode: item.winterTractorMode,
      instructionStepsText: item.instructionSteps.join('\n'),
      paymentType: baseProfile.paymentType ?? 'monthly',
      monthlySalary: String(baseProfile.monthlySalary ?? 0),
      dailyRate: String(baseProfile.dailyRate ?? 0),
      paymentScheduleCode: baseProfile.paymentScheduleCode ?? '5/2',
      paymentScheduleWeekdays: baseProfile.paymentScheduleWeekdays ?? [],
      paymentScheduleCycleStartDate: baseProfile.paymentScheduleCycleStartDate?.slice(0, 10) ?? '',
      summerPaymentType: item.summerPaymentType ?? item.paymentType ?? 'monthly',
      summerMonthlySalary: String(item.summerMonthlySalary ?? item.monthlySalary ?? 0),
      summerDailyRate: String(item.summerDailyRate ?? item.dailyRate ?? 0),
      summerScheduleCode: item.summerScheduleCode ?? '5/2',
      summerScheduleWeekdays: item.summerScheduleWeekdays ?? [],
      summerScheduleCycleStartDate: item.summerScheduleCycleStartDate?.slice(0, 10) ?? '',
      winterPaymentType: item.winterPaymentType ?? item.paymentType ?? 'monthly',
      winterMonthlySalary: String(item.winterMonthlySalary ?? item.monthlySalary ?? 0),
      winterDailyRate: String(item.winterDailyRate ?? item.dailyRate ?? 0),
      winterScheduleCode: item.winterScheduleCode ?? '5/2',
      winterScheduleWeekdays: item.winterScheduleWeekdays ?? [],
      winterScheduleCycleStartDate: item.winterScheduleCycleStartDate?.slice(0, 10) ?? '',
      notes: item.notes ?? '',
      });
  }, [item, baseProfile, preserveDraftOnRefresh]);

  useEffect(() => {
    let cancelled = false;

    if (!canChangeResponsible || mode === 'compensation') {
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
      } catch {
        if (!cancelled) {
          setCandidatesError(
            'Не удалось загрузить список ответственных. Изменение ответственного требует отдельного права.',
          );
        }
      } finally {
        if (!cancelled) setIsCandidatesLoading(false);
      }
    };

    void loadCandidates();
    return () => { cancelled = true; };
  }, [item.id, canChangeResponsible, mode]);

  const compensationProfiles: ObjectCompensationProfilesValue = {
    paymentType: form.paymentType,
    dailyRate: form.dailyRate,
    monthlySalary: form.monthlySalary,
    paymentScheduleCode: form.paymentScheduleCode,
    paymentScheduleWeekdays: form.paymentScheduleWeekdays,
    paymentScheduleCycleStartDate: form.paymentScheduleCycleStartDate,
    summerPaymentType: form.summerPaymentType as 'monthly' | 'daily',
    summerDailyRate: form.summerDailyRate,
    summerMonthlySalary: form.summerMonthlySalary,
    summerScheduleCode: form.summerScheduleCode,
    summerScheduleWeekdays: form.summerScheduleWeekdays,
    summerScheduleCycleStartDate: form.summerScheduleCycleStartDate,
    winterPaymentType: form.winterPaymentType as 'monthly' | 'daily',
    winterDailyRate: form.winterDailyRate,
    winterMonthlySalary: form.winterMonthlySalary,
    winterScheduleCode: form.winterScheduleCode,
    winterScheduleWeekdays: form.winterScheduleWeekdays,
    winterScheduleCycleStartDate: form.winterScheduleCycleStartDate,
  };
  const invalidScheduleProfiles = getInvalidObjectScheduleProfiles(compensationProfiles);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    if (accessBlocked || draftObjectId.current !== item.id || (!canEditObject && !canEditLegacyCompensation)) {
      setError('Право редактирования недоступно. Черновик сохранён.');
      return;
    }
    setError(null);
    setSuccess(null);

    const windowError = mode === 'full' && canEditObject ? windowCleaningValidation(form) : null;
    if (windowError) { setError(windowError); return; }

    if (mode === 'full' && canEditObject && !form.responsibleUserId) {
      setError('Выберите ответственного за объект.');
      return;
    }

    if (canEditLegacyCompensation && invalidScheduleProfiles.length > 0) {
      setError(`Проверьте график в профилях: ${invalidScheduleProfiles.join(', ')}.`);
      return;
    }

    const instructionSteps = form.instructionStepsText.split('\n').map((step) => step.trim()).filter(Boolean);
    const instructionsChanged = JSON.stringify(instructionSteps) !== JSON.stringify(item.instructionSteps);
    if (instructionsChanged && !item.capabilities.canManageMaterials) {
      setError('Право изменения инструкций недоступно. Черновик сохранён; изменение карточки не отправлено.');
      return;
    }
    const submittedObjectId = item.id;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === submittedObjectId);
    if (counterpartyIntent.kind !== 'untouched' && (!canEditObject || !canChangeCounterparty || !currentCounterpartyIntent)) {
      setError(item.counterpartyAccessRestricted ? 'Изменение связи недоступно: нет доступа к связанному контрагенту. Черновик сохранён; оставьте прежнюю связь, чтобы изменить остальные поля.' : 'Выбор контрагента требует повторной проверки текущего доступа. Черновик сохранён.'); return;
    }
    setIsSubmitting(true);
    try {
      if (counterpartyIntent.kind === 'select') {
        const references = await listCounterpartyReferences({ selectedId: counterpartyIntent.option.value, limit: 20 });
        if (!fence.current()) return;
        const selectedSource = await getCounterparty(counterpartyIntent.option.value);
        if (!fence.current()) return;
        if (!selectedSource.capabilities.canLinkObjects || !references.some((reference) => reference.id === counterpartyIntent.option.value)) {
          setError('Выбранный контрагент недоступен. Проверьте выбор; связь не изменена.'); return;
        }
      }
      const payload: UpdateObjectPayload = canEditObject && mode === 'full' ? {
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        summerWindowCleaning: form.summerWindowCleaning,
        ...windowCleaningPayload(form),
        engineeringRequired: form.engineeringRequired,
        winterTractorMode: form.winterTractorMode,
        ...(instructionsChanged ? { instructionSteps } : {}),
        notes: form.notes.trim() || undefined,
        responsibleUserId: form.responsibleUserId,
        ...(counterpartyIntent.kind === 'select' ? { counterpartyId: counterpartyIntent.option.value }
          : counterpartyIntent.kind === 'unlink' ? { counterpartyId: null } : {}),
      } : {};

      if (canEditLegacyCompensation) {
        payload.paymentType = form.paymentType as 'monthly' | 'daily';
        payload.monthlySalary = Number(form.monthlySalary) || 0;
        payload.dailyRate = Number(form.dailyRate) || 0;
        payload.paymentScheduleCode = form.paymentScheduleWeekdays.length ? null : form.paymentScheduleCode || '5/2';
        payload.paymentScheduleWeekdays = form.paymentScheduleWeekdays;
        payload.paymentScheduleCycleStartDate = form.paymentScheduleWeekdays.length || form.paymentScheduleCode === '5/2' ? null : form.paymentScheduleCycleStartDate;
        payload.summerPaymentType = form.summerPaymentType;
        payload.summerMonthlySalary = Number(form.summerMonthlySalary) || 0;
        payload.summerDailyRate = Number(form.summerDailyRate) || 0;
        payload.summerScheduleCode = form.summerScheduleWeekdays.length ? null : form.summerScheduleCode || '5/2';
        payload.summerScheduleWeekdays = form.summerScheduleWeekdays;
        payload.summerScheduleCycleStartDate = form.summerScheduleWeekdays.length || form.summerScheduleCode === '5/2' ? null : form.summerScheduleCycleStartDate;
        payload.winterPaymentType = form.winterPaymentType;
        payload.winterMonthlySalary = Number(form.winterMonthlySalary) || 0;
        payload.winterDailyRate = Number(form.winterDailyRate) || 0;
        payload.winterScheduleCode = form.winterScheduleWeekdays.length ? null : form.winterScheduleCode || '5/2';
        payload.winterScheduleWeekdays = form.winterScheduleWeekdays;
        payload.winterScheduleCycleStartDate = form.winterScheduleWeekdays.length || form.winterScheduleCode === '5/2' ? null : form.winterScheduleCycleStartDate;
      }

      const result = await onSubmit(payload);
      if ((result && isSavedWithoutAccess(result)) || !fence.current()) return;
      setCounterpartyIntent({ kind: 'untouched' });
      setSuccess(canEditObject ? 'Изменения по объекту сохранены.' : 'Условия оплаты сохранены.');
    } catch (caughtError) {
      if (!fence.current()) return;
      setError(
        caughtError instanceof ApiError && [403, 404].includes(caughtError.statusCode)
          ? 'Доступ к изменению объекта не подтверждён. Черновик сохранён.'
          : caughtError instanceof Error && caughtError.message
            ? caughtError.message
            : 'Не удалось сохранить изменения объекта.',
      );
    } finally {
      if (fence.sameTarget()) setIsSubmitting(false);
    }
  };

  return (
    <form className={`${styles.surface} ${styles.editForm}`} onSubmit={handleSubmit}>
      <div>
        <h2 className={styles.title}>{mode === 'compensation' ? 'Ставки и графики объекта' : 'Данные объекта'}</h2>
      </div>

      {mode === 'full' ? <>
      <section className={styles.formGrid} aria-label="Сезонные параметры">
        <WindowCleaningFields value={form} onChange={next => setForm(previous => ({ ...previous, ...next }))} disabled={!canEditObject || isSubmitting} legacySummer={form.summerWindowCleaning} />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Зимний профиль: трактор</span>
          <Select value={form.winterTractorMode} onChange={(event) => setForm((prev) => ({ ...prev, winterTractorMode: event.target.value as typeof prev.winterTractorMode }))} disabled={!canEditObject || isSubmitting}>
            <option value="none">Не нужен</option>
            <option value="with_removal">С вывозом</option>
            <option value="without_removal">Без вывоза</option>
          </Select>
        </label>
      </section>

      <section className={styles.formGrid} aria-label="Дополнительные работы">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Дополнительные работы</span>
          <span><input type="checkbox" checked={form.engineeringRequired} onChange={(event) => setForm((prev) => ({ ...prev, engineeringRequired: event.target.checked }))} disabled={!canEditObject || isSubmitting} /> Инженерка</span>
        </label>
      </section>
      </> : null}

      <section aria-label="Условия оплаты">
        {canManageCompensationRates && !canEditLegacyCompensation ? <p className={styles.inlineHelp}>{compensationReadError ? 'Не удалось проверить действующие условия оплаты.' : legacyCompensation?.objectId !== item.id ? 'Проверяем действующие условия оплаты…' : 'Условия оплаты меняются отдельно с выбранной даты.'} <a href={`/objects/${item.id}#planning`}>Открыть условия оплаты и фонд команды</a></p> : <>
        <ObjectCompensationProfiles
          value={compensationProfiles}
          disabled={!canEditLegacyCompensation || isSubmitting}
          onChange={(nextValue) => setForm((previous) => ({ ...previous, ...nextValue }))}
        />
        {!canManageCompensationRates ? (
          <p className={styles.inlineHelp}>Нет действующего права изменять условия оплаты объекта.</p>
        ) : null}
        </>}
      </section>

      {mode === 'full' ? <>
      <section className={styles.formGrid} aria-label="Инструкции для объекта">
        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Постоянные инструкции — один шаг на строку</span>
          <textarea value={form.instructionStepsText} onChange={(event) => setForm((prev) => ({ ...prev, instructionStepsText: event.target.value }))} disabled={!canEditObject || !item.capabilities.canManageMaterials || isSubmitting} rows={4} />
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

        {canEditObject && (canLinkCounterparty || canChangeCounterparty) ? (
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <SearchableSelect
              label="Контрагент"
              key={`${item.id}:${accessRevision}`}
              value={counterpartyValue}
              selectedOption={counterpartyOption}
              options={[]}
              placeholder={counterpartyIntent.kind !== 'untouched' && !currentCounterpartyIntent ? 'Проверьте выбор после изменения доступа'
                : counterpartyIntent.kind === 'unlink' ? 'Связь будет удалена при сохранении'
                  : item.counterpartyAccessRestricted ? 'Связанный контрагент недоступен' : 'Без привязки'}
              searchPlaceholder="Название или юридическое название"
              emptyText="Контрагенты не найдены"
              viewportAware
              asyncSearch={async (query) => {
                const targetId = item.id;
                const fence = captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId);
                const rows = await listCounterpartyReferences({ q: query, limit: 20 });
                if (!fence.current() || item.counterpartyAccessRestricted || getAccessGeneration() !== generation) return [];
                const options = rows.map((counterparty): SearchableSelectOption => ({ value: counterparty.id, label: counterparty.name, description: counterparty.legalName ?? undefined }));
                for (const option of options) counterpartyOptions.current.options.set(option.value, option);
                return options;
              }}
              onChange={(value) => {
                if (!canChangeCounterparty || getAccessGeneration() !== generation) return;
                if (!value) { setCounterpartyIntent({ kind: 'unlink', generation }); return; }
                const option = counterpartyOptions.current.options.get(value);
                if (option) setCounterpartyIntent({ kind: 'select', generation, option });
              }}
              disabled={!canEditObject || !canChangeCounterparty || isSubmitting}
            />
            {(item.counterpartyAccessRestricted || visibleCounterparty || counterpartyIntent.kind !== 'untouched') ? <div className={styles.actions}>
              <Button type="button" disabled={isSubmitting || !canEditObject || !canChangeCounterparty} onClick={() => setCounterpartyIntent({ kind: 'unlink', generation: getAccessGeneration() })}>Отвязать контрагента при сохранении</Button>
            </div> : null}
          </div>
        ) : null}
        {selectedCounterpartyId && !selectedCounterpartyAllowed ? <div className={styles.notice}>{selectedCounterpartyChecked ? 'Нет права привязки выбранного контрагента. Выберите доступного или оставьте прежнюю связь; остальные изменения сохранены в черновике.' : 'Проверяем право для выбранного контрагента. Остальные изменения сохранены в черновике.'}</div> : null}
        {counterpartyIntent.kind !== 'untouched' ? <Button type="button" disabled={isSubmitting} onClick={() => setCounterpartyIntent({ kind: 'untouched' })}>Оставить прежнюю связь</Button> : null}
        {!item.counterpartyAccessRestricted && visibleCounterparty && !canChangeCounterparty ? <div className={styles.notice}>Изменение связи недоступно без подтверждённого права для этого контрагента. Остальные поля можно сохранить без смены связи.</div> : null}
        {item.counterpartyAccessRestricted ? <div className={styles.notice}>Связанный контрагент недоступен. Изменение связи недоступно без доступа к нему. Остальные данные объекта можно сохранить, оставив прежнюю связь.</div> : null}

        {canChangeResponsible ? <div className={`${styles.field} ${styles.fullWidth}`}>
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

      </div>
      </> : null}

      {mode === 'full' ? <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.fullWidth}`}>
          <span className={styles.fieldLabel}>Комментарий</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            disabled={!canEditObject || isSubmitting}
          />
        </label>
      </div> : null}

      {!canEditObject && mode === 'full' ? <div className={styles.notice} role="status">Редактирование карточки недоступно. Черновик сохранён. Условия оплаты можно менять только при отдельном действующем праве.</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <div className={styles.actions}>
        <Button variant="primary" type="submit" pending={isSubmitting} pendingLabel="Сохранение…" disabled={accessBlocked || counterpartyIntentBlocked || (mode === 'full' && canEditObject && (isCandidatesLoading || !form.responsibleUserId)) || (canEditLegacyCompensation && invalidScheduleProfiles.length > 0) || (!canEditObject && !canEditLegacyCompensation)}>
          {mode === 'compensation' ? 'Сохранить тарифы' : 'Сохранить изменения'}
        </Button>
        {onCancel ? <Button disabled={isSubmitting} onClick={onCancel}>Отмена</Button> : null}
      </div>
    </form>
  );
}
