'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCounterpartyReferences } from '@/entities/counterparty/api/counterparty-client';
import { createObject } from '@/entities/object/api/object-client';
import { listEmployees } from '@/entities/employee/api/employee-client';
import { PositionsEditor } from '@/features/object-scheduling/ui/positions-editor';
import { previewNewObjectSchedule } from '@/entities/object/api/object-scheduling-client';
import { PayContourEditor } from '@/features/object-scheduling/ui/pay-contour-editor';
import { contourPayload, newContourDraft, type ContourDraft } from '@/features/object-scheduling/model/contour-draft';
import { positionPayload, type PositionDraft } from '@/features/object-scheduling/model/schedule-draft';
import { ObjectSetupEditor } from '@/features/object-setup/ui/object-setup-editor';
import { OBJECT_CREATE_SECTIONS } from '@/features/object-create/model/object-create-sections';
import { createPayloadForAccess, projectCreatePositions } from '@/features/object-create/model/object-create-access';
import { findSectionValidationIssue, revealSectionValidationIssue } from '@/features/object-create/model/section-validation';
import { isNativeValidationIssueResolved, type NativeValidationIssue } from '@/features/object-create/model/stale-native-validation';
import { setupDraft, setupPayload } from '@/features/object-setup/model/setup-draft';
import type { SetupCapabilities } from '@/entities/object/model/object-setup.types';
import { ContactEditor, contactPayload, newContactDraft, type ContactDraft } from '@/features/object-contacts/ui/contact-editor';
import { SeasonFields } from '@/features/object-planning/ui/season-fields';
import { seasonPlanningPayload } from '@/features/object-planning/model/season-planning';
import { FormDialog, useConfirm } from '@/shared/ui/overlays';
import { fetcher } from '@/shared/api/fetcher';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert } from '@/shared/ui/foundation';
import {
  listSystemUsers,
  type SystemUserOption,
} from '@/entities/user/api/user-client';
import { useAuth } from '@/shared/auth/use-auth';
import { ObjectCompensationProfiles } from '@/features/object-compensation/ui/object-compensation-profiles';
import {
  getInvalidObjectScheduleProfiles,
  type ObjectCompensationProfilesValue,
} from '@/features/object-compensation/ui/object-compensation-profiles';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { usePopoverPlacement } from '@/shared/ui/searchable-select/use-popover-placement';

import { SelectField } from '@/shared/ui/searchable-select/select-field';
import styles from './new-object.module.css';
import { Button } from '@/shared/ui/foundation';
import { CheckIcon, ChevronDownIcon } from '@/shared/ui/icons/icons';

interface ManagerMultiSelectProps {
  options: SystemUserOption[];
  value: string[];
  onChange: (userIds: string[]) => void;
  disabled?: boolean;
}

