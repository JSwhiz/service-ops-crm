'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  getTodayDailyReport,
  getTodayObjectAttendance,
} from '@/entities/object/api/object-operations-client';
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
const SORT_FIELDS = new Set<ObjectSortField>(['name', 'internalName', 'status', 'updatedAt', 'createdAt']);

type ObjectIssueFilter = '' | 'attention' | 'no_responsible' | 'no_employees' | 'attendance_missing' | 'daily_report_missing';

const ISSUE_LABELS: Record<Exclude<ObjectIssueFilter, ''>, string> = {
  attention: 'Требуют внимания',
  no_responsible: 'Нет ответственного',
  no_employees: 'Нет сотрудников',
  attendance_missing: 'Нет отметки присутствия',
  daily_report_missing: 'Нет дневного отчёта',
};

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

async function filterByOperationalIssue(items: ServiceObject[], issue: ObjectIssueFilter): Promise<ServiceObject[]> {
  if (!issue) return items;

  const attendanceRequired = moscowMinutes() >= 8 * 60 + 30;
  const reportRequired = moscowMinutes() >= 17 * 60;
  const needsAttendance = attendanceRequired && (issue === 'attention' || issue === 'attendance_missing');
  const needsReport = reportRequired && (issue === 'attention' || issue === 'daily_report_missing');
  const signals = new Map<string, { attendanceMissing: boolean; reportMissing: boolean }>();

  if (needsAttendance || needsReport) {
    await Promise.all(items.map(async (item) => {
      const [attendance, report] = await Promise.all([
        needsAttendance ? getTodayObjectAttendance(item.id).catch(() => null) : Promise.resolve(null),
        needsReport ? getTodayDailyReport(item.id).catch(() => null) : Promise.resolve(null),
      ]);
      signals.set(item.id, {
        attendanceMissing: needsAttendance && attendance !== null && attendance.submittedAt === null,
        reportMissing: needsReport && report === null,
      });
    }));
  }

  return items.filter((item) => {
    const signal = signals.get(item.id);
    const noResponsible = !item.responsible;
    const noEmployees = item.employees.length === 0;
    const attendanceMissing = Boolean(signal?.attendanceMissing);
    const reportMissing = Boolean(signal?.reportMissing);
    switch (issue) {
      case 'attention': return noResponsible || noEmployees || attendanceMissing || reportMissing;
      case 'no_responsible': return noResponsible;
      case 'no_employees': return noEmployees;
      case 'attendance_missing': return attendanceRequired && attendanceMissing;
      case 'daily_report_missing': return reportRequired && reportMissing;
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
    const ids = result.items
      .filter((item) => item.capabilities.canViewOperationalSections)
      .map((item) => item.id);

    if (!ids.length) {
      setSignals(new Map());
      return () => { cancelled = true; };
    }

    void listObjectRegistrySignals(ids)
      .then((items) => {
        if (!cancelled) setSignals(new Map(items.map((item) => [item.objectId, item])));
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
        <label className={styles.control}>
          <span className={styles.controlLabel}>Поиск</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Название, адрес, ответственный или менеджер"
          />
        </label>

        <label className={styles.control}>
          <span className={styles.controlLabel}>Статус</span>
          <select value={status} onChange={(event) => replaceQuery({ status: event.target.value || null, page: null })}>
            <option value="">Все статусы</option>
            <option value="active">Активный</option>
            <option value="frozen">Заморожен</option>
            <option value="archived">Архив</option>
          </select>
        </label>

        <label className={styles.control}>
          <span className={styles.controlLabel}>Операционный сигнал</span>
          <select value={issue} onChange={(event) => replaceQuery({ issue: event.target.value || null, page: null })}>
            <option value="">Все объекты</option>
            {Object.entries(ISSUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {(query || status || issue) ? (
        <div className={styles.chips} aria-label="Активные фильтры">
          {query ? <span className={styles.chip}>Поиск: {query}<button type="button" onClick={() => replaceQuery({ q: null, page: null })} aria-label="Сбросить поиск">×</button></span> : null}
          {status ? <span className={styles.chip}>Статус: {status === 'active' ? 'Активный' : status === 'frozen' ? 'Заморожен' : 'Архив'}<button type="button" onClick={() => replaceQuery({ status: null, page: null })} aria-label="Сбросить статус">×</button></span> : null}
          {issue ? <span className={styles.chip}>{ISSUE_LABELS[issue]}<button type="button" onClick={() => replaceQuery({ issue: null, page: null })} aria-label="Сбросить сигнал">×</button></span> : null}
        </div>
      ) : null}

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
