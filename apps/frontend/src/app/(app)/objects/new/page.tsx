'use client';

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
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { UserSearchSelect } from '@/shared/ui/user-search-select/user-search-select';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';

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
      <PageTitle title="Создать объект" />

      <form className={styles.surface} onSubmit={handleSubmit}>
        <div>
          <h1 className={styles.title}>Новый объект</h1>
          <p className={styles.description}>
            Основные данные объекта, ответственный и стартовая команда менеджеров.
            Сотрудники объекта добавляются отдельно в карточке после создания.
          </p>
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

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Статус</span>
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
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
            >
              <option value="monthly">Фиксированная ЗП за месяц</option>
              <option value="daily">Дневная ставка за выход</option>
            </select>
          </label>

          {form.paymentType === 'monthly' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>ЗП за месяц</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.monthlySalary}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, monthlySalary: event.target.value }))
                }
              />
              <span className={styles.inlineHelp}>
                За полный отработанный месяц начисляется вся сумма. Неполный месяц
                рассчитывается пропорционально фактическим выходам.
              </span>
            </label>
          ) : (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Дневная ставка</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.dailyRate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, dailyRate: event.target.value }))
                }
              />
              <span className={styles.inlineHelp}>
                Каждый отмеченный выход в табеле оплачивается по этой ставке.
              </span>
            </label>
          )}

          <label className={`${styles.field} ${styles.fullWidth}`}>
            <span className={styles.fieldLabel}>Комментарий</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </label>
        </div>

        <div className={styles.field}>
          {isUsersLoading ? (
            <div className={styles.notice}>Загрузка пользователей...</div>
          ) : usersError ? (
            <div className={styles.error}>{usersError}</div>
          ) : (
            <UserSearchSelect
              label="Ответственный"
              options={responsibleCandidates}
              value={responsibleUserId}
              onChange={setResponsibleUserId}
              disabled={isSubmitting}
              required
            />
          )}
        </div>

        <section className={styles.field}>
          <span className={styles.fieldLabel}>Менеджеры объекта</span>
          {isUsersLoading ? (
            <div className={styles.notice}>Загрузка пользователей...</div>
          ) : usersError ? (
            <div className={styles.error}>{usersError}</div>
          ) : managerCandidates.length === 0 ? (
            <div className={styles.notice}>Подходящие пользователи не найдены.</div>
          ) : (
            <div className={styles.managerList}>
              {managerCandidates.map((candidate) => (
                <label key={candidate.id} className={styles.optionRow}>
                  <input
                    type="checkbox"
                    checked={managerUserIds.includes(candidate.id)}
                    onChange={() => toggleManager(candidate.id)}
                  />
                  <span>
                    {getUserDisplayName(candidate)}
                    {getUserSecondaryLabel(candidate) ? (
                      <span className="identity-secondary">{getUserSecondaryLabel(candidate)}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.actions}>
          <button
            type="submit"
            disabled={isSubmitting || isUsersLoading || !allowCreateObject || !responsibleUserId}
          >
            {isSubmitting ? 'Создаем...' : 'Создать объект'}
          </button>
          <button type="button" onClick={() => router.push('/objects')} disabled={isSubmitting}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
