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
import { setupDraft, setupPayload } from '@/features/object-setup/model/setup-draft';
import type { SetupCapabilities } from '@/entities/object/model/object-setup.types';
import { ContactEditor, contactPayload, newContactDraft, type ContactDraft } from '@/features/object-contacts/ui/contact-editor';
import { SeasonFields } from '@/features/object-planning/ui/season-fields';
import { seasonPlanningPayload } from '@/features/object-planning/model/season-planning';
import { useConfirm } from '@/shared/ui/overlays';
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
import { PageTitle } from '@/shared/ui/page-title/page-title';
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

export default function NewObjectPage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();

  const [form, setForm] = useState({
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

  const [responsibleCandidates, setResponsibleCandidates] = useState<SystemUserOption[]>([]);
  const [managerUsers, setManagerUsers] = useState<SystemUserOption[]>([]);
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [managerUserIds, setManagerUserIds] = useState<string[]>([]);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setup, setSetup] = useState(setupDraft);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [payContours, setPayContours] = useState<ContourDraft[]>([]);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [automaticSeasons, setAutomaticSeasons] = useState(false);
  const [summerStartsOn, setSummerStartsOn] = useState('');
  const [winterStartsOn, setWinterStartsOn] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const initialForm = useRef(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm.current) || JSON.stringify(setup) !== JSON.stringify(setupDraft()) || !!positions.length || !!payContours.length || !!contacts.length || automaticSeasons || !!responsibleUserId || !!managerUserIds.length || !!counterpartyId;
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;
  const allowLinkCounterparty =
    user?.capabilities?.canLinkCounterpartyObjects ?? false;
  const allowEmployees = !!user?.capabilities?.canAccessEmployeesHr && !!user?.capabilities?.canManageEmployeeAssignments;
  const roles = user?.roleCodes?.length ? user.roleCodes : [user?.roleCode];
  const setupCapabilities: SetupCapabilities = {
    canEditCore: allowCreateObject, canViewContractAmount: allowCreateObject, canEditContractAmount: allowCreateObject,
    canViewBudgets: allowCreateObject, canEditBudgets: roles.some((role) => role === 'founder' || role === 'director'),
    // Object-scoped coefficient capability is returned after creation; do not infer it from identity.
    canViewCoefficient: false, canEditCoefficient: false,
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
    const loadUsers = async (): Promise<void> => {
      if (!allowCreateObject) {
        setResponsibleCandidates([]);
        setManagerUsers([]);
        setUsersError(null);
        setIsUsersLoading(false);
        return;
      }

      setIsUsersLoading(true);
      setUsersError(null);

      try {
        const [responsibles, managers] = await Promise.all([
          listSystemUsers({ purpose: 'object_responsible' }),
          listSystemUsers({ purpose: 'object_manager' }),
        ]);
        setResponsibleCandidates(responsibles);
        setManagerUsers(managers);
      } catch (caughtError) {
        setUsersError(
          caughtError instanceof Error && caughtError.message
            ? caughtError.message
            : 'Не удалось загрузить пользователей системы.',
        );
      } finally {
        setIsUsersLoading(false);
      }
    };

    void loadUsers();
  }, [allowCreateObject]);

  const managerCandidates = managerUsers.filter((candidate) => candidate.id !== user?.id);
  const responsibleOptions = responsibleCandidates.map((candidate) => ({
    value: candidate.id,
    label: getUserDisplayName(candidate),
    description: getUserSecondaryLabel(candidate) || undefined,
    searchText: `${candidate.fullName} ${candidate.login}`,
  }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);

    if (!allowCreateObject) {
      setError('У вашей роли нет прав на создание объектов.');
      return;
    }

    if (invalidScheduleProfiles.length > 0) {
      setError(`Проверьте график в профилях: ${invalidScheduleProfiles.join(', ')}.`);
      return;
    }

    setIsSubmitting(true);

    try {
      await createObject({
        planning: seasonPlanningPayload(automaticSeasons, summerStartsOn, winterStartsOn),
        payContours: payContours.map(contourPayload),
        contacts: contacts.map(contactPayload),
        setup: setupPayload(setup, setupCapabilities),
        staffingPositions: positions.map(positionPayload),
        name: form.name.trim(),
        internalName: form.internalName.trim() || undefined,
        address: form.address.trim(),
        status: form.status,
        seasonMode: null,
        summerWindowCleaning: form.summerWindowCleaning,
        engineeringRequired: form.engineeringRequired,
        winterTractorMode: form.winterTractorMode,
        instructionSteps: form.instructionStepsText.split('\n').map((step) => step.trim()).filter(Boolean),
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
        notes: form.notes.trim() || undefined,
        counterpartyId: allowLinkCounterparty ? counterpartyId || null : null,
        managerUserIds,
        responsibleUserId: responsibleUserId || undefined,
      });
      router.push('/objects');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : 'Не удалось создать объект.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`ui-page object-create-page ${styles.page}`}>
      {confirmDialog}
      <PageTitle title="Новый объект" />
      <form className={styles.form} onSubmit={handleSubmit}>
        <section className={styles.section}>
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
          </div>
        </section>

        <section className={styles.section}>
          <ObjectSetupEditor value={setup} onChange={setSetup} capabilities={setupCapabilities} disabled={isSubmitting}
            selectedSalesUser={responsibleOptions.find((option) => option.value === setup.salesResponsibleUserId)}
            searchUsers={async (q) => (await listSystemUsers({ purpose: 'object_responsible', q, limit: 20 })).map((candidate) => ({ value: candidate.id, label: getUserDisplayName(candidate), description: getUserSecondaryLabel(candidate) ?? undefined }))} />
          <p className={styles.helperText}>Коэффициент и дополнительные персональные права доступны после создания в настройках объекта.</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Условия и оплата</h2>
          </div>

          <div className={styles.conditionsGrid}>
            <SelectField
              label="Статус"
              clearable={false}
              searchable={false}
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
              disabled={isSubmitting}
            />

            <div className={styles.fullWidth}><SeasonFields automatic={automaticSeasons} summer={summerStartsOn} winter={winterStartsOn} onAutomaticChange={setAutomaticSeasons} onSummerChange={setSummerStartsOn} onWinterChange={setWinterStartsOn} disabled={isSubmitting} /></div>

            <div className={`${styles.fullWidth}`}>
              <ObjectCompensationProfiles
                value={compensationProfiles}
                showSeasonalProfiles={automaticSeasons}
                disabled={isSubmitting}
                onChange={(nextValue) => setForm((previous) => ({ ...previous, ...nextValue }))}
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <h2>Команда объекта</h2>
            </div>
          </div>

          {isUsersLoading ? (
            <div className={styles.notice}>Загрузка пользователей…</div>
          ) : usersError ? (
            <div className={styles.error}>{usersError}</div>
          ) : (
            <div className={styles.teamGrid}>
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

              <ManagerMultiSelect
                options={managerCandidates}
                value={managerUserIds}
                onChange={setManagerUserIds}
                disabled={isSubmitting}
              />
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className="ui-section-title">Контакты объекта</h2>
          <p className={styles.helperText}>Необязательно. Контактные лица не являются сотрудниками или системными пользователями.</p>
          {contacts.map((contact) => <div key={contact.key} className={styles.section}>
            <ContactEditor value={contact} disabled={isSubmitting} onChange={(next) => setContacts((previous) => previous.map((item) => item.key === contact.key ? next : item))} />
            <div><Button disabled={isSubmitting} onClick={() => setContacts((previous) => previous.filter((item) => item.key !== contact.key))}>Убрать контакт из черновика</Button></div>
          </div>)}
          <div><Button disabled={isSubmitting} onClick={() => setContacts((previous) => [...previous, newContactDraft()])}>Добавить контакт</Button></div>
        </section>

        <section className={styles.section}>
          <h2 className="ui-section-title">Отдельные условия оплаты</h2>
          <p className={styles.helperText}>Необязательно. Для дневной и ночной работы можно явно задать разные контуры. Каждый контур оплачивается сотруднику один раз в день; разные контуры суммируются. Они применимы к оплате за выход, не к месячной модели.</p>
          {payContours.map((contour) => <div key={contour.code} className={styles.section}>
            <PayContourEditor value={contour} disabled={isSubmitting} onChange={(next) => setPayContours((previous) => previous.map((item) => item.code === contour.code ? next : item))} />
            <div><Button disabled={isSubmitting || positions.some((position) => position.groups.some((group) => group.intervals.some((interval) => interval.contourId === `draft:${contour.code}`)))} onClick={() => setPayContours((previous) => previous.filter((item) => item.code !== contour.code))}>Убрать условия</Button></div>
            {positions.some((position) => position.groups.some((group) => group.intervals.some((interval) => interval.contourId === `draft:${contour.code}`))) ? <p className={styles.helperText}>Чтобы убрать условия, сначала выберите другие в интервалах графика.</p> : null}
          </div>)}
          <div><Button disabled={isSubmitting} onClick={() => setPayContours((previous) => [...previous, newContourDraft()])}>Добавить условия оплаты</Button></div>
        </section>

        <section className={styles.section}>
          <PositionsEditor value={positions} onChange={setPositions} disabled={isSubmitting}
            contours={payContours.map((contour) => ({ value: `draft:${contour.code}`, label: contour.name || 'Новые условия оплаты' }))} canSelectPayConditions={allowCreateObject}
            onPreview={(position, from, to) => previewNewObjectSchedule({ from, to, draft: positionPayload(position) })}
            canAssignEmployees={allowEmployees}
            employeeAccessMessage="Кадровый реестр недоступен. Создайте объект без сотрудников; доступный состав можно выбрать позднее в «Команде»."
            searchEmployees={async (search) => {
              if (!allowEmployees) return [];
              const response = await listEmployees({ search, page: 1, limit: 20, archiveState: 'active' });
              return response.items.map((employee) => ({ value: employee.id, label: employee.fullName, description: employee.position ?? undefined }));
            }} />
          {positions.length ? <Alert tone="info">Сведения, контуры и позиции сохраняются вместе. Предпросмотр не создаёт объект, присутствие или начисление.</Alert> : null}
        </section>

        <section className={styles.section}>
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

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Дополнительные работы</h2>
          </div>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={form.engineeringRequired} onChange={(event) => setForm((prev) => ({ ...prev, engineeringRequired: event.target.checked }))} disabled={isSubmitting} />
            <span>Инженерка</span>
          </label>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Инструкции для объекта</h2>
          </div>

          <textarea
            className={styles.notesField}
            aria-label="Постоянные инструкции для объекта"
            value={form.instructionStepsText}
            onChange={(event) => setForm((prev) => ({ ...prev, instructionStepsText: event.target.value }))}
            placeholder="Один постоянный шаг на строку, например: Проверить входную группу"
            disabled={isSubmitting}
          />
          <p className={styles.helperText}>Это постоянные инструкции, а не отметки выполнения смены. Отчёт по каждому выходу добавим отдельно.</p>
        </section>

        <section className={styles.section}>
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

        {error ? <Alert tone="danger" className={styles.formError}>{error}</Alert> : null}

        <div className={styles.actions}>
          <Button variant="ghost"

            onClick={async () => { if (!dirty || await confirm({ title: 'Отменить создание объекта?', consequence: 'Несохранённые сведения, контакты и графики будут потеряны.', confirmLabel: 'Отменить создание' })) router.push('/objects'); }}
            disabled={isSubmitting}
          >
            Отмена
          </Button>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || isUsersLoading || !allowCreateObject || invalidScheduleProfiles.length > 0}
          >
            {isSubmitting ? 'Создаём…' : 'Создать объект'}
          </Button>
        </div>
      </form>
    </div>
  );
}
