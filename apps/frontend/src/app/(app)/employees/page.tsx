'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  listEmployeeObjectCandidates,
  listEmployees,
} from '@/entities/employee/api/employee-client';
import type {
  EmployeeArchiveState,
  EmployeeListResponse,
  EmployeeObjectOption,
  EmployeeSortField,
} from '@/entities/employee/model/employee.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const PAGE_LIMIT = 25;
const SORT_FIELDS = new Set<EmployeeSortField>([
  'fullName',
  'position',
  'employmentStatus',
  'birthDate',
  'createdAt',
  'updatedAt',
]);

const EMPTY_RESULT: EmployeeListResponse = {
  items: [],
  page: 1,
  limit: PAGE_LIMIT,
  total: 0,
  totalPages: 0,
};

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseBirthMonth(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
    ? parsed
    : undefined;
}

function parseArchiveState(value: string | null): EmployeeArchiveState {
  return value === 'archived' || value === 'all' ? value : 'active';
}

function parseSortField(value: string | null): EmployeeSortField {
  return value && SORT_FIELDS.has(value as EmployeeSortField)
    ? (value as EmployeeSortField)
    : 'fullName';
}

function getEmploymentStatusLabel(status: string): string {
  return status === 'active' ? 'Работает' : status === 'inactive' ? 'Неактивен' : status;
}

function formatDateOnly(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось загрузить реестр сотрудников.';
}

