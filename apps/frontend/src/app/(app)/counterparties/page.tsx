'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCounterparties } from '@/entities/counterparty/api/counterparty-client';
import type {
  CounterpartyListResponse,
} from '@/entities/counterparty/model/counterparty.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

const EMPTY: CounterpartyListResponse = {
  items: [],
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,
};

export default function CounterpartiesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sequenceRef = useRef(0);

  const q = searchParams.get('q') ?? '';
  const status =
    (searchParams.get('status') as 'active' | 'archived' | 'all' | null) ??
    'active';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

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
      limit: 25,
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
  }, [canAccess, page, q, status]);

  if (!canAccess) {
    return (
      <>
        <PageTitle title="Контрагенты" />
        <div className="page-card">У вас нет доступа к контрагентам.</div>
      </>
    );
  }

  return (
    <div className="workspace-page page-stack">
      <PageTitle title="Контрагенты" />

      <section className="page-card workspace-surface section-header registry-header">
        <div>
          <div className="section-title">Реестр контрагентов</div>
          <div className="page-muted">Найдено: {result.total}</div>
        </div>
        {canManage ? (
          <Link className="button-link" href="/counterparties/new">
            Добавить контрагента
          </Link>
        ) : null}
      </section>

      <section className="page-card workspace-surface filter-panel">
        <label>
          <span className="detail-label">Поиск</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название, юр. название или контакт"
          />
        </label>
        <SearchableSelect
          label="Статус"
          value={status}
          clearable={false}
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'archived', label: 'Архив' },
            { value: 'all', label: 'Все' },
          ]}
          onChange={(value) =>
            replaceQuery({
              status: value === 'active' ? null : value,
              page: null,
            })
          }
        />
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setSearch('');
            router.replace(pathname, { scroll: false });
          }}
        >
          Сбросить
        </button>
      </section>

      {loading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card inline-notice inline-notice--warning">
          {error}
        </div>
      ) : result.items.length === 0 ? (
        <div className="page-card">Контрагенты не найдены.</div>
      ) : (
        <div className="page-card workspace-surface data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Контрагент</th>
                <th>Объекты</th>
                <th>Основной контакт</th>
                <th>Статус</th>
                <th>Изменён</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/counterparties/${item.id}`}>
                      {item.name}
                    </Link>
                    {item.legalName ? (
                      <div className="page-muted">{item.legalName}</div>
                    ) : null}
                  </td>
                  <td>{item.objectCount}</td>
                  <td>
                    {item.contactName || item.contactPhone ? (
                      <>
                        <div>{item.contactName ?? 'Контакт не указан'}</div>
                        {item.contactPhone ? (
                          <div className="page-muted">{item.contactPhone}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="page-muted">Не указан</span>
                    )}
                  </td>
                  <td>
                    <span className="status-pill" data-status={item.status}>
                      {item.status === 'active' ? 'Активный' : 'Архив'}
                    </span>
                  </td>
                  <td>{new Date(item.updatedAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 ? (
        <div className="page-card workspace-surface pagination-row">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => replaceQuery({ page: String(page - 1) })}
          >
            Назад
          </button>
          <span>
            Страница {page} из {result.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= result.totalPages}
            onClick={() => replaceQuery({ page: String(page + 1) })}
          >
            Далее
          </button>
        </div>
      ) : null}
    </div>
  );
}
