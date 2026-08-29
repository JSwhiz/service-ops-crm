'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  listOneTimeOrderManagerReferences,
  listOneTimeOrderObjectReferences,
  listOneTimeOrderReviews,
  listOneTimeOrders,
  type OneTimeOrderSortField,
} from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListResponse, OneTimeOrderReviewListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import { OneTimeOrderListTable } from '@/features/one-time-order-list/ui/one-time-order-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { getOneTimeOrderStatusLabel, ONE_TIME_ORDER_STATUS_OPTIONS } from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';

const PAGE_LIMIT = 20;
const EMPTY_RESULT: OneTimeOrderListResponse = { items: [], page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 0 };
const EMPTY_REVIEWS: OneTimeOrderReviewListResponse = { items: [], page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 0 };
const SORT_FIELDS = new Set<OneTimeOrderSortField>(['title', 'executionStartDate', 'status', 'createdAt', 'updatedAt']);
const STATUS_OPTIONS: SearchableSelectOption[] = ONE_TIME_ORDER_STATUS_OPTIONS.map(({ value, label }) => ({ value, label }));

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSortBy(value: string | null): OneTimeOrderSortField {
  return value && SORT_FIELDS.has(value as OneTimeOrderSortField) ? value as OneTimeOrderSortField : 'updatedAt';
}

function formatDate(value: string | null): string {
  if (!value) return 'Не указана';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
}

