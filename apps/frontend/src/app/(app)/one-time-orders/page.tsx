'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

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
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import type { ActiveRegistryFilter, AvailableRegistryFilter } from '@/shared/ui/registry-filters/registry-toolbar';
import styles from './one-time-order-registry.module.css';

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
  const rawReviewStatus = searchParams.get('reviewStatus');
  const reviewStatus =
    rawReviewStatus === 'missing' || rawReviewStatus === 'present'
      ? rawReviewStatus
      : '';
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
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set([
    ...(status ? ['status'] : []),
    ...(managerUserId ? ['manager'] : []),
    ...(linkedObjectId ? ['object'] : []),
    ...(dateFrom || dateTo ? ['period'] : []),
    ...(reviewStatus ? ['review'] : []),
  ]));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

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
    const requestSequence = ++requestSequenceRef.current;
    if (canAccess === false && !canViewReviews) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const request = reviewOnly
      ? listOneTimeOrderReviews({ q: query || undefined, status: status || undefined, managerUserId: managerUserId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit: PAGE_LIMIT }).then((next) => {
          if (requestSequenceRef.current === requestSequence) setReviews(next);
        })
      : listOneTimeOrders({ q: query || undefined, status: status || undefined, managerUserId: managerUserId || undefined, linkedObjectId: linkedObjectId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, reviewStatus: reviewStatus || undefined, page, limit: PAGE_LIMIT, sortBy, sortDirection }).then((next) => {
          if (requestSequenceRef.current === requestSequence) setResult(next);
        });
    void request.catch(() => {
      if (requestSequenceRef.current === requestSequence) setError(reviewOnly ? 'Не удалось загрузить отзывы.' : 'Не удалось загрузить разовые заказы.');
    }).finally(() => {
      if (requestSequenceRef.current === requestSequence) setIsLoading(false);
    });
  }, [canAccess, canViewReviews, dateFrom, dateTo, linkedObjectId, managerUserId, page, query, reviewOnly, reviewStatus, sortBy, sortDirection, status]);

  const total = reviewOnly ? reviews.total : result.total;
  const totalPages = reviewOnly ? reviews.totalPages : result.totalPages;
  const currentPage = reviewOnly ? reviews.page : result.page;

  useEffect(() => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (status) next.add('status');
      if (managerUserId) next.add('manager');
      if (linkedObjectId) next.add('object');
      if (dateFrom || dateTo) next.add('period');
      if (reviewStatus) next.add('review');
      return next;
    });
  }, [dateFrom, dateTo, linkedObjectId, managerUserId, reviewStatus, status]);

  const activateFilter = (key: string): void => {
    setActiveFilters((current) => new Set(current).add(key));
  };
  const removeFilter = (key: string): void => {
    setActiveFilters((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    const updates: Record<string, string | null> = { page: null };
    if (key === 'status') updates.status = null;
    if (key === 'manager') { updates.managerUserId = null; setSelectedManager(null); }
    if (key === 'object') { updates.linkedObjectId = null; setSelectedObject(null); }
    if (key === 'period') { updates.dateFrom = null; updates.dateTo = null; }
    if (key === 'review') updates.reviewStatus = null;
    replaceQuery(updates);
  };

  if (canAccess === false && !canViewReviews) {
    return <><PageTitle title="Разовые заказы" /><div className="page-card">У вас нет доступа к модулю разовых заказов.</div></>;
  }

  const registryFilters: ActiveRegistryFilter[] = [
    activeFilters.has('status') ? { id: 'status', label: 'Статус', value: status || '__all', options: [{ value: '__all', label: 'Все статусы' }, ...STATUS_OPTIONS], onChange: (value: string) => replaceQuery({ status: value === '__all' ? null : value, page: null }), onRemove: () => removeFilter('status') } : null,
    activeFilters.has('manager') ? { id: 'manager', label: 'Менеджер', value: managerUserId, options: selectedManager ? [{ value: managerUserId, label: selectedManager.label }] : [], onChange: (value: string) => replaceQuery({ managerUserId: value || null, page: null }), onRemove: () => removeFilter('manager'), customControl: <SearchableSelect label="Менеджер" hideLabel value={managerUserId} options={[]} selectedOption={selectedManager} onChange={(value) => replaceQuery({ managerUserId: value || null, page: null })} placeholder="Все менеджеры" minimumSearchLength={2} searchPlaceholder="Введите ФИО или логин" searchPromptText="Введите не менее 2 символов, чтобы найти менеджера" searchInputVariant="registry" asyncSearch={async (search) => (await listOneTimeOrderManagerReferences({ search })).map((item) => ({ value: item.id, label: item.fullName || item.login, searchText: item.login }))} /> } : null,
    !reviewOnly && activeFilters.has('object') ? { id: 'object', label: 'Объект', value: linkedObjectId, options: selectedObject ? [{ value: linkedObjectId, label: selectedObject.label }] : [], onChange: (value: string) => replaceQuery({ linkedObjectId: value || null, page: null }), onRemove: () => removeFilter('object'), customControl: <SearchableSelect label="Объект" hideLabel value={linkedObjectId} options={[]} selectedOption={selectedObject} onChange={(value) => replaceQuery({ linkedObjectId: value || null, page: null })} placeholder="Все объекты" minimumSearchLength={2} searchPlaceholder="Введите название объекта" searchPromptText="Введите не менее 2 символов, чтобы найти объект" searchInputVariant="registry" asyncSearch={async (search) => (await listOneTimeOrderObjectReferences({ search })).map((item) => ({ value: item.id, label: item.name }))} /> } : null,
    !reviewOnly && canViewReviews && activeFilters.has('review') ? { id: 'review', label: 'Отзывы', value: reviewStatus || '__all', options: [{ value: '__all', label: 'Все отзывы' }, { value: 'missing', label: 'Требуют отзыва' }, { value: 'present', label: 'С отзывом' }], onChange: (value: string) => replaceQuery({ reviewStatus: value === '__all' ? null : value, page: null }), onRemove: () => removeFilter('review') } : null,
    activeFilters.has('period') ? { id: 'period', label: 'Период', value: dateFrom || dateTo ? `${dateFrom || '…'} — ${dateTo || '…'}` : 'Любые даты', options: [], onChange: () => undefined, onRemove: () => removeFilter('period'), customControl: <div className="registry-date-range"><input aria-label="Дата с" type="date" max={dateTo || undefined} value={dateFrom} onChange={(event) => replaceQuery({ dateFrom: event.target.value || null, page: null })} /><span>—</span><input aria-label="Дата по" type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => replaceQuery({ dateTo: event.target.value || null, page: null })} /></div> } : null,
  ].filter(Boolean) as ActiveRegistryFilter[];
  const availableRegistryFilters: AvailableRegistryFilter[] = [
    !activeFilters.has('status') ? { id: 'status', label: 'Статус', options: STATUS_OPTIONS, onAdd: (value: string) => { replaceQuery({ status: value, page: null }); activateFilter('status'); } } : null,
    !activeFilters.has('manager') ? { id: 'manager', label: 'Менеджер', options: [{ value: 'manager', label: 'Выбрать менеджера' }], onAdd: () => activateFilter('manager') } : null,
    !reviewOnly && !activeFilters.has('object') ? { id: 'object', label: 'Объект', options: [{ value: 'object', label: 'Выбрать объект' }], onAdd: () => activateFilter('object') } : null,
    !reviewOnly && canViewReviews && !activeFilters.has('review') ? { id: 'review', label: 'Отзывы', options: [{ value: 'missing', label: 'Требуют отзыва' }, { value: 'present', label: 'С отзывом' }], onAdd: (value: string) => { replaceQuery({ reviewStatus: value, page: null }); activateFilter('review'); } } : null,
    !activeFilters.has('period') ? { id: 'period', label: 'Период', options: [{ value: 'period', label: 'Выбрать даты' }], onAdd: () => activateFilter('period') } : null,
  ].filter(Boolean) as AvailableRegistryFilter[];

  return <div className="page-stack workspace-page one-time-order-registry">
    <PageTitle title={reviewOnly ? 'Отзывы по разовым заказам' : 'Разовые заказы'} />
    <RegistryToolbar searchValue={searchInput} searchLabel="Поиск по разовым заказам" searchPlaceholder={reviewOnly ? 'Заказ, менеджер или текст отзыва' : 'Заказ, адрес, контакт, объект, менеджер, отзыв'} onSearchChange={setSearchInput} activeFilters={registryFilters} availableFilters={reviewOnly ? availableRegistryFilters.filter((filter) => filter.id === 'status' || filter.id === 'manager' || filter.id === 'period') : availableRegistryFilters} actions={!reviewOnly ? <>{canViewCalendar ? <Link className={styles.secondaryButton} href="/one-time-orders/calendar"><CalendarIcon />Календарь</Link> : null}{canCreate ? <Link className={styles.createButton} href="/one-time-orders/new"><PlusIcon />Создать заказ</Link> : null}</> : null} />
    <div className={styles.resultCount}>{reviewOnly ? 'Отзывы' : 'Разовые заказы'} · Доступно: {total}</div>
    {isLoading ? <div className="page-card workspace-surface workspace-empty">Загрузка...</div> : error ? <div className="page-card workspace-surface inline-notice inline-notice--warning">{error}</div> : reviewOnly ? <ReviewTable reviews={reviews} /> : <OneTimeOrderListTable items={result.items} sortBy={sortBy} sortDirection={sortDirection} onSort={(field) => replaceQuery({ sortBy: field, sortDirection: field === sortBy ? (sortDirection === 'asc' ? 'desc' : 'asc') : field === 'title' ? 'asc' : 'desc', page: null })} />}
    {!isLoading && totalPages > 1 ? <div className="page-card workspace-surface object-registry-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => replaceQuery({ page: String(currentPage - 1) })}>Назад</button><span>Страница {currentPage} из {totalPages}</span><button type="button" disabled={currentPage >= totalPages} onClick={() => replaceQuery({ page: String(currentPage + 1) })}>Далее</button></div> : null}
  </div>;
}

function ReviewTable({ reviews }: { reviews: OneTimeOrderReviewListResponse }): React.JSX.Element {
  return <div className="page-card workspace-surface data-table-shell table-scroll"><table className="data-table"><thead><tr><th>Заказ</th><th>Период</th><th>Статус</th><th>Менеджеры</th><th>Отзыв</th></tr></thead><tbody>
    {reviews.items.length === 0 ? <tr><td colSpan={5} className="page-muted">Отзывы не найдены.</td></tr> : reviews.items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{formatDate(item.executionStartDate)} – {formatDate(item.executionEndDate)}</td><td>{getOneTimeOrderStatusLabel(item.status)}</td><td>{item.managers.map((manager) => manager.fullName || manager.login).join(', ') || 'Не назначены'}</td><td className={styles.reviewText} title={item.reviewText ?? undefined}>{item.reviewText ?? '—'}</td></tr>)}
  </tbody></table></div>;
}

function PlusIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
function CalendarIcon(): React.JSX.Element { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>; }
