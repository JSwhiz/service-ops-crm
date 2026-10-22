'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

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
import { RegistryToolbar, type ActiveRegistryFilter, type AvailableRegistryFilter } from '@/shared/ui/registry-filters/registry-toolbar';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';

import styles from './objects-registry.module.css';
import { Alert, ButtonLink } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';

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
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(PAGE_LIMIT);
  const sortBy = parseSortBy(searchParams.get('sortBy'));
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';

  const [searchInput, setSearchInput] = useState(query);
  const [result, setResult] = useState<ObjectListPage>({ items: [], page: 1, limit: pageSize, total: 0, totalPages: 0 });
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
            limit: pageSize,
            sortBy,
            sortDirection,
          });
          if (!cancelled) setResult(response);
          return;
        }

        const allVisible = await listObjects({ search: query || undefined, status: status || undefined });
        const filtered = await filterByOperationalIssue(allVisible, issue);
        const sorted = [...filtered].sort((a, b) => compareObjects(a, b, sortBy, sortDirection));
        const totalPages = Math.ceil(sorted.length / pageSize);
        const safePage = Math.min(page, Math.max(1, totalPages || 1));
        const start = (safePage - 1) * pageSize;
        if (!cancelled) {
          setResult({
            items: sorted.slice(start, start + pageSize),
            page: safePage,
            limit: pageSize,
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
  }, [issue, page, pageSize, query, sortBy, sortDirection, status]);

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
      : field === 'name' || field === 'status' ? 'asc' : 'desc';
    replaceQuery({ sortBy: field, sortDirection: nextDirection, page: null });
  };

  const firstVisible = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1;
  const lastVisible = Math.min(result.page * result.limit, result.total);
  const activeFilters: ActiveRegistryFilter[] = [
    ...(status ? [{
      id: 'status',
      label: 'Статус',
      value: status,
      options: STATUS_OPTIONS,
      onChange: (value: string) => replaceQuery({ status: value, page: null }),
      onRemove: () => replaceQuery({ status: null, page: null }),
    }] : []),
    ...(issue ? [{
      id: 'issue',
      label: 'Операционный сигнал',
      value: issue,
      options: ISSUE_OPTIONS,
      onChange: (value: string) => replaceQuery({ issue: value, page: null }),
      onRemove: () => replaceQuery({ issue: null, page: null }),
    }] : []),
  ];
  const availableFilters: AvailableRegistryFilter[] = [
    ...(!status ? [{
      id: 'status',
      label: 'Статус',
      options: STATUS_OPTIONS,
      onAdd: (value: string) => replaceQuery({ status: value, page: null }),
    }] : []),
    ...(!issue ? [{
      id: 'issue',
      label: 'Операционный сигнал',
      options: ISSUE_OPTIONS,
      onAdd: (value: string) => replaceQuery({ issue: value, page: null }),
    }] : []),
  ];

  return (
    <div className={`ui-page object-registry ${styles.page}`}>
      <RegistryToolbar
        searchValue={searchInput}
        searchLabel="Поиск по объектам"
        searchPlaceholder="Найти объект по названию, адресу, ответственному или менеджеру"
        onSearchChange={setSearchInput}
        activeFilters={activeFilters}
        availableFilters={availableFilters}
        actions={
          allowCreateObject ? (
            <ButtonLink variant="primary" icon={<PlusIcon />} href="/objects/new">
              Создать объект
            </ButtonLink>
          ) : null
        }
      />

      {isLoading ? (
        <div className="ui-empty-state" aria-live="polite">Загрузка списка объектов...</div>
      ) : error ? (
        <Alert tone="warning">{error}</Alert>
      ) : (
        <>
          <ObjectListTable items={result.items} signals={signals} sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
          <TablePagination
            page={result.page}
            totalPages={result.totalPages}
            onPageChange={(page) => replaceQuery({ page: String(page) })}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageSizeChange={setPageSize}
            summary={result.total > 0 ? `Показано ${firstVisible}–${lastVisible} из ${result.total}` : 'Ничего не найдено'}
            label="Страницы объектов"
          />
        </>
      )}
    </div>
  );
}