function ManagerMultiSelect({
  options,
  value,
  onChange,
  disabled = false,
}: ManagerMultiSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { placement, availableHeight } = usePopoverPlacement(open, triggerRef, popoverRef);
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');

  const visibleOptions = options
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return `${candidate.fullName} ${candidate.login}`
        .toLocaleLowerCase('ru')
        .includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftSelected = value.includes(left.id);
      const rightSelected = value.includes(right.id);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return getUserDisplayName(left).localeCompare(getUserDisplayName(right), 'ru');
    });

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => searchRef.current?.focus());

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedUsers = options.filter((candidate) => value.includes(candidate.id));
  const triggerLabel =
    selectedUsers.length === 0
      ? 'Выберите менеджеров'
      : selectedUsers.length === 1
        ? getUserDisplayName(selectedUsers[0])
        : `Выбрано: ${selectedUsers.length}`;

  const toggle = (userId: string): void => {
    onChange(
      value.includes(userId)
        ? value.filter((item) => item !== userId)
        : [...value, userId],
    );
  };

  return (
    <div className={styles.managerSelect} ref={rootRef}>
      <span className={styles.fieldLabel}>Менеджеры</span>

      <button
        ref={triggerRef}
        type="button"
        className={styles.selectTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selectedUsers.length === 0 ? styles.triggerPlaceholder : undefined}>
          {triggerLabel}
        </span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className={`${styles.selectPopover} ${styles.managerPopover}`}
          data-placement={placement}
          style={{ '--anchored-popover-max-height': `${availableHeight}px` } as React.CSSProperties}
        >
          <div className={styles.managerSearchWrap}>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ФИО или логин"
              aria-label="Поиск менеджера"
            />
          </div>

          <div className={styles.managerOptions} role="listbox" aria-label="Менеджеры" aria-multiselectable="true">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((candidate) => {
                const selected = value.includes(candidate.id);
                const secondary = getUserSecondaryLabel(candidate);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={styles.managerOption}
                    data-selected={selected ? 'true' : 'false'}
                    key={candidate.id}
                    onClick={() => toggle(candidate.id)}
                  >
                    <span className={styles.managerCheckbox} aria-hidden="true">
                      {selected ? <CheckIcon /> : null}
                    </span>
                    <span className={styles.managerCopy}>
                      <strong>{getUserDisplayName(candidate)}</strong>
                      {secondary ? <span>{secondary}</span> : null}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className={styles.emptyManagers}>По этому запросу никого не найдено.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Активный' },
  { value: 'frozen', label: 'Заморожен' },
  { value: 'archived', label: 'Архив' },
];

type ObjectCreateForm = ObjectCompensationProfilesValue & {
  name: string;
  internalName: string;
  address: string;
  status: string;
  summerWindowCleaning: boolean;
  engineeringRequired: boolean;
  winterTractorMode: 'none' | 'with_removal' | 'without_removal';
  notes: string;
  instructionStepsText: string;
};

interface ObjectCreateDraft {
  form?: ObjectCreateForm;
  setup?: ReturnType<typeof setupDraft>;
  positions?: PositionDraft[];
  payContours?: ContourDraft[];
  contacts?: ContactDraft[];
  automaticSeasons?: boolean;
  summerStartsOn?: string;
  winterStartsOn?: string;
  responsibleUserId?: string;
  managerUserIds?: string[];
  counterpartyId?: string;
}

export function ObjectCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const accessRevision = useAccessRevision();
  const [confirmOmissions, omissionDialog] = useConfirm();
  const draft = useCreateDraft<ObjectCreateDraft>('object-create', {});
  const [activeSection, setActiveSection] = useState('basic');
  const fallbackSearch = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext(`/objects${fallbackSearch ? `?${fallbackSearch}` : ''}`);

  const [form, setForm] = useState<ObjectCreateForm>(draft.value.form ?? {
    name: '',
    internalName: '',
    address: '',
    status: 'active',
    summerWindowCleaning: false,
    engineeringRequired: false,
    winterTractorMode: 'none' as 'none' | 'with_removal' | 'without_removal',
    paymentType: 'monthly' as 'monthly' | 'daily',
    monthlySalary: '0',
    dailyRate: '0',
    paymentScheduleCode: '5/2',
    paymentScheduleWeekdays: [] as string[],
    paymentScheduleCycleStartDate: '',
    summerPaymentType: 'monthly' as 'monthly' | 'daily',
    summerMonthlySalary: '0',
    summerDailyRate: '0',
    summerScheduleCode: '5/2',
    summerScheduleWeekdays: [] as string[],
    summerScheduleCycleStartDate: '',
    winterPaymentType: 'monthly' as 'monthly' | 'daily',
    winterMonthlySalary: '0',
    winterDailyRate: '0',
    winterScheduleCode: '5/2',
    winterScheduleWeekdays: [] as string[],
    winterScheduleCycleStartDate: '',
    notes: '',
    instructionStepsText: '',
  });

  const [responsibles, setResponsibles] = useState<{ revision: string; options: SystemUserOption[]; error: string | null } | null>(null);
  const [managers, setManagers] = useState<{ revision: string; options: SystemUserOption[]; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeValidationIssue, setNativeValidationIssue] = useState<NativeValidationIssue | null>(null);
  useEffect(() => {
    if (nativeValidationIssue && isNativeValidationIssueResolved(nativeValidationIssue.control)) setNativeValidationIssue(null);
  });
  const [localSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  const isSubmitting = localSubmitting || draft.submitting;
  const [setup, setSetup] = useState(draft.value.setup ?? setupDraft());
  const [positions, setPositions] = useState<PositionDraft[]>(draft.value.positions ?? []);
  const [payContours, setPayContours] = useState<ContourDraft[]>(draft.value.payContours ?? []);
  const [contacts, setContacts] = useState<ContactDraft[]>(draft.value.contacts ?? []);
  const [automaticSeasons, setAutomaticSeasons] = useState(draft.value.automaticSeasons ?? false);
  const [summerStartsOn, setSummerStartsOn] = useState(draft.value.summerStartsOn ?? '');
  const [winterStartsOn, setWinterStartsOn] = useState(draft.value.winterStartsOn ?? '');
  const [responsibleUserId, setResponsibleUserId] = useState(draft.value.responsibleUserId ?? '');
  const [managerUserIds, setManagerUserIds] = useState<string[]>(draft.value.managerUserIds ?? []);
  const [counterpartyId, setCounterpartyId] = useState(draft.value.counterpartyId ?? '');
  const employeeIds = [...new Set(positions.flatMap(position => position.groups.flatMap(group => group.assignments.map(assignment => assignment.employeeId))))].sort();
  const creationContext = JSON.stringify({ status: form.status, responsibleUserId: responsibleUserId || undefined, managerUserIds: [...managerUserIds].sort(), employeeIds });
  const [projectionRetry, setProjectionRetry] = useState(0);
  const scope = `${accessRevision}:${projectionRetry}:${creationContext}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [projection, setProjection] = useState<{ scope: string; value: { base: boolean; rates: boolean; materials: boolean; setup: { core: boolean; contract: boolean; budgets: boolean; coefficient: boolean }; schedule: boolean; contours: boolean; selectPayConditions: boolean; counterparty: boolean; preview: boolean; employees: Record<string, boolean> } } | null>(null);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setProjectionError(null);
    void fetcher<NonNullable<typeof projection>['value']>('/objects/creation-capabilities', { method: 'POST', body: creationContext })
      .then(value => { if (active) setProjection({ scope, value }); })
      .catch((caught: unknown) => { if (active) setProjectionError(caught instanceof Error ? caught.message : 'Не удалось проверить права создания.'); });
    return () => { active = false; };
  }, [scope, creationContext, projectionRetry]);
  const createCaps = projection?.scope === scope && !projectionError ? projection.value : null;
  const currentDraft = { form, setup, positions, payContours, contacts, automaticSeasons, summerStartsOn, winterStartsOn, responsibleUserId, managerUserIds, counterpartyId };
  const pristineSnapshot = useRef(JSON.stringify(currentDraft));
  const wasDirtyOnMount = useRef(draft.dirty);
  const dirty = draft.dirty;
  useEffect(() => {
    const nextDirty = wasDirtyOnMount.current || JSON.stringify(currentDraft) !== pristineSnapshot.current;
    draft.setValue(currentDraft);
    if (!nextDirty) draft.setDirty(false);
  }, [form, setup, positions, payContours, contacts, automaticSeasons, summerStartsOn, winterStartsOn, responsibleUserId, managerUserIds, counterpartyId]);

  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;
  const allowLinkCounterparty =
    (user?.capabilities?.canLinkCounterpartyObjects ?? false) && (createCaps?.counterparty ?? false);
  const allowEmployees = !!user?.capabilities?.canAccessEmployeesHr && !!createCaps?.schedule;
  const canEditInitialBudget = createCaps?.setup.budgets ?? false;
  const setupCapabilities: SetupCapabilities = {
    canEditCore: createCaps?.setup.core ?? false, canViewContractAmount: createCaps?.setup.contract ?? false, canEditContractAmount: createCaps?.setup.contract ?? false,
    canViewBudgets: allowCreateObject && canEditInitialBudget, canEditBudgets: canEditInitialBudget,
    // Object-scoped coefficient capability is returned after creation; do not infer it from identity.
    canViewCoefficient: createCaps?.setup.coefficient ?? false, canEditCoefficient: createCaps?.setup.coefficient ?? false,
  };

  const compensationProfiles: ObjectCompensationProfilesValue = {
    paymentType: form.paymentType,
    dailyRate: form.dailyRate,
    monthlySalary: form.monthlySalary,
    paymentScheduleCode: form.paymentScheduleCode,
    paymentScheduleWeekdays: form.paymentScheduleWeekdays,
    paymentScheduleCycleStartDate: form.paymentScheduleCycleStartDate,
    summerPaymentType: form.summerPaymentType,
    summerDailyRate: form.summerDailyRate,
    summerMonthlySalary: form.summerMonthlySalary,
    summerScheduleCode: form.summerScheduleCode,
    summerScheduleWeekdays: form.summerScheduleWeekdays,
    summerScheduleCycleStartDate: form.summerScheduleCycleStartDate,
    winterPaymentType: form.winterPaymentType,
    winterDailyRate: form.winterDailyRate,
    winterMonthlySalary: form.winterMonthlySalary,
    winterScheduleCode: form.winterScheduleCode,
    winterScheduleWeekdays: form.winterScheduleWeekdays,
    winterScheduleCycleStartDate: form.winterScheduleCycleStartDate,
  };
  const invalidScheduleProfiles = getInvalidObjectScheduleProfiles(compensationProfiles);

  useEffect(() => {
    let active = true;
    setResponsibles(null);
    setManagers(null);
    if (allowCreateObject) {
      const load = (purpose: 'object_responsible' | 'object_manager', setResult: typeof setResponsibles) => {
        void listSystemUsers({ purpose }).then(options => {
          if (active) setResult({ revision: accessRevision, options, error: null });
        }).catch((caught: unknown) => {
          if (active) setResult({ revision: accessRevision, options: [], error: caught instanceof Error && caught.message ? caught.message : 'Не удалось загрузить пользователей системы.' });
        });
      };
      load('object_responsible', setResponsibles);
      load('object_manager', setManagers);
    }
    return () => { active = false; };
  }, [allowCreateObject, accessRevision]);

  const responsibleResult = allowCreateObject && responsibles?.revision === accessRevision ? responsibles : null;
  const managerResult = allowCreateObject && managers?.revision === accessRevision ? managers : null;
  const referencesReady = (!responsibleUserId || (!!responsibleResult && !responsibleResult.error)) &&
    (!managerUserIds.length || (!!managerResult && !managerResult.error));
  const managerCandidates = (managerResult?.options ?? []).filter((candidate) => candidate.id !== user?.id);
  const responsibleOptions = (responsibleResult?.options ?? []).map((candidate) => ({
    value: candidate.id,
    label: getUserDisplayName(candidate),
    description: getUserSecondaryLabel(candidate) || undefined,
    searchText: `${candidate.fullName} ${candidate.login}`,
  }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting || submitLock.current) return;
    setError(null);

    setNativeValidationIssue(null);

    if (!allowCreateObject || !createCaps?.base) {
      setError('Создание объекта сейчас недоступно. Проверьте выданные права или обновите доступ.');
      return;
    }
    if (!referencesReady) {
      setError('Не удалось подтвердить выбранную команду. Черновик сохранён; повторите после восстановления доступа.');
      return;
    }

    const invalid = findSectionValidationIssue(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
    if (invalid) {
      if (invalid.control instanceof HTMLElement) setNativeValidationIssue({ control: invalid.control, message: invalid.message });
      revealSectionValidationIssue(invalid, setActiveSection, (callback) => window.requestAnimationFrame(callback));
      return;
    }

    if (createCaps.rates && invalidScheduleProfiles.length > 0) {
      setActiveSection('payment');
      setError(`Проверьте график в профилях: ${invalidScheduleProfiles.join(', ')}.`);
      return;
    }

    const projectedPositions = projectCreatePositions(positions, createCaps);
    const omitted: string[] = [];
    if (!createCaps.rates && (automaticSeasons || summerStartsOn || winterStartsOn ||
      [form.paymentType, form.summerPaymentType, form.winterPaymentType].some(value => value !== 'monthly') ||
      [form.paymentScheduleCode, form.summerScheduleCode, form.winterScheduleCode].some(value => value !== '5/2') ||
      [form.paymentScheduleWeekdays, form.summerScheduleWeekdays, form.winterScheduleWeekdays].some(value => value.length > 0) ||
      [form.paymentScheduleCycleStartDate, form.summerScheduleCycleStartDate, form.winterScheduleCycleStartDate].some(Boolean) ||
      [form.dailyRate, form.monthlySalary, form.summerDailyRate, form.summerMonthlySalary, form.winterDailyRate, form.winterMonthlySalary].some(value => Number(value) !== 0))) omitted.push('условия оплаты и сезоны');
    if (!createCaps.materials && form.instructionStepsText.trim()) omitted.push('инструкции');
    if ((!createCaps.setup.core && (setup.legalName || setup.areaSqM || setup.plannedLaunchDate || setup.contractStartsOn || setup.contractEndsOn || setup.salesResponsibleUserId)) || (!createCaps.setup.contract && setup.contractMonthlyAmount) || (!createCaps.setup.budgets && setup.budgets.length) || (!createCaps.setup.coefficient && setup.coefficient)) omitted.push('настройки и бюджет');
    if (!createCaps.contours && payContours.length) omitted.push('отдельные условия оплаты');
    if (projectedPositions.omittedPositions) omitted.push('недоступные позиции');
    if (projectedPositions.omittedAssignments) omitted.push('недоступные назначения сотрудников');
    if (!allowLinkCounterparty && counterpartyId) omitted.push('связь с контрагентом');
    submitLock.current = true;
    if (omitted.length && !await confirmOmissions({ title: 'Создать объект без части данных?', consequence: `Не будут сохранены: ${omitted.join(', ')}. Отмена сохранит весь черновик.`, confirmLabel: 'Создать без этих данных' })) { submitLock.current = false; return; }
    if (scopeRef.current !== scope) { submitLock.current = false; setError('Права или выбранные данные изменились. Проверьте форму ещё раз.'); return; }
    setIsSubmitting(true);

    try {
      await draft.submit(() => createObject(createPayloadForAccess({
        contacts: contacts.map(contactPayload),
        name: form.name.trim(),
        internalName: form.internalName.trim() || undefined,
        address: form.address.trim(),
        status: form.status,
        summerWindowCleaning: form.summerWindowCleaning,
        engineeringRequired: form.engineeringRequired,
        winterTractorMode: form.winterTractorMode,
        notes: form.notes.trim() || undefined,
        managerUserIds,
        responsibleUserId: responsibleUserId || undefined,
      }, {
        rates: createCaps.rates,
        materials: createCaps.materials,
        setup: createCaps.setup.core || createCaps.setup.contract || createCaps.setup.budgets || createCaps.setup.coefficient,
        contours: createCaps.contours,
        positions: projectedPositions.positions.length > 0,
        counterparty: allowLinkCounterparty && !!counterpartyId,
      }, {
        rates: () => ({
        planning: seasonPlanningPayload(automaticSeasons, summerStartsOn, winterStartsOn),
        seasonMode: null,
        paymentType: form.paymentType,
        monthlySalary: Number(form.monthlySalary) || 0,
        dailyRate: Number(form.dailyRate) || 0,
        paymentScheduleCode: form.paymentScheduleWeekdays.length ? null : form.paymentScheduleCode || '5/2',
        paymentScheduleWeekdays: form.paymentScheduleWeekdays,
        paymentScheduleCycleStartDate: form.paymentScheduleWeekdays.length || form.paymentScheduleCode === '5/2' ? null : form.paymentScheduleCycleStartDate,
        summerPaymentType: form.summerPaymentType,
        summerMonthlySalary: Number(form.summerMonthlySalary) || 0,
        summerDailyRate: Number(form.summerDailyRate) || 0,
        summerScheduleCode: form.summerScheduleWeekdays.length ? null : form.summerScheduleCode || '5/2',
        summerScheduleWeekdays: form.summerScheduleWeekdays,
        summerScheduleCycleStartDate: form.summerScheduleWeekdays.length || form.summerScheduleCode === '5/2' ? null : form.summerScheduleCycleStartDate,
        winterPaymentType: form.winterPaymentType,
        winterMonthlySalary: Number(form.winterMonthlySalary) || 0,
        winterDailyRate: Number(form.winterDailyRate) || 0,
        winterScheduleCode: form.winterScheduleWeekdays.length ? null : form.winterScheduleCode || '5/2',
        winterScheduleWeekdays: form.winterScheduleWeekdays,
        winterScheduleCycleStartDate: form.winterScheduleWeekdays.length || form.winterScheduleCode === '5/2' ? null : form.winterScheduleCycleStartDate,
        }),
        materials: () => ({ instructionSteps: form.instructionStepsText.split('\n').map((step) => step.trim()).filter(Boolean) }),
        setup: () => ({ setup: setupPayload(setup, setupCapabilities) }),
        contours: () => ({ payContours: payContours.map(contourPayload) }),
        positions: () => ({ staffingPositions: projectedPositions.positions.map(positionPayload) }),
        counterparty: () => ({ counterpartyId }),
      })));
      draft.clear();
      router.push('/objects');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Не удалось создать объект.',
      );
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (<>
    {omissionDialog}
    <FormDialog open title="Новый объект" size="wide" busy={isSubmitting} dirty={dirty}
      closeContext={closeContext} clearDraft={draft.clear}
      sections={{ sections: OBJECT_CREATE_SECTIONS, activeSectionId: activeSection, onSectionChange: setActiveSection }}
      footer={({ requestClose }) => <div className={styles.actions}>
        <Button variant="ghost" onClick={() => void requestClose()} disabled={isSubmitting}>Отмена</Button>
        <Button variant="primary" type="submit" form="object-create-form" disabled={isSubmitting || !allowCreateObject || !createCaps?.base || !referencesReady}>
          {isSubmitting ? 'Создаём…' : 'Создать объект'}
        </Button>
      </div>}>
      <div className={`ui-page object-create-page ${styles.page}`}>
      {projectionError ? <Alert tone="danger" action={<Button onClick={() => setProjectionRetry(value => value + 1)}>Повторить</Button>}>{projectionError}</Alert> : !createCaps ? <Alert tone="info">Проверяем права создания…</Alert> : null}
      <form id="object-create-form" className={styles.form} data-active-section={activeSection} noValidate onSubmit={handleSubmit}>
        <section data-create-section="basic" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Основные данные</h2>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Название</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Например, ЖК Северный"
                disabled={isSubmitting}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Внутреннее имя</span>
              <input
                value={form.internalName}
                onChange={(event) => setForm((prev) => ({ ...prev, internalName: event.target.value }))}
                placeholder="Короткое рабочее название"
                disabled={isSubmitting}
              />
            </label>

            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span className={styles.fieldLabel}>Адрес</span>
              <input
                value={form.address}
                onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                placeholder="Город, улица, дом"
                disabled={isSubmitting}
                required
              />
            </label>

            {allowLinkCounterparty ? (
              <div className={`${styles.field} ${styles.fullWidth}`}>
                <SearchableSelect
                  label="Контрагент"
                  value={counterpartyId}
                  options={[]}
                  placeholder="Без привязки"
                  searchPlaceholder="Название или юридическое название"
                  emptyText="Контрагенты не найдены"
                  viewportAware
                  asyncSearch={async (query) =>
                    (await listCounterpartyReferences({ q: query, limit: 20 })).map(
                      (counterparty) => ({
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
                  onChange={setCounterpartyId}
                  disabled={isSubmitting}
                />
              </div>
            ) : null}
            <div className={styles.fullWidth}>
              <SelectField label="Статус" clearable={false} searchable={false} value={form.status}
                options={STATUS_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, status: value }))} disabled={isSubmitting} />
            </div>
          </div>
        </section>

        <section data-create-section="setup" className={styles.section}>
          <AccessSnapshotBoundary blocked={!createCaps || !(createCaps.setup.core || createCaps.setup.contract || createCaps.setup.budgets || createCaps.setup.coefficient)}>
          <ObjectSetupEditor value={{ ...setup, ...(createCaps?.setup.core ? {} : { legalName: '', areaSqM: '', plannedLaunchDate: '', contractStartsOn: '', contractEndsOn: '', salesResponsibleUserId: '' }), ...(createCaps?.setup.contract ? {} : { contractMonthlyAmount: '' }), ...(canEditInitialBudget ? {} : { budgets: [] }), ...(createCaps?.setup.coefficient ? {} : { coefficient: '' }) }} onChange={(next) => setSetup((current) => ({ ...next, ...(createCaps?.setup.core ? {} : { legalName: current.legalName, areaSqM: current.areaSqM, plannedLaunchDate: current.plannedLaunchDate, contractStartsOn: current.contractStartsOn, contractEndsOn: current.contractEndsOn, salesResponsibleUserId: current.salesResponsibleUserId }), ...(createCaps?.setup.contract ? {} : { contractMonthlyAmount: current.contractMonthlyAmount }), ...(canEditInitialBudget ? {} : { budgets: current.budgets }), ...(createCaps?.setup.coefficient ? {} : { coefficient: current.coefficient }) }))} capabilities={setupCapabilities} disabled={isSubmitting}
            activeSection={activeSection === 'articles' ? 'articles' : 'contract'}
            selectedSalesUser={responsibleOptions.find((option) => option.value === setup.salesResponsibleUserId)}
            searchUsers={async (q) => (await listSystemUsers({ purpose: 'object_responsible', q, limit: 20 })).map((candidate) => ({ value: candidate.id, label: getUserDisplayName(candidate), description: getUserSecondaryLabel(candidate) ?? undefined }))} />
          </AccessSnapshotBoundary>
          <p className={styles.helperText}>Коэффициент и дополнительные персональные права доступны после создания в настройках объекта.</p>
        </section>

        <section data-create-section="payment" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Условия и оплата</h2>
          </div>

          <AccessSnapshotBoundary blocked={!createCaps?.rates}><div className={styles.conditionsGrid}>
            <div className={styles.fullWidth}><SeasonFields automatic={automaticSeasons} summer={summerStartsOn} winter={winterStartsOn} onAutomaticChange={setAutomaticSeasons} onSummerChange={setSummerStartsOn} onWinterChange={setWinterStartsOn} disabled={isSubmitting || !createCaps?.rates} /></div>

            <div className={`${styles.fullWidth}`}>
              <ObjectCompensationProfiles
                value={compensationProfiles}
                showSeasonalProfiles={automaticSeasons}
                disabled={isSubmitting || !createCaps?.rates}
                onChange={(nextValue) => setForm((previous) => ({ ...previous, ...nextValue }))}
              />
            </div>
          </div></AccessSnapshotBoundary>
        </section>

        <section data-create-section="people" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <h2>Команда объекта</h2>
            </div>
          </div>

            <div className={styles.teamGrid}>
              {!responsibleResult ? <div className={styles.notice}>Загрузка ответственных…</div> : responsibleResult.error ? <div className={styles.error}>Ответственные: {responsibleResult.error}</div> : (
              <SearchableSelect
                label="Ответственный"
                value={responsibleUserId}
                options={responsibleOptions}
                placeholder="Создатель объекта"
                searchPlaceholder="ФИО или логин"
                emptyText="Подходящие пользователи не найдены"
                clearable
                viewportAware
                onChange={setResponsibleUserId}
                disabled={isSubmitting}
              />
              )}
              {!managerResult ? <div className={styles.notice}>Загрузка менеджеров…</div> : managerResult.error ? <div className={styles.error}>Менеджеры: {managerResult.error}</div> : (
              <ManagerMultiSelect
                options={managerCandidates}
                value={managerUserIds}
                onChange={setManagerUserIds}
                disabled={isSubmitting}
              />
              )}
            </div>
        </section>

        <section data-create-section="people" className={styles.section}>
          <h2 className="ui-section-title">Контакты объекта</h2>
          <p className={styles.helperText}>Необязательно. Контактные лица не являются сотрудниками или системными пользователями.</p>
          {contacts.map((contact) => <div key={contact.key} className={styles.section}>
            <ContactEditor value={contact} disabled={isSubmitting} onChange={(next) => setContacts((previous) => previous.map((item) => item.key === contact.key ? next : item))} />
            <div><Button disabled={isSubmitting} onClick={() => setContacts((previous) => previous.filter((item) => item.key !== contact.key))}>Убрать контакт из черновика</Button></div>
          </div>)}
          <div><Button disabled={isSubmitting} onClick={() => setContacts((previous) => [...previous, newContactDraft()])}>Добавить контакт</Button></div>
        </section>

        <section data-create-section="payment" className={styles.section}>
          <AccessSnapshotBoundary blocked={!createCaps?.contours}>
          <h2 className="ui-section-title">Отдельные условия оплаты</h2>
          <p className={styles.helperText}>Необязательно. Для дневной и ночной работы можно явно задать разные контуры. Каждый контур оплачивается сотруднику один раз в день; разные контуры суммируются. Они применимы к оплате за выход, не к месячной модели.</p>
          {payContours.map((contour) => <div key={contour.code} className={styles.section}>
            <PayContourEditor value={contour} disabled={isSubmitting || !createCaps?.contours} onChange={(next) => setPayContours((previous) => previous.map((item) => item.code === contour.code ? next : item))} />
            <div><Button disabled={isSubmitting || positions.some((position) => position.groups.some((group) => group.intervals.some((interval) => interval.contourId === `draft:${contour.code}`)))} onClick={() => setPayContours((previous) => previous.filter((item) => item.code !== contour.code))}>Убрать условия</Button></div>
            {positions.some((position) => position.groups.some((group) => group.intervals.some((interval) => interval.contourId === `draft:${contour.code}`))) ? <p className={styles.helperText}>Чтобы убрать условия, сначала выберите другие в интервалах графика.</p> : null}
          </div>)}
          <div><Button disabled={isSubmitting} onClick={() => setPayContours((previous) => [...previous, newContourDraft()])}>Добавить условия оплаты</Button></div>
          </AccessSnapshotBoundary>
        </section>

        <section data-create-section="staffing" className={styles.section}>
          <AccessSnapshotBoundary blocked={!createCaps?.schedule || employeeIds.some(id => !createCaps.employees[id])}>
          <PositionsEditor value={positions} onChange={setPositions} disabled={isSubmitting || !createCaps?.schedule || employeeIds.some(id => !createCaps.employees[id])}
            contours={createCaps?.contours ? payContours.map((contour) => ({ value: `draft:${contour.code}`, label: contour.name || 'Новые условия оплаты' })) : []} canSelectPayConditions={createCaps?.selectPayConditions ?? false}
            onPreview={createCaps?.preview ? (position, from, to) => previewNewObjectSchedule({ from, to, draft: positionPayload(position) }) : undefined}
            canAssignEmployees={allowEmployees}
            employeeAccessMessage="Кадровый реестр недоступен. Создайте объект без сотрудников; доступный состав можно выбрать позднее в «Команде»."
            searchEmployees={async (search) => {
              if (!allowEmployees) return [];
              const response = await listEmployees({ search, page: 1, limit: 20, archiveState: 'active' });
              return response.items.map((employee) => ({ value: employee.id, label: employee.fullName, description: employee.position ?? undefined }));
            }} />
          {positions.length ? <Alert tone="info">Сведения, контуры и позиции сохраняются вместе. Предпросмотр не создаёт объект, присутствие или начисление.</Alert> : null}
          </AccessSnapshotBoundary>
        </section>

        <section data-create-section="payment" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Сезонные профили</h2>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={form.summerWindowCleaning} onChange={(event) => setForm((prev) => ({ ...prev, summerWindowCleaning: event.target.checked }))} disabled={isSubmitting} />
              <span>Лето: мыть окна</span>
            </label>
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <SelectField
                label="Зима: трактор"
                clearable={false}
                searchable={false}
                value={form.winterTractorMode}
                options={[
                  { value: 'none', label: 'Не нужен' },
                  { value: 'with_removal', label: 'С вывозом' },
                  { value: 'without_removal', label: 'Без вывоза' },
                ]}
                onChange={(value) => setForm((prev) => ({ ...prev, winterTractorMode: value as typeof prev.winterTractorMode }))}
                disabled={isSubmitting}
              />
            </div>
          </div>
        </section>

        <section data-create-section="instructions" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Дополнительные работы</h2>
          </div>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={form.engineeringRequired} onChange={(event) => setForm((prev) => ({ ...prev, engineeringRequired: event.target.checked }))} disabled={isSubmitting} />
            <span>Инженерка</span>
          </label>
        </section>

        <section data-create-section="instructions" className={styles.section}>
          <AccessSnapshotBoundary blocked={!createCaps?.materials}>
          <div className={styles.sectionHeader}>
            <h2>Инструкции для объекта</h2>
          </div>

          <textarea
            className={styles.notesField}
            aria-label="Постоянные инструкции для объекта"
            value={form.instructionStepsText}
            onChange={(event) => setForm((prev) => ({ ...prev, instructionStepsText: event.target.value }))}
            placeholder="Один постоянный шаг на строку, например: Проверить входную группу"
            disabled={isSubmitting || !createCaps?.materials}
          />
          <p className={styles.helperText}>Это постоянные инструкции, а не отметки выполнения смены. Отчёт по каждому выходу добавим отдельно.</p>
          </AccessSnapshotBoundary>
        </section>

        <section data-create-section="instructions" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Что важно знать об объекте</h2>
          </div>
          <textarea
            className={styles.notesField}
            aria-label="Что важно знать об объекте"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Особенности объекта, договорённости, важные замечания…"
            disabled={isSubmitting}
          />
        </section>

        {nativeValidationIssue || error ? <Alert tone="danger" className={styles.formError}>{nativeValidationIssue?.message ?? error}</Alert> : null}

      </form>
      </div>
    </FormDialog>
  </>
  );
}