export default function EmployeesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;
  const canManageEmployeesHr = user?.capabilities?.canManageEmployeesHr ?? false;

  const querySearch = searchParams.get('search') ?? '';
  const objectId = searchParams.get('objectId') ?? '';
  const position = searchParams.get('position') ?? '';
  const employmentStatus = searchParams.get('employmentStatus') ?? '';
  const archiveState = parseArchiveState(searchParams.get('archiveState'));
  const birthMonth = parseBirthMonth(searchParams.get('birthMonth'));
  const assignmentFilter = searchParams.get('assignment') ?? '';
  const sortBy = parseSortField(searchParams.get('sortBy'));
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const page = parsePage(searchParams.get('page'));

  const [searchInput, setSearchInput] = useState(querySearch);
  const [positionInput, setPositionInput] = useState(position);
  const [result, setResult] = useState<EmployeeListResponse>(EMPTY_RESULT);
  const [objects, setObjects] = useState<EmployeeObjectOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  };

  useEffect(() => setSearchInput(querySearch), [querySearch]);
  useEffect(() => setPositionInput(position), [position]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      const nextPosition = positionInput.trim();

      if (nextSearch === querySearch && nextPosition === position) return;

      const next = new URLSearchParams(searchParams.toString());
      if (nextSearch) next.set('search', nextSearch);
      else next.delete('search');
      if (nextPosition) next.set('position', nextPosition);
      else next.delete('position');
      next.delete('page');
      const serialized = next.toString();
      router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
        scroll: false,
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    pathname,
    position,
    positionInput,
    querySearch,
    router,
    searchInput,
    searchParams,
  ]);

  useEffect(() => {
    if (!canManageEmployeesHr) {
      setObjects([]);
      return;
    }

    let cancelled = false;
    void listEmployeeObjectCandidates()
      .then((items) => {
        if (!cancelled) setObjects(items);
      })
      .catch(() => {
        if (!cancelled) setObjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageEmployeesHr]);

  useEffect(() => {
    if (!canAccessEmployeesHr) {
      setResult(EMPTY_RESULT);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listEmployees({
          search: querySearch || undefined,
          objectId: objectId || undefined,
          position: position || undefined,
          employmentStatus: employmentStatus || undefined,
          archiveState,
          birthMonth,
          hasActiveObjectAssignment:
            assignmentFilter === 'assigned'
              ? true
              : assignmentFilter === 'unassigned'
                ? false
                : undefined,
          sortBy,
          sortOrder,
          page,
          limit: PAGE_LIMIT,
        });
        if (!cancelled) setResult(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    archiveState,
    assignmentFilter,
    birthMonth,
    canAccessEmployeesHr,
    employmentStatus,
    objectId,
    page,
    position,
    querySearch,
    sortBy,
    sortOrder,
  ]);

  return (
    <>
      <PageTitle title="Сотрудники" />

      {!canAccessEmployeesHr ? (
        <div className="page-card" style={{ color: 'var(--danger)' }}>
          У вас нет доступа к HR-контуру сотрудников.
        </div>
      ) : (
        <div className="page-stack">
          <section className="page-card section-header">
            <div>
              <div className="section-title">Реестр сотрудников</div>
              <div className="section-subtitle">Найдено: {result.total}</div>
            </div>
            {canManageEmployeesHr ? (
              <Link className="button-link" href="/employees/new">
                Создать сотрудника
              </Link>
            ) : null}
          </section>

          <section className="page-card" style={{ display: 'grid', gap: 14 }}>
            <div className="employee-filter-grid">
              <label>
                <span className="detail-label">Поиск</span>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="ФИО или телефон"
                />
              </label>
              <label>
                <span className="detail-label">Объект</span>
                <select
                  value={objectId}
                  onChange={(event) =>
                    replaceQuery({ objectId: event.target.value || null, page: null })
                  }
                >
                  <option value="">Все объекты</option>
                  {objects.map((object) => (
                    <option key={object.id} value={object.id}>
                      {object.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="detail-label">Должность</span>
                <input
                  value={positionInput}
                  onChange={(event) => setPositionInput(event.target.value)}
                  placeholder="Точное название"
                />
              </label>
              <label>
                <span className="detail-label">Статус работы</span>
                <select
                  value={employmentStatus}
                  onChange={(event) =>
                    replaceQuery({
                      employmentStatus: event.target.value || null,
                      page: null,
                    })
                  }
                >
                  <option value="">Все статусы</option>
                  <option value="active">Работает</option>
                  <option value="inactive">Неактивен</option>
                </select>
              </label>
              <label>
                <span className="detail-label">Карточки</span>
                <select
                  value={archiveState}
                  onChange={(event) =>
                    replaceQuery({
                      archiveState:
                        event.target.value === 'active' ? null : event.target.value,
                      page: null,
                    })
                  }
                >
                  <option value="active">Активные</option>
                  <option value="archived">Архивные</option>
                  <option value="all">Все</option>
                </select>
              </label>
              <label>
                <span className="detail-label">Месяц рождения</span>
                <select
                  value={birthMonth ?? ''}
                  onChange={(event) =>
                    replaceQuery({ birthMonth: event.target.value || null, page: null })
                  }
                >
                  <option value="">Любой</option>
                  {[
                    'Январь',
                    'Февраль',
                    'Март',
                    'Апрель',
                    'Май',
                    'Июнь',
                    'Июль',
                    'Август',
                    'Сентябрь',
                    'Октябрь',
                    'Ноябрь',
                    'Декабрь',
                  ].map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="detail-label">Назначение</span>
                <select
                  value={assignmentFilter}
                  onChange={(event) =>
                    replaceQuery({ assignment: event.target.value || null, page: null })
                  }
                >
                  <option value="">Любое</option>
                  <option value="assigned">Назначен на объект</option>
                  <option value="unassigned">Без активного объекта</option>
                </select>
              </label>
              <label>
                <span className="detail-label">Сортировка</span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    replaceQuery({ sortBy: event.target.value, page: null })
                  }
                >
                  <option value="fullName">ФИО</option>
                  <option value="position">Должность</option>
                  <option value="employmentStatus">Статус работы</option>
                  <option value="birthDate">Дата рождения</option>
                  <option value="createdAt">Дата создания</option>
                  <option value="updatedAt">Дата изменения</option>
                </select>
              </label>
              <label>
                <span className="detail-label">Порядок</span>
                <select
                  value={sortOrder}
                  onChange={(event) =>
                    replaceQuery({
                      sortOrder: event.target.value === 'asc' ? null : 'desc',
                      page: null,
                    })
                  }
                >
                  <option value="asc">По возрастанию</option>
                  <option value="desc">По убыванию</option>
                </select>
              </label>
            </div>
            <div className="action-row">
              <button
                type="button"
                className="button-secondary"
                onClick={() => router.replace(pathname, { scroll: false })}
              >
                Сбросить фильтры
              </button>
            </div>
          </section>

          {isLoading ? (
            <div className="page-card" aria-live="polite">
              Загрузка сотрудников...
            </div>
          ) : error ? (
            <div className="page-card" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          ) : result.items.length === 0 ? (
            <div className="page-card">По выбранным фильтрам сотрудники не найдены.</div>
          ) : (
            <div className="page-card employee-table-wrap">
              <table className="employee-registry-table">
                <thead>
                  <tr>
                    <th>ФИО</th>
                    <th>Телефон</th>
                    <th>Должность</th>
                    <th>Статус работы</th>
                    <th>Дата рождения</th>
                    <th>Текущие объекты</th>
                    <th>Карточка</th>
                    <th>Изменена</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/employees/${item.id}`}>{item.fullName}</Link>
                      </td>
                      <td>{item.phone ?? '—'}</td>
                      <td>{item.position ?? '—'}</td>
                      <td>{getEmploymentStatusLabel(item.employmentStatus)}</td>
                      <td>{formatDateOnly(item.birthDate)}</td>
                      <td>
                        {item.currentObjects.length > 0
                          ? item.currentObjects.map((object) => object.name).join(', ')
                          : '—'}
                      </td>
                      <td>
                        <span
                          className={`employee-state-badge ${
                            item.isArchived ? 'is-archived' : 'is-active'
                          }`}
                        >
                          {item.isArchived ? 'Архив' : 'Активна'}
                        </span>
                      </td>
                      <td>{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.totalPages > 1 ? (
            <div className="page-card pagination-row">
              <button
                type="button"
                className="button-secondary"
                disabled={result.page <= 1 || isLoading}
                onClick={() =>
                  replaceQuery({ page: String(Math.max(1, result.page - 1)) })
                }
              >
                Назад
              </button>
              <span className="page-muted">
                Страница {result.page} из {result.totalPages}
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={result.page >= result.totalPages || isLoading}
                onClick={() =>
                  replaceQuery({
                    page: String(Math.min(result.totalPages, result.page + 1)),
                  })
                }
              >
                Далее
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
