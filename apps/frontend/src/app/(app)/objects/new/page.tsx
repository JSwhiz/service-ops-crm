'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCounterpartyReferences } from '@/entities/counterparty/api/counterparty-client';
import { createObject } from '@/entities/object/api/object-client';
import {
  listSystemUsers,
  type SystemUserOption,
} from '@/entities/user/api/user-client';
import { useAuth } from '@/shared/auth/use-auth';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './new-object.module.css';

interface CompactSelectOption {
  value: string;
  label: string;
}

interface CompactSelectProps {
  label: string;
  value: string;
  options: CompactSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6.5 8 3.5 3.5L13.5 8" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5.5 10 3 3 6-6" />
    </svg>
  );
}

function CompactSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: CompactSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

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
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.compactSelect} ref={rootRef}>
      <span className={styles.fieldLabel}>{label}</span>
      <button
        type="button"
        className={styles.selectTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? 'Выберите значение'}</span>
        <ChevronIcon />
      </button>

      {open ? (
        <div className={styles.selectPopover} role="listbox" aria-label={label}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={styles.selectOption}
                data-selected={isSelected ? 'true' : 'false'}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <CheckIcon /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
  const searchRef = useRef<HTMLInputElement>(null);
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
      <div className={styles.managerSelectLabel}>
        <span className={styles.fieldLabel}>Менеджеры</span>
      </div>

      <button
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
        <ChevronIcon />
      </button>

      {open ? (
        <div className={`${styles.selectPopover} ${styles.managerPopover}`}>
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

const STATUS_OPTIONS: CompactSelectOption[] = [
  { value: 'active', label: 'Активный' },
  { value: 'frozen', label: 'Заморожен' },
  { value: 'archived', label: 'Архив' },
];

const SEASON_OPTIONS: CompactSelectOption[] = [
  { value: '', label: 'Без сезонности' },
  { value: 'summer', label: 'Летний' },
  { value: 'winter', label: 'Зимний' },
];

const PAYMENT_OPTIONS: CompactSelectOption[] = [
  { value: 'monthly', label: 'Фиксированная ЗП за месяц' },
  { value: 'daily', label: 'Дневная ставка за выход' },
];

function formatManagerCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11
    ? 'менеджер'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? 'менеджера'
      : 'менеджеров';
  return `${count} ${noun}`;
}

export default function NewObjectPage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: '',
    internalName: '',
    address: '',
    status: 'active',
    seasonMode: '',
    paymentType: 'monthly' as 'monthly' | 'daily',
    monthlySalary: '0',
    dailyRate: '0',
    notes: '',
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

  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;
  const allowLinkCounterparty =
    user?.capabilities?.canLinkCounterpartyObjects ?? false;

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
  const selectedResponsible = responsibleCandidates.find((candidate) => candidate.id === responsibleUserId) ?? null;
  const responsibleOptions = responsibleCandidates.map((candidate) => ({
    value: candidate.id,
    label: getUserDisplayName(candidate),
    description: getUserSecondaryLabel(candidate) || undefined,
    searchText: `${candidate.fullName} ${candidate.login}`,
  }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!allowCreateObject) {
      setError('У вашей роли нет прав на создание объектов.');
      return;
    }

    if (!responsibleUserId) {
      setError('Выберите ответственного за объект.');
      return;
    }

    setIsSubmitting(true);

    try {
      await createObject({
        name: form.name.trim(),
        internalName: form.internalName.trim(),
        address: form.address.trim(),
        status: form.status,
        seasonMode: form.seasonMode || null,
        paymentType: form.paymentType,
        monthlySalary: Number(form.monthlySalary) || 0,
        dailyRate: Number(form.dailyRate) || 0,
        notes: form.notes.trim() || undefined,
        counterpartyId: allowLinkCounterparty ? counterpartyId || null : null,
        managerUserIds,
        responsibleUserId,
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
    <div className={`workspace-page object-create-page ${styles.page}`}>
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
                required
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
          <div className={styles.sectionHeader}>
            <h2>Условия и оплата</h2>
          </div>

          <div className={styles.conditionsGrid}>
            <CompactSelect
              label="Статус"
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
              disabled={isSubmitting}
            />

            <CompactSelect
              label="Сезон"
              value={form.seasonMode}
              options={SEASON_OPTIONS}
              onChange={(value) => setForm((prev) => ({ ...prev, seasonMode: value }))}
              disabled={isSubmitting}
            />

            <CompactSelect
              label="Тип оплаты"
              value={form.paymentType}
              options={PAYMENT_OPTIONS}
              onChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  paymentType: value as 'monthly' | 'daily',
                }))
              }
              disabled={isSubmitting}
            />

            {form.paymentType === 'monthly' ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>ЗП за месяц</span>
                <div className={styles.moneyField}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.monthlySalary}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, monthlySalary: event.target.value }))
                    }
                    disabled={isSubmitting}
                  />
                  <span>₽</span>
                </div>
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Дневная ставка</span>
                <div className={styles.moneyField}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.dailyRate}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, dailyRate: event.target.value }))
                    }
                    disabled={isSubmitting}
                  />
                  <span>₽</span>
                </div>
              </label>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <h2>Команда объекта</h2>
              <span className={styles.sectionMeta}>
                {selectedResponsible
                  ? `Ответственный: ${getUserDisplayName(selectedResponsible)}`
                  : 'Ответственный не выбран'}
                <span aria-hidden="true"> · </span>
                {formatManagerCount(managerUserIds.length)}
              </span>
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
                placeholder="Выберите ответственного"
                searchPlaceholder="ФИО или логин"
                emptyText="Подходящие пользователи не найдены"
                clearable={false}
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

        {error ? <div className={styles.formError}>{error}</div> : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => router.push('/objects')}
            disabled={isSubmitting}
          >
            Отмена
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSubmitting || isUsersLoading || !allowCreateObject || !responsibleUserId}
          >
            {isSubmitting ? 'Создаём…' : 'Создать объект'}
          </button>
        </div>
      </form>
    </div>
  );
}
