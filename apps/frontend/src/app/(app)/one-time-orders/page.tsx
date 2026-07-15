'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  listOneTimeOrders,
  type OneTimeOrderSortField,
} from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { OneTimeOrderListTable } from '@/features/one-time-order-list/ui/one-time-order-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { ONE_TIME_ORDER_STATUS_OPTIONS } from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const PAGE_LIMIT = 20;
const EMPTY_RESULT: OneTimeOrderListResponse = {
  items: [],
  page: 1,
  limit: PAGE_LIMIT,
  total: 0,
  totalPages: 0,
};
const SORT_FIELDS = new Set<OneTimeOrderSortField>([
  'title',
  'executionStartDate',
  'status',
  'createdAt',
  'updatedAt',
]);

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSortBy(value: string | null): OneTimeOrderSortField {
  return value && SORT_FIELDS.has(value as OneTimeOrderSortField)
    ? (value as OneTimeOrderSortField)
    : 'updatedAt';
}

export default function OneTimeOrdersPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const managerUserId = searchParams.get('managerUserId') ?? '';
  const linkedObjectId = searchParams.get('linkedObjectId') ?? '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const page = parsePage(searchParams.get('page'));
  const sortBy = parseSortBy(searchParams.get('sortBy'));
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
  const canAccessOneTimeOrders = user?.capabilities?.canAccessOneTimeOrders;
  const canCreateOneTimeOrder =
    user?.capabilities?.canCreateOneTimeOrder ?? false;
  const canViewCalendar =
    user?.capabilities?.canViewOneTimeOrderCalendar ?? false;
  const [searchInput, setSearchInput] = useState(query);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [managers, setManagers] = useState<SystemUserOption[]>([]);
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

  useEffect(() => setSearchInput(query), [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchInput.trim();
      if (nextQuery !== query) {
        replaceQuery({ q: nextQuery || null, page: null });
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, searchInput]);

  useEffect(() => {
    if (canAccessOneTimeOrders === false) return;
    void Promise.all([
      listObjects(),
      listSystemUsers({ purpose: 'one_time_order_manager' }),
    ])
      .then(([nextObjects, nextManagers]) => {
        setObjects(nextObjects);
        setManagers(nextManagers);
      })
      .catch(() => undefined);
  }, [canAccessOneTimeOrders]);

  useEffect(() => {
    if (canAccessOneTimeOrders === false) {
      setResult(EMPTY_RESULT);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listOneTimeOrders({
      q: query || undefined,
      status: status || undefined,
      managerUserId: managerUserId || undefined,
      linkedObjectId: linkedObjectId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      limit: PAGE_LIMIT,
      sortBy,
      sortDirection,
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить разовые заказы.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    canAccessOneTimeOrders,
    dateFrom,
    dateTo,
    linkedObjectId,
    managerUserId,
    page,
    query,
    queryKey,
    sortBy,
    sortDirection,
    status,
  ]);

  const handleSort = (field: OneTimeOrderSortField): void => {
    replaceQuery({
      sortBy: field,
      sortDirection:
        field === sortBy
          ? sortDirection === 'asc'
            ? 'desc'
            : 'asc'
          : field === 'title'
            ? 'asc'
            : 'desc',
      page: null,
    });
  };

  if (canAccessOneTimeOrders === false) {
    return (
      <>
        <PageTitle title="Разовые заказы" />
        <div className="page-card">У вас нет доступа к модулю разовых заказов.</div>
      </>
    );
  }

  return (
    <div className="page-stack">
      <PageTitle title="Разовые заказы" />

      <div className="page-card section-header">
        <div>
          <div className="section-title">Реестр разовых заказов</div>
          <div className="page-muted">Доступно: {result.total}</div>
        </div>
        <div className="action-row">
          {canViewCalendar ? (
            <Link className="button-link" href="/one-time-orders/calendar">
              Календарь
            </Link>
          ) : null}
          {canCreateOneTimeOrder ? (
            <Link className="button-link" href="/one-time-orders/new">
              Создать заказ
            </Link>
          ) : null}
        </div>
      </div>

      <div className="page-card one-time-order-registry-filters">
        <label>
          <span>Поиск</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Заказ, адрес, контакт, объект, менеджер, отзыв"
          />
        </label>
        <label>
          <span>Статус</span>
          <select
            value={status}
            onChange={(event) =>
              replaceQuery({ status: event.target.value || null, page: null })
            }
          >
            <option value="">Все статусы</option>
            {ONE_TIME_ORDER_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Менеджер</span>
          <select
            value={managerUserId}
            onChange={(event) =>
              replaceQuery({
                managerUserId: event.target.value || null,
                page: null,
              })
            }
          >
            <option value="">Все менеджеры</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {getUserDisplayName(manager)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Объект</span>
          <select
            value={linkedObjectId}
            onChange={(event) =>
              replaceQuery({
                linkedObjectId: event.target.value || null,
                page: null,
              })
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
          <span>Период с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) =>
              replaceQuery({ dateFrom: event.target.value || null, page: null })
            }
          />
        </label>
        <label>
          <span>Период по</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) =>
              replaceQuery({ dateTo: event.target.value || null, page: null })
            }
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setSearchInput('');
            router.replace(pathname, { scroll: false });
          }}
        >
          Сбросить
        </button>
      </div>

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <OneTimeOrderListTable
          items={result.items}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={handleSort}
        />
      )}

      {!isLoading && result.totalPages > 1 ? (
        <div className="object-registry-pagination">
          <button
            type="button"
            disabled={result.page <= 1}
            onClick={() => replaceQuery({ page: String(result.page - 1) })}
          >
            Назад
          </button>
          <span>
            Страница {result.page} из {result.totalPages}
          </span>
          <button
            type="button"
            disabled={result.page >= result.totalPages}
            onClick={() => replaceQuery({ page: String(result.page + 1) })}
          >
            Далее
          </button>
        </div>
      ) : null}
    </div>
  );
}
