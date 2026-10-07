'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCounterparties } from '@/entities/counterparty/api/counterparty-client';
import type {
  CounterpartyListResponse,
} from '@/entities/counterparty/model/counterparty.types';
import { useAuth } from '@/shared/auth/use-auth';

import styles from './counterparties.module.css';

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
] as const;

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function StatusFilter({
  value,
  onChange,
  onReset,
}: {
  value: 'active' | 'archived' | 'all';
  onChange: (value: 'active' | 'archived' | 'all') => void;
  onReset: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = STATUS_OPTIONS.find((option) => option.value === value);

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
    <div className={styles.addFilterRoot} ref={rootRef}>
      {selectedOption ? (
        <div className={styles.filterControl}>
          <button
            type="button"
            className={styles.filterTrigger}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={styles.filterCopy}>
              <span className={styles.filterLabel}>Статус</span>
              <strong>{selectedOption.label}</strong>
            </span>
            <ChevronIcon />
          </button>
          <button
            type="button"
            className={styles.filterRemove}
            aria-label="Убрать фильтр статуса"
            title="Убрать фильтр"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.currentTarget.blur();
              onReset();
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addFilterButton}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <PlusIcon />
          <span>Добавить фильтр</span>
        </button>
      )}
      {open ? (
        <div className={selectedOption ? styles.filterDropdown : styles.addFilterMenu} role={selectedOption ? 'listbox' : 'menu'} aria-label="Статус контрагента">
          {!selectedOption ? <div className={styles.filterDropdownLabel}>Статус</div> : null}
          {STATUS_OPTIONS.map((option) => (
            <button
              type="button"
              role={selectedOption ? 'option' : 'menuitem'}
              aria-selected={selectedOption ? option.value === value : undefined}
              className={selectedOption ? styles.filterOption : styles.addFilterOption}
              data-selected={option.value === value ? 'true' : 'false'}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {!selectedOption ? <span className={styles.addFilterOptionIcon}><PlusIcon /></span> : null}
              <span>{option.label}</span>
              {selectedOption && option.value === value ? <span className={styles.filterCheck} aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
      <div className={`workspace-page counterparty-workspace ${styles.page}`}>
        <div className={`page-card workspace-surface ${styles.surface} ${styles.emptyState}`}>У вас нет доступа к контрагентам.</div>
      </div>
    );
  }

  return (
    <div className={`workspace-page counterparty-workspace ${styles.page}`}>
      <section className={styles.toolbar} aria-label="Поиск и фильтр контрагентов">
        <label className={styles.searchField}>
          <SearchIcon />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название, юр. название или контакт"
            aria-label="Поиск контрагентов"
          />
          {search ? (
            <button type="button" className={styles.searchClear} aria-label="Очистить поиск" onClick={() => setSearch('')}>×</button>
          ) : null}
        </label>
        <div className={styles.toolbarActions}>
          <StatusFilter
            value={status}
            onChange={(value) => replaceQuery({ status: value, page: null })}
            onReset={() => replaceQuery({ status: null, page: null })}
          />
          {canManage ? (
            <Link className={`${styles.primaryButton} ${styles.createButton}`} href="/counterparties/new">
              <PlusIcon />
              <span>Создать контрагента</span>
            </Link>
          ) : null}
        </div>
      </section>

      {loading ? (
        <div className={`page-card workspace-surface ${styles.surface} ${styles.loading}`}>Загружаем контрагентов…</div>
      ) : error ? (
        <div className={`${styles.surface} ${styles.error}`} role="alert">
          {error}
        </div>
      ) : result.items.length === 0 ? (
        <div className={`page-card workspace-surface ${styles.surface} ${styles.emptyState}`}>
          {q || status !== 'all' ? 'По заданным условиям контрагенты не найдены.' : 'Контрагентов пока нет.'}
        </div>
      ) : (
        <div className={`page-card workspace-surface data-table-shell ${styles.surface} ${styles.tableShell}`}>
          <div className={styles.tableScroll}>
          <table className={`object-registry-table ${styles.table}`}>
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
                    <span className={styles.statusPill} data-status={item.status}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      {item.status === 'active' ? 'Активный' : 'Архив'}
                    </span>
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
          </table>
          </div>
        </div>
      )}

      {!loading && !error ? (
        <div className={styles.pagination}>
          <span>
            {result.total > 0
              ? `Показано ${(page - 1) * result.limit + 1}–${Math.min(page * result.limit, result.total)} из ${result.total}`
              : 'Ничего не найдено'}
          </span>
          {result.totalPages > 1 ? (
            <div className={styles.paginationControls}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page <= 1}
                onClick={() => replaceQuery({ page: String(page - 1) })}
              >
                Назад
              </button>
              <span>Страница {page} из {result.totalPages}</span>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={page >= result.totalPages}
                onClick={() => replaceQuery({ page: String(page + 1) })}
              >
                Далее
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
