'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import {
  listObjectRegistrySignals,
  listObjects,
  listObjectsPage,
  type ObjectListPage,
  type ObjectRegistrySignal,
  type ObjectSortField,
} from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { ObjectListTable } from '@/features/object-list/ui/object-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

import styles from './objects-registry.module.css';

const PAGE_LIMIT = 20;
const SIGNAL_BATCH_SIZE = 50;
const SORT_FIELDS = new Set<ObjectSortField>(['name', 'internalName', 'status', 'updatedAt', 'createdAt']);

type ObjectIssueFilter = '' | 'attention' | 'no_responsible' | 'no_employees' | 'attendance_missing' | 'daily_report_missing';

const ISSUE_LABELS: Record<Exclude<ObjectIssueFilter, ''>, string> = {
  attention: 'Требуют внимания',
  no_responsible: 'Нет ответственного',
  no_employees: 'Нет сотрудников',
  attendance_missing: 'Нет отметки присутствия',
  daily_report_missing: 'Нет дневного отчёта',
};

const STATUS_OPTIONS = [
  { value: 'active', label: 'Активный' },
  { value: 'frozen', label: 'Заморожен' },
  { value: 'archived', label: 'Архив' },
] as const;

const ISSUE_OPTIONS = Object.entries(ISSUE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

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

interface RegistryFilterSelectProps {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  onRemove: () => void;
}

function RegistryFilterSelect({
  label,
  value,
  options,
  onChange,
  onRemove,
}: RegistryFilterSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const valueLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  return (
    <div className={styles.filterControl} ref={rootRef}>
      <button
        type="button"
        className={styles.filterTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.filterCopy}>
          <span className={styles.filterLabel}>{label}</span>
          <strong>{valueLabel}</strong>
        </span>
        <ChevronIcon />
      </button>
      <button
        type="button"
        className={styles.filterRemove}
        aria-label={`Удалить фильтр «${label}»`}
        title="Удалить фильтр"
        onClick={onRemove}
      >
        ×
      </button>

      {open ? (
        <div className={styles.filterDropdown} role="listbox" aria-label={label}>
          <div className={styles.filterDropdownLabel}>{label}</div>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={styles.filterOption}
              data-selected={option.value === value ? 'true' : 'false'}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <span className={styles.filterCheck} aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface AddFilterMenuProps {
  statusActive: boolean;
  issueActive: boolean;
  onStatus: (value: string) => void;
  onIssue: (value: string) => void;
}

function AddFilterMenu({
  statusActive,
  issueActive,
  onStatus,
  onIssue,
}: AddFilterMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasAvailableFilters = !statusActive || !issueActive;

  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  return (
    <div className={styles.addFilterRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.addFilterButton}
        disabled={!hasAvailableFilters}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon />
        <span>{hasAvailableFilters ? 'Добавить фильтр' : 'Все фильтры добавлены'}</span>
      </button>

      {open ? (
        <div className={styles.addFilterMenu} role="menu">
          {!statusActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Статус</div>
              {STATUS_OPTIONS.map((option) => (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.addFilterOption}
                  key={option.value}
                  onClick={() => {
                    onStatus(option.value);
                    setOpen(false);
                  }}
                >
                  <span className={styles.addFilterOptionIcon}><PlusIcon /></span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {!issueActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Операционный сигнал</div>
              {ISSUE_OPTIONS.map((option) => (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.addFilterOption}
                  key={option.value}
                  onClick={() => {
                    onIssue(option.value);
                    setOpen(false);
                  }}
                >
                  <span className={styles.addFilterOptionIcon}><PlusIcon /></span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSortBy(value: string | null): ObjectSortField {
  return value && SORT_FIELDS.has(value as ObjectSortField) ? value as ObjectSortField : 'updatedAt';
}

function parseIssue(value: string | null): ObjectIssueFilter {
  if (value === 'without_responsible') return 'no_responsible';
  if (value === 'without_employees') return 'no_employees';
  return value && value in ISSUE_LABELS ? value as ObjectIssueFilter : '';
}

function moscowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function compareObjects(a: ServiceObject, b: ServiceObject, field: ObjectSortField, direction: 'asc' | 'desc'): number {
  const factor = direction === 'asc' ? 1 : -1;
  const value = (item: ServiceObject): string => {
    switch (field) {
      case 'name': return item.name;
      case 'internalName': return item.internalName ?? '';
      case 'status': return item.status;
      case 'createdAt': return item.createdAt;
      case 'updatedAt': return item.updatedAt;
    }
  };
  return value(a).localeCompare(value(b), 'ru') * factor;
}

async function loadOperationalSignals(items: ServiceObject[]): Promise<Map<string, ObjectRegistrySignal>> {
  const ids = items
    .filter((item) => item.capabilities.canViewOperationalSections)
    .map((item) => item.id);
  if (!ids.length) return new Map();

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += SIGNAL_BATCH_SIZE) {
    batches.push(ids.slice(index, index + SIGNAL_BATCH_SIZE));
  }

  const responses = await Promise.all(batches.map((batch) => listObjectRegistrySignals(batch)));
  const flattened = responses.flat();
  return new Map(flattened.map((item) => [item.objectId, item]));
}

async function filterByOperationalIssue(items: ServiceObject[], issue: ObjectIssueFilter): Promise<ServiceObject[]> {
  if (!issue) return items;

  const minutes = moscowMinutes();
  const attendanceRequired = minutes >= 8 * 60 + 30;
  const reportRequired = minutes >= 17 * 60;
  const needsSignals =
    (attendanceRequired && (issue === 'attention' || issue === 'attendance_missing'))
    || (reportRequired && (issue === 'attention' || issue === 'daily_report_missing'));
  const signals = needsSignals ? await loadOperationalSignals(items) : new Map<string, ObjectRegistrySignal>();

  return items.filter((item) => {
    const signal = signals.get(item.id);
    const noResponsible = !item.responsible;
    const noEmployees = item.employees.length === 0;
    const attendanceMissing = attendanceRequired && Boolean(signal) && !signal?.attendanceSubmitted;
    const reportMissing = reportRequired && Boolean(signal) && !signal?.dailyReportSubmitted;

    switch (issue) {
      case 'attention': return noResponsible || noEmployees || attendanceMissing || reportMissing;
      case 'no_responsible': return noResponsible;
      case 'no_employees': return noEmployees;
      case 'attendance_missing': return attendanceMissing;
      case 'daily_report_missing': return reportMissing;
      default: return true;
    }
  });
}

export default function ObjectsPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const issue = parseIssue(searchParams.get('issue'));
  const page = parsePage(searchParams.get('page'));
  const sortBy = parseSortBy(searchParams.get('sortBy'));
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';

  const [searchInput, setSearchInput] = useState(query);
  const [result, setResult] = useState<ObjectListPage>({ items: [], page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 0 });
  const [signals, setSignals] = useState<Map<string, ObjectRegistrySignal>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;

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
      const nextQuery = searchInput.trim();
      if (nextQuery === query) return;
      replaceQuery({ q: nextQuery || null, page: null });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, query]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        if (!issue) {
          const response = await listObjectsPage({
            q: query || undefined,
            status: status || undefined,
            page,
            limit: PAGE_LIMIT,
            sortBy,
            sortDirection,
          });
          if (!cancelled) setResult(response);
          return;
        }

        const allVisible = await listObjects({ search: query || undefined, status: status || undefined });
        const filtered = await filterByOperationalIssue(allVisible, issue);
        const sorted = [...filtered].sort((a, b) => compareObjects(a, b, sortBy, sortDirection));
        const totalPages = Math.ceil(sorted.length / PAGE_LIMIT);
        const safePage = Math.min(page, Math.max(1, totalPages || 1));
        const start = (safePage - 1) * PAGE_LIMIT;
        if (!cancelled) {
          setResult({
            items: sorted.slice(start, start + PAGE_LIMIT),
            page: safePage,
            limit: PAGE_LIMIT,
            total: sorted.length,
            totalPages,
          });
        }
      } catch {
        if (!cancelled) setError('Не удалось загрузить список объектов.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [issue, page, query, sortBy, sortDirection, status]);

  useEffect(() => {
    let cancelled = false;
    void loadOperationalSignals(result.items)
      .then((nextSignals) => {
        if (!cancelled) setSignals(nextSignals);
      })
      .catch(() => {
        if (!cancelled) setSignals(new Map());
      });
    return () => { cancelled = true; };
  }, [result.items]);

  const handleSort = (field: ObjectSortField): void => {
    const nextDirection = field === sortBy
      ? sortDirection === 'asc' ? 'desc' : 'asc'
      : field === 'name' ? 'asc' : 'desc';
    replaceQuery({ sortBy: field, sortDirection: nextDirection, page: null });
  };

  const summary = issue
    ? `${ISSUE_LABELS[issue]}: ${result.total}`
    : query
      ? `Найдено: ${result.total}`
      : `Доступно объектов: ${result.total}`;

  return (
    <div className={`workspace-page object-registry ${styles.page}`}>
      <PageTitle title="Объекты" />

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Объекты</h1>
          <div className={styles.subtitle}>{summary}</div>
        </div>
        {allowCreateObject ? <Link className="button-link" href="/objects/new">Создать объект</Link> : null}
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchBox} data-active={searchInput ? 'true' : 'false'}>
          <SearchIcon />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Найти объект по названию, адресу, ответственному или менеджеру"
            aria-label="Поиск по объектам"
          />
          {searchInput ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearchInput('')}
              aria-label="Очистить поиск"
              title="Очистить поиск"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className={styles.filters} aria-label="Фильтры объектов">
          {status ? (
            <RegistryFilterSelect
              label="Статус"
              value={status}
              options={STATUS_OPTIONS}
              onChange={(value) => replaceQuery({ status: value, page: null })}
              onRemove={() => replaceQuery({ status: null, page: null })}
            />
          ) : null}

          {issue ? (
            <RegistryFilterSelect
              label="Операционный сигнал"
              value={issue}
              options={ISSUE_OPTIONS}
              onChange={(value) => replaceQuery({ issue: value, page: null })}
              onRemove={() => replaceQuery({ issue: null, page: null })}
            />
          ) : null}

          <AddFilterMenu
            statusActive={Boolean(status)}
            issueActive={Boolean(issue)}
            onStatus={(value) => replaceQuery({ status: value, page: null })}
            onIssue={(value) => replaceQuery({ issue: value, page: null })}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="page-card workspace-surface workspace-empty" aria-live="polite">Загрузка списка объектов...</div>
      ) : error ? (
        <div className="page-card workspace-surface inline-notice inline-notice--warning">{error}</div>
      ) : (
        <>
          <ObjectListTable items={result.items} signals={signals} sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
          {result.totalPages > 1 ? (
            <div className={styles.pagination}>
              <span className="page-muted">Страница {result.page} из {result.totalPages}</span>
              <div className="action-row">
                <button type="button" disabled={result.page <= 1} onClick={() => replaceQuery({ page: String(Math.max(1, result.page - 1)) })}>Назад</button>
                <button type="button" disabled={result.page >= result.totalPages} onClick={() => replaceQuery({ page: String(Math.min(result.totalPages, result.page + 1)) })}>Далее</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
