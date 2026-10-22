'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCounterparties } from '@/entities/counterparty/api/counterparty-client';
import type {
  CounterpartyListResponse,
} from '@/entities/counterparty/model/counterparty.types';
import { useAuth } from '@/shared/auth/use-auth';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';

import styles from './counterparties.module.css';
import { Alert, ButtonLink, EmptyState, LoadingState, StatusBadge } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';

const EMPTY: CounterpartyListResponse = {
  items: [],
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,
};

const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});

const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const STATUS_OPTIONS = [
  { value: 'active', label: 'Активные' },
  { value: 'archived', label: 'Архив' },
];

export default function CounterpartiesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sequenceRef = useRef(0);

  const q = searchParams.get('q') ?? '';
  const status =
    (searchParams.get('status') as 'active' | 'archived' | 'all' | null) ??
    'all';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(25);

  const [search, setSearch] = useState(q);
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canAccess = user?.capabilities?.canAccessCounterparties ?? false;
  const canManage = user?.capabilities?.canManageCounterparties ?? false;

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(next.size ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  };

  useEffect(() => setSearch(q), [q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = search.trim();
      if (value !== q) replaceQuery({ q: value || null, page: null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, search]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    const sequence = ++sequenceRef.current;
    setLoading(true);
    setError(null);
    void listCounterparties({
      q: q || undefined,
      status,
      page,
      limit: pageSize,
    })
      .then((next) => {
        if (sequence === sequenceRef.current) setResult(next);
      })
      .catch((caughtError) => {
        if (sequence === sequenceRef.current) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Не удалось загрузить контрагентов.',
          );
        }
      })
      .finally(() => {
        if (sequence === sequenceRef.current) setLoading(false);
      });
  }, [canAccess, page, pageSize, q, status]);

  if (!canAccess) {
    return (
      <div className={`workspace-page counterparty-workspace ${styles.page}`}>
        <EmptyState title="Нет доступа" description="У вас нет доступа к контрагентам." />
      </div>
    );
  }

  return (
    <div className={`workspace-page counterparty-workspace ${styles.page}`}>
      <RegistryToolbar
        searchValue={search}
        searchLabel="Поиск контрагентов"
        searchPlaceholder="Название, юр. название или контакт"
        onSearchChange={setSearch}
        activeFilters={status !== 'all' ? [{
          id: 'status',
          label: 'Статус',
          value: status,
          options: STATUS_OPTIONS,
          onChange: (value) => replaceQuery({ status: value || null, page: null }),
          onRemove: () => replaceQuery({ status: null, page: null }),
        }] : []}
        availableFilters={status === 'all' ? [{
          id: 'status',
          label: 'Статус',
          options: STATUS_OPTIONS,
          onAdd: (value) => replaceQuery({ status: value, page: null }),
        }] : []}
        actions={canManage ? (
          <ButtonLink variant="primary" icon={<PlusIcon />} href="/counterparties/new">
            Создать контрагента
          </ButtonLink>
        ) : null}
      />

      {loading ? (
        <LoadingState label="Загружаем контрагентов…" />
      ) : error ? (
        <Alert tone="danger" role="alert">{error}</Alert>
      ) : result.items.length === 0 ? (
        <EmptyState
          title={q || status !== 'all' ? 'Ничего не найдено' : 'Контрагентов пока нет'}
          description={q || status !== 'all' ? 'Измените поиск или уберите фильтр.' : undefined}
        />
      ) : (
        <DataTable
          label="Таблица контрагентов"
          className={styles.table}
          frameClassName={styles.tableScroll}
        >
            <thead>
              <tr>
                <th>Контрагент</th>
                <th>Объекты</th>
                <th>Основной контакт</th>
                <th>Статус</th>
                <th>Изменён</th>
                <th aria-label="Открыть карточку" />
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className={styles.entityLink} href={`/counterparties/${item.id}`}>
                      {item.name}
                    </Link>
                    {item.legalName ? (
                      <div className={styles.muted}>{item.legalName}</div>
                    ) : null}
                  </td>
                  <td>{item.objectCount}</td>
                  <td>
                    {item.contactName || item.contactPhone ? (
                      <>
                        <div>{item.contactName ?? 'Контакт не указан'}</div>
                        {item.contactPhone ? (
                          <div className={styles.muted}>{item.contactPhone}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.muted}>Не указан</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={item.status}>
                      {item.status === 'active' ? 'Активный' : 'Архив'}
                    </StatusBadge>
                  </td>
                  <td title={fullDateFormatter.format(new Date(item.updatedAt))}>
                    {shortDateFormatter.format(new Date(item.updatedAt))}
                  </td>
                  <td className={styles.actionCell}>
                    <Link className={styles.openLink} href={`/counterparties/${item.id}`} aria-label={`Открыть контрагента ${item.name}`}>
                      ›
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
        </DataTable>
      )}

      {!loading && !error ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          onPageChange={(nextPage) => replaceQuery({ page: String(nextPage) })}
          summary={result.total > 0 ? `Показано ${(page - 1) * result.limit + 1}–${Math.min(page * result.limit, result.total)} из ${result.total}` : 'Ничего не найдено'}
          label="Страницы контрагентов"
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageSizeChange={setPageSize}
        />
      ) : null}
    </div>
  );
}