export default function OneTimeOrdersPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const managerUserId = searchParams.get('managerUserId') ?? '';
  const linkedObjectId = searchParams.get('linkedObjectId') ?? '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const page = parsePage(searchParams.get('page'));
  const sortBy = parseSortBy(searchParams.get('sortBy'));
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
  const canAccess = user?.capabilities?.canAccessOneTimeOrders;
  const canViewReviews = user?.capabilities?.canViewAllOneTimeOrderReviews ?? false;
  const reviewOnly = canAccess === false && canViewReviews;
  const canCreate = user?.capabilities?.canCreateOneTimeOrder ?? false;
  const canViewCalendar = user?.capabilities?.canViewOneTimeOrderCalendar ?? false;
  const [searchInput, setSearchInput] = useState(query);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [reviews, setReviews] = useState(EMPTY_REVIEWS);
  const [selectedManager, setSelectedManager] = useState<SearchableSelectOption | null>(null);
  const [selectedObject, setSelectedObject] = useState<SearchableSelectOption | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  };

  useEffect(() => setSearchInput(query), [query]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = searchInput.trim();
      if (next !== query) replaceQuery({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, searchInput]);

  useEffect(() => {
    if (!managerUserId) return setSelectedManager(null);
    void listOneTimeOrderManagerReferences({ selectedId: managerUserId }).then(([item]) => setSelectedManager(item ? { value: item.id, label: item.fullName || item.login, searchText: item.login } : null)).catch(() => setSelectedManager(null));
  }, [managerUserId]);

  useEffect(() => {
    if (!linkedObjectId || reviewOnly) return setSelectedObject(null);
    void listOneTimeOrderObjectReferences({ selectedId: linkedObjectId }).then(([item]) => setSelectedObject(item ? { value: item.id, label: item.name } : null)).catch(() => setSelectedObject(null));
  }, [linkedObjectId, reviewOnly]);

  useEffect(() => {
    if (canAccess === false && !canViewReviews) return setIsLoading(false);
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const request = reviewOnly
      ? listOneTimeOrderReviews({ q: query || undefined, status: status || undefined, managerUserId: managerUserId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit: PAGE_LIMIT }).then(setReviews)
      : listOneTimeOrders({ q: query || undefined, status: status || undefined, managerUserId: managerUserId || undefined, linkedObjectId: linkedObjectId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit: PAGE_LIMIT, sortBy, sortDirection }).then(setResult);
    void request.catch(() => { if (!cancelled) setError(reviewOnly ? 'Не удалось загрузить отзывы.' : 'Не удалось загрузить разовые заказы.'); }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [canAccess, canViewReviews, dateFrom, dateTo, linkedObjectId, managerUserId, page, query, reviewOnly, sortBy, sortDirection, status]);

  const total = reviewOnly ? reviews.total : result.total;
  const totalPages = reviewOnly ? reviews.totalPages : result.totalPages;
  const currentPage = reviewOnly ? reviews.page : result.page;

  if (canAccess === false && !canViewReviews) {
    return <><PageTitle title="Разовые заказы" /><div className="page-card">У вас нет доступа к модулю разовых заказов.</div></>;
  }

  return <div className="page-stack">
    <PageTitle title={reviewOnly ? 'Отзывы по разовым заказам' : 'Разовые заказы'} />
    <div className="page-card section-header"><div><div className="section-title">{reviewOnly ? 'Реестр отзывов' : 'Реестр разовых заказов'}</div><div className="page-muted">Доступно: {total}</div></div>
      {!reviewOnly ? <div className="action-row">{canViewCalendar ? <Link className="button-link" href="/one-time-orders/calendar">Календарь</Link> : null}{canCreate ? <Link className="button-link" href="/one-time-orders/new">Создать заказ</Link> : null}</div> : null}
    </div>
    <div className="page-card one-time-order-registry-filters">
      <label><span>Поиск</span><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={reviewOnly ? 'Заказ, менеджер или текст отзыва' : 'Заказ, адрес, контакт, объект, менеджер, отзыв'} /></label>
      <SearchableSelect label="Статус" value={status} options={STATUS_OPTIONS} onChange={(value) => replaceQuery({ status: value || null, page: null })} placeholder="Все статусы" />
      <SearchableSelect label="Менеджер" value={managerUserId} options={[]} selectedOption={selectedManager} onChange={(value) => replaceQuery({ managerUserId: value || null, page: null })} placeholder="Все менеджеры" asyncSearch={async (search) => (await listOneTimeOrderManagerReferences({ search })).map((item) => ({ value: item.id, label: item.fullName || item.login, searchText: item.login }))} />
      {!reviewOnly ? <SearchableSelect label="Объект" value={linkedObjectId} options={[]} selectedOption={selectedObject} onChange={(value) => replaceQuery({ linkedObjectId: value || null, page: null })} placeholder="Все объекты" asyncSearch={async (search) => (await listOneTimeOrderObjectReferences({ search })).map((item) => ({ value: item.id, label: item.name }))} /> : null}
      <label><span>Период с</span><input type="date" value={dateFrom} onChange={(event) => replaceQuery({ dateFrom: event.target.value || null, page: null })} /></label>
      <label><span>Период по</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => replaceQuery({ dateTo: event.target.value || null, page: null })} /></label>
      <button type="button" onClick={() => { setSearchInput(''); router.replace(pathname, { scroll: false }); }}>Сбросить</button>
    </div>
    {isLoading ? <div className="page-card">Загрузка...</div> : error ? <div className="page-card" style={{ color: '#b91c1c' }}>{error}</div> : reviewOnly ? <ReviewTable reviews={reviews} /> : <OneTimeOrderListTable items={result.items} sortBy={sortBy} sortDirection={sortDirection} onSort={(field) => replaceQuery({ sortBy: field, sortDirection: field === sortBy ? (sortDirection === 'asc' ? 'desc' : 'asc') : field === 'title' ? 'asc' : 'desc', page: null })} />}
    {!isLoading && totalPages > 1 ? <div className="object-registry-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => replaceQuery({ page: String(currentPage - 1) })}>Назад</button><span>Страница {currentPage} из {totalPages}</span><button type="button" disabled={currentPage >= totalPages} onClick={() => replaceQuery({ page: String(currentPage + 1) })}>Далее</button></div> : null}
  </div>;
}

function ReviewTable({ reviews }: { reviews: OneTimeOrderReviewListResponse }): React.JSX.Element {
  return <div className="page-card table-scroll"><table className="data-table"><thead><tr><th>Заказ</th><th>Период</th><th>Статус</th><th>Менеджеры</th><th>Оценка</th><th>Отзыв</th></tr></thead><tbody>
    {reviews.items.length === 0 ? <tr><td colSpan={6} className="page-muted">Отзывы не найдены.</td></tr> : reviews.items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{formatDate(item.executionStartDate)} – {formatDate(item.executionEndDate)}</td><td>{getOneTimeOrderStatusLabel(item.status)}</td><td>{item.managers.map((manager) => manager.fullName || manager.login).join(', ') || 'Не назначены'}</td><td>{item.reviewRating ?? '—'}</td><td>{item.reviewText ?? '—'}</td></tr>)}
  </tbody></table></div>;
}
