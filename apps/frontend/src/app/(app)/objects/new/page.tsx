'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function NewObjectPage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: '',
    internalName: '',
    address: '',
    status: 'active',
    seasonMode: '',
    dailyRate: '0',
    notes: '',
  });

  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [managerUserIds, setManagerUserIds] = useState<string[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;

  useEffect(() => {
    const loadUsers = async (): Promise<void> => {
      if (!allowCreateObject) {
        setUsers([]);
        setUsersError(null);
        setIsUsersLoading(false);
        return;
      }

      setIsUsersLoading(true);
      setUsersError(null);

      try {
        const response = await listSystemUsers({
          purpose: 'object_manager',
        });
        setUsers(response);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.message) {
          setUsersError(caughtError.message);
        } else {
          setUsersError('Не удалось загрузить пользователей системы.');
        }
      } finally {
        setIsUsersLoading(false);
      }
    };

    void loadUsers();
  }, [allowCreateObject]);

  const managerCandidates = useMemo(() => {
    return users.filter((candidate) => candidate.id !== user?.id);
  }, [users, user?.id]);

  const toggleManager = (userId: string): void => {
    setManagerUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((item) => item !== userId)
        : [...prev, userId],
    );
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!allowCreateObject) {
      setError('У вашей роли нет прав на создание объектов.');
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
        dailyRate: Number(form.dailyRate) || 0,
        notes: form.notes.trim() || undefined,
        managerUserIds,
      });

      router.push('/objects');
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.message) {
        setError(caughtError.message);
      } else {
        setError('Не удалось создать объект.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageTitle title="Создать объект" />

      <form
        className="page-card"
        onSubmit={handleSubmit}
        style={{ display: 'grid', gap: 16, maxWidth: 900 }}
      >
        <div style={{ fontWeight: 600, fontSize: 18 }}>Новый объект</div>

        <div className="page-muted">
          Создатель объекта автоматически становится ответственным.
          Сотрудники объекта здесь не назначаются — их потом добавляет менеджер в карточке объекта.
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

          <label>
            <div style={{ marginBottom: 6 }}>Статус</div>
            <select
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="active">Активный</option>
              <option value="frozen">Заморожен</option>
              <option value="archived">Архив</option>
            </select>
          </label>

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
            />
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

        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Менеджеры объекта</div>

          {isUsersLoading ? (
            <div className="page-muted">Загрузка пользователей...</div>
          ) : usersError ? (
            <div style={{ color: '#b91c1c' }}>{usersError}</div>
          ) : managerCandidates.length === 0 ? (
            <div className="page-muted">Подходящие пользователи не найдены.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {managerCandidates.map((candidate) => (
                <label
                  key={candidate.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    border: '1px solid #d1d5db',
                    borderRadius: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={managerUserIds.includes(candidate.id)}
                    onChange={() => toggleManager(candidate.id)}
                  />
                  <span>
                    {getUserDisplayName(candidate)}
                    {getUserSecondaryLabel(candidate) ? (
                      <span className="identity-secondary">
                        {getUserSecondaryLabel(candidate)}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" disabled={isSubmitting || !allowCreateObject}>
            {isSubmitting ? 'Создаем...' : 'Создать объект'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/objects')}
            disabled={isSubmitting}
          >
            Отмена
          </button>
        </div>
      </form>
    </>
  );
}
