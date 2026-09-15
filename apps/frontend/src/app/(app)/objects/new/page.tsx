'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

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
  const [managerSearch, setManagerSearch] = useState('');
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
  const normalizedManagerSearch = managerSearch.trim().toLocaleLowerCase('ru');
  const visibleManagerCandidates = managerCandidates
    .filter((candidate) => {
      if (managerUserIds.includes(candidate.id)) return true;
      if (!normalizedManagerSearch) return true;
      return `${candidate.fullName} ${candidate.login}`
        .toLocaleLowerCase('ru')
        .includes(normalizedManagerSearch);
    })
    .sort((left, right) => {
      const leftSelected = managerUserIds.includes(left.id);
      const rightSelected = managerUserIds.includes(right.id);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return getUserDisplayName(left).localeCompare(getUserDisplayName(right), 'ru');
    });

  const responsibleOptions = responsibleCandidates.map((candidate) => ({
    value: candidate.id,
    label: getUserDisplayName(candidate),
    description: getUserSecondaryLabel(candidate) || undefined,
    searchText: `${candidate.fullName} ${candidate.login}`,
  }));

  const toggleManager = (userId: string): void => {
    setManagerUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((item) => item !== userId)
        : [...prev, userId],
    );
  };

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
    <div className={`workspace-page ${styles.page}`}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <Link href="/objects" className={styles.backLink}>← К объектам</Link>
          <h1>Новый объект</h1>
          <p>
            Создайте карточку объекта, задайте условия работы и назначьте стартовую команду.
            Сотрудников можно добавить после создания в самой карточке объекта.
          </p>
        </div>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <main className={styles.mainColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Основные данные</h2>
                <p>То, по чему объект будут находить и узнавать в системе.</p>
              </div>
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
              <div>
                <h2>Условия и оплата</h2>
                <p>Рабочий статус, сезонность и схема расчёта для объекта.</p>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Статус</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                  disabled={isSubmitting}
                >
                  <option value="active">Активный</option>
                  <option value="frozen">Заморожен</option>
                  <option value="archived">Архив</option>
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Сезон</span>
                <select
                  value={form.seasonMode}
                  onChange={(event) => setForm((prev) => ({ ...prev, seasonMode: event.target.value }))}
                  disabled={isSubmitting}
                >
                  <option value="">Без сезонности</option>
                  <option value="summer">Летний</option>
                  <option value="winter">Зимний</option>
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Тип оплаты</span>
                <select
                  value={form.paymentType}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      paymentType: event.target.value as 'monthly' | 'daily',
                    }))
                  }
                  disabled={isSubmitting}
                >
                  <option value="monthly">Фиксированная ЗП за месяц</option>
                  <option value="daily">Дневная ставка за выход</option>
                </select>
              </label>

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
                  <span className={styles.help}>
                    Полный месяц — вся сумма, неполный рассчитывается пропорционально фактическим выходам.
                  </span>
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
                  <span className={styles.help}>
                    Каждый отмеченный выход в табеле оплачивается по этой ставке.
                  </span>
                </label>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Комментарий</h2>
                <p>Необязательная рабочая информация, которая пригодится команде.</p>
              </div>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Комментарий к объекту</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Особенности объекта, договорённости, важные замечания…"
                disabled={isSubmitting}
              />
            </label>
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Команда объекта</h2>
                <p>Ответственный обязателен. Менеджеров можно назначить сразу или позже.</p>
              </div>
            </div>

            <div className={styles.teamBlock}>
              {isUsersLoading ? (
                <div className={styles.notice}>Загрузка пользователей…</div>
              ) : usersError ? (
                <div className={styles.error}>{usersError}</div>
              ) : (
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
              )}
            </div>

            <div className={styles.teamDivider} />

            <div className={styles.managerHeader}>
              <div>
                <span className={styles.fieldLabel}>Менеджеры</span>
                <span className={styles.managerCount}>
                  {managerUserIds.length > 0 ? `Выбрано: ${managerUserIds.length}` : 'Не выбраны'}
                </span>
              </div>
            </div>

            {!isUsersLoading && !usersError && managerCandidates.length > 0 ? (
              <>
                <input
                  className={styles.managerSearch}
                  type="search"
                  value={managerSearch}
                  onChange={(event) => setManagerSearch(event.target.value)}
                  placeholder="Найти менеджера"
                  aria-label="Поиск менеджера"
                  disabled={isSubmitting}
                />

                <div className={styles.managerList}>
                  {visibleManagerCandidates.length > 0 ? (
                    visibleManagerCandidates.map((candidate) => {
                      const selected = managerUserIds.includes(candidate.id);
                      const secondary = getUserSecondaryLabel(candidate);
                      return (
                        <label
                          key={candidate.id}
                          className={styles.managerOption}
                          data-selected={selected ? 'true' : 'false'}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleManager(candidate.id)}
                            disabled={isSubmitting}
                          />
                          <span className={styles.managerCopy}>
                            <strong>{getUserDisplayName(candidate)}</strong>
                            {secondary ? <span>{secondary}</span> : null}
                          </span>
                        </label>
                      );
                    })
                  ) : (
                    <div className={styles.emptyManagers}>По этому запросу никого не найдено.</div>
                  )}
                </div>
              </>
            ) : !isUsersLoading && !usersError ? (
              <div className={styles.notice}>Подходящие пользователи не найдены.</div>
            ) : null}

            <div className={styles.teamNote}>
              Сотрудники и их рабочие параметры добавляются после создания объекта.
            </div>
          </section>
        </aside>

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
