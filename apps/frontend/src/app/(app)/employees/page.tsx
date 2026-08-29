'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import {
  listEmployeeObjectReferences,
  listEmployeePositionReferences,
  listEmployees,
} from '@/entities/employee/api/employee-client';
import {
  EMPLOYEE_SCHEDULE_OPTIONS,
  formatEmployeeDate,
  formatEmployeeRate,
  getEmployeeScheduleLabel,
  getEmployeeStatusLabel,
  getEmployeeTypeLabel,
} from '@/entities/employee/lib/employee-presentation';
import type {
  EmployeeArchiveState,
  EmployeeListResponse,
  EmployeeObjectReference,
  EmployeePositionReference,
  EmployeeSortField,
  EmployeeType,
  EmployeeWorkScheduleCode,
} from '@/entities/employee/model/employee.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

const DEFAULT_LIMIT = 25;
const SORT_FIELDS = new Set<EmployeeSortField>([
  'fullName',
  'position',
  'employmentStatus',
  'employeeType',
  'birthDate',
  'createdAt',
  'updatedAt',
]);
const EMPTY_RESULT: EmployeeListResponse = {
  items: [],
  page: 1,
  limit: DEFAULT_LIMIT,
  total: 0,
  totalPages: 0,
  capabilities: { canCreate: false },
};
const MONTH_OPTIONS: SearchableSelectOption[] = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
].map((label, index) => ({ value: String(index + 1), label }));

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArchiveState(value: string | null): EmployeeArchiveState {
  return value === 'archived' || value === 'all' ? value : 'active';
}

function parseSortField(value: string | null): EmployeeSortField {
  return value && SORT_FIELDS.has(value as EmployeeSortField)
    ? (value as EmployeeSortField)
    : 'fullName';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось загрузить реестр сотрудников.';
}

async function searchObjectOptions(
  query: string,
): Promise<SearchableSelectOption[]> {
  return (await listEmployeeObjectReferences(query)).map((object) => ({
    value: object.id,
    label: object.name,
  }));
}

async function searchPositionOptions(
  query: string,
): Promise<SearchableSelectOption[]> {
  return (await listEmployeePositionReferences(query)).map((item) => ({
    value: item.value,
    label: item.label,
  }));
}

function getRegistryTab(
  employeeType: string,
  archiveState: EmployeeArchiveState,
): 'all' | 'regular' | 'one_time' | 'archived' {
  if (archiveState === 'archived') return 'archived';
  if (employeeType === 'regular') return 'regular';
  if (employeeType === 'one_time') return 'one_time';
  return 'all';
}

export default function EmployeesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestSequenceRef = useRef(0);
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;

  const querySearch = searchParams.get('search') ?? '';
  const objectId = searchParams.get('objectId') ?? '';
  const position = searchParams.get('position') ?? '';
  const employmentStatus = searchParams.get('employmentStatus') ?? '';
  const employeeType = searchParams.get('employeeType') ?? '';
  const archiveState = parseArchiveState(searchParams.get('archiveState'));
  const birthMonth = searchParams.get('birthMonth') ?? '';
  const assignmentFilter = searchParams.get('hasActiveObjectAssignment') ?? '';
  const workScheduleCode = searchParams.get('workScheduleCode') ?? '';
  const workTimeSearch = searchParams.get('workTimeSearch') ?? '';
  const sortBy = parseSortField(searchParams.get('sortBy'));
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const requestedLimit = parsePositiveInteger(searchParams.get('limit'), DEFAULT_LIMIT);
  const limit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : DEFAULT_LIMIT;

  const [searchInput, setSearchInput] = useState(querySearch);
  const [workTimeInput, setWorkTimeInput] = useState(workTimeSearch);
  const [result, setResult] = useState<EmployeeListResponse>(EMPTY_RESULT);
  const [objects, setObjects] = useState<EmployeeObjectReference[]>([]);
  const [positions, setPositions] = useState<EmployeePositionReference[]>([]);
  const [isLoadingReferences, setIsLoadingReferences] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  };

  useEffect(() => setSearchInput(querySearch), [querySearch]);
  useEffect(() => setWorkTimeInput(workTimeSearch), [workTimeSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      const nextWorkTime = workTimeInput.trim();
      if (nextSearch === querySearch && nextWorkTime === workTimeSearch) return;
      replaceQuery({ search: nextSearch || null, workTimeSearch: nextWorkTime || null, page: null });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [querySearch, searchInput, workTimeInput, workTimeSearch]);

  useEffect(() => {
    if (!canAccessEmployeesHr) return;
    let cancelled = false;
    setIsLoadingReferences(true);
    void Promise.all([
      listEmployeeObjectReferences(undefined, objectId || undefined),
      listEmployeePositionReferences(),
    ])
      .then(([nextObjects, nextPositions]) => {
        if (!cancelled) {
          setObjects(nextObjects);
          setPositions(
            position && !nextPositions.some((item) => item.value === position)
              ? [{ value: position, label: position }, ...nextPositions]
              : nextPositions,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReferences(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessEmployeesHr, objectId, position]);

  useEffect(() => {
    if (!canAccessEmployeesHr) {
      setResult(EMPTY_RESULT);
      setIsLoading(false);
      return;
    }
    const requestSequence = ++requestSequenceRef.current;
    setIsLoading(true);
    setError(null);
    void listEmployees({
      search: querySearch || undefined,
      objectId: objectId || undefined,
      position: position || undefined,
      employmentStatus: employmentStatus || undefined,
      employeeType: (employeeType || undefined) as EmployeeType | undefined,
      workScheduleCode: (workScheduleCode || undefined) as EmployeeWorkScheduleCode | undefined,
      workTimeSearch: workTimeSearch || undefined,
      archiveState,
      birthMonth: birthMonth ? Number(birthMonth) : undefined,
      hasActiveObjectAssignment:
        assignmentFilter === 'true' ? true : assignmentFilter === 'false' ? false : undefined,
      sortBy,
      sortOrder,
      page,
      limit,
    })
      .then((response) => {
        if (requestSequence === requestSequenceRef.current) setResult(response);
      })
      .catch((loadError) => {
        if (requestSequence === requestSequenceRef.current) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (requestSequence === requestSequenceRef.current) setIsLoading(false);
      });
  }, [archiveState, assignmentFilter, birthMonth, canAccessEmployeesHr, employeeType,
    employmentStatus, limit, objectId, page, position, querySearch, reloadKey, sortBy,
    sortOrder, workScheduleCode, workTimeSearch]);

  const tab = getRegistryTab(employeeType, archiveState);
  const activeFilterCount = [objectId, position, employmentStatus, birthMonth,
    assignmentFilter, workScheduleCode, workTimeSearch].filter(Boolean).length;
  const firstItem = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1;
  const lastItem = Math.min(result.total, result.page * result.limit);
  const objectOptions = objects.map((object) => ({ value: object.id, label: object.name }));
  const positionOptions = positions.map((item) => ({ value: item.value, label: item.label }));

  const setTab = (nextTab: typeof tab): void => {
    replaceQuery({
      employeeType: nextTab === 'regular' || nextTab === 'one_time' ? nextTab : null,
      archiveState: nextTab === 'archived' ? 'archived' : null,
      page: null,
    });
  };

  const filterFields = (
    <div className="employee-filter-grid">
      <SearchableSelect label="Объект" value={objectId} options={objectOptions}
        placeholder="Все объекты" loading={isLoadingReferences}
        asyncSearch={searchObjectOptions}
        onChange={(value) => replaceQuery({ objectId: value || null, page: null })} />
      <SearchableSelect label="Должность" value={position} options={positionOptions}
        placeholder="Все должности" loading={isLoadingReferences}
        asyncSearch={searchPositionOptions}
        onChange={(value) => replaceQuery({ position: value || null, page: null })} />
      <SearchableSelect label="Статус работы" value={employmentStatus}
        placeholder="Все статусы" options={[{ value: 'active', label: 'Работает' }, { value: 'inactive', label: 'Неактивен' }]}
        onChange={(value) => replaceQuery({ employmentStatus: value || null, page: null })} />
      <SearchableSelect label="График" value={workScheduleCode} placeholder="Любой график"
        options={EMPLOYEE_SCHEDULE_OPTIONS}
        onChange={(value) => replaceQuery({ workScheduleCode: value || null, page: null })} />
      <label><span className="detail-label">Время работы</span><input value={workTimeInput}
        onChange={(event) => setWorkTimeInput(event.target.value)} placeholder="Например: 08:00–17:00" /></label>
      <SearchableSelect label="Месяц рождения" value={birthMonth} placeholder="Любой месяц"
        options={MONTH_OPTIONS} onChange={(value) => replaceQuery({ birthMonth: value || null, page: null })} />
      <SearchableSelect label="Назначение на объект" value={assignmentFilter} placeholder="Любое"
        options={[{ value: 'true', label: 'Назначен на объект' }, { value: 'false', label: 'Без активного объекта' }]}
        onChange={(value) => replaceQuery({ hasActiveObjectAssignment: value || null, page: null })} />
      <SearchableSelect label="Сортировка" value={sortBy} clearable={false}
        options={[{ value: 'fullName', label: 'ФИО' }, { value: 'position', label: 'Должность' },
          { value: 'employeeType', label: 'Тип сотрудника' }, { value: 'employmentStatus', label: 'Статус работы' },
          { value: 'birthDate', label: 'Дата рождения' }, { value: 'updatedAt', label: 'Дата изменения' }]}
        onChange={(value) => replaceQuery({ sortBy: value, page: null })} />
      <SearchableSelect label="Порядок" value={sortOrder} clearable={false}
        options={[{ value: 'asc', label: 'По возрастанию' }, { value: 'desc', label: 'По убыванию' }]}
        onChange={(value) => replaceQuery({ sortOrder: value === 'asc' ? null : value, page: null })} />
    </div>
  );

  return (
    <><PageTitle title="Сотрудники" />
      {!canAccessEmployeesHr ? (
        <div className="page-card inline-notice inline-notice--warning">У вас нет доступа к HR-контуру сотрудников.</div>
      ) : (
        <div className="page-stack employee-registry">
          <section className="page-card section-header"><div><div className="section-title">Реестр сотрудников</div>
            <div className="section-subtitle">Контакты, графики и текущие назначения в одном списке.</div></div>
            {result.capabilities.canCreate ? <Link className="button-link" href="/employees/new">Добавить сотрудника</Link> : null}
          </section>

          <nav className="employee-tabs" aria-label="Разделы реестра">
            {([['all', 'Все сотрудники'], ['regular', 'Постоянные'], ['one_time', 'Разовые'], ['archived', 'Архив']] as const)
              .map(([value, label]) => <button key={value} type="button" className={tab === value ? 'is-active' : undefined}
                aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}
            {user?.capabilities?.canAccessCandidates ? <Link href="/employees/reserve">Резерв</Link> : null}
          </nav>

          <section className="page-card employee-search-row">
            <label className="employee-main-search"><span className="detail-label">Поиск</span>
              <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Поиск по ФИО или телефону" /></label>
            <button type="button" className="button-secondary employee-filter-toggle" onClick={() => setFiltersOpen(true)}>
              Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ''}</button>
          </section>

          <section className="page-card employee-filter-panel">{filterFields}<div className="action-row">
            <button type="button" className="button-secondary" onClick={() => router.replace(pathname, { scroll: false })}>
              Сбросить фильтры{activeFilterCount ? ` (${activeFilterCount})` : ''}</button></div></section>

          {filtersOpen ? <div className="employee-filter-sheet" role="dialog" aria-modal="true">
            <button type="button" className="employee-filter-sheet__backdrop" aria-label="Закрыть фильтры" onClick={() => setFiltersOpen(false)} />
            <div className="employee-filter-sheet__panel"><div className="section-header"><div className="section-title">Фильтры</div>
              <button type="button" className="button-secondary" onClick={() => setFiltersOpen(false)}>Готово</button></div>
              {filterFields}<button type="button" className="button-secondary" onClick={() => { router.replace(pathname, { scroll: false }); setFiltersOpen(false); }}>Сбросить фильтры</button>
            </div></div> : null}

          {isLoading ? <div className="page-card employee-loading" aria-live="polite">Загружаем сотрудников...</div>
            : error ? <div className="page-card inline-notice inline-notice--warning"><div>{error}</div>
              <button type="button" className="button-secondary" onClick={() => setReloadKey((current) => current + 1)}>Повторить</button></div>
            : result.items.length === 0 ? <div className="page-card">{querySearch || activeFilterCount
              ? 'По выбранным фильтрам сотрудников нет.' : 'Сотрудники не найдены.'}</div>
            : <><div className="page-card employee-table-wrap"><table className="employee-registry-table"><thead><tr>
              <th>ФИО</th><th>Телефон</th><th>Должность</th><th>Тип</th><th>Статус</th><th>Дата рождения</th>
              <th>График</th><th>Время работы</th><th>Ставка за день</th><th>Текущие объекты</th><th>Изменён</th>
            </tr></thead><tbody>{result.items.map((item) => <tr key={item.id} tabIndex={0}
              onClick={() => router.push(`/employees/${item.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') router.push(`/employees/${item.id}`); }}>
              <td><Link href={`/employees/${item.id}`}>{item.fullName}</Link></td><td>{item.phone ?? '—'}</td><td>{item.position ?? '—'}</td>
              <td><span className="employee-type-badge">{getEmployeeTypeLabel(item.employeeType)}</span></td><td>{getEmployeeStatusLabel(item.employmentStatus)}</td>
              <td>{formatEmployeeDate(item.birthDate)}</td><td title={item.workScheduleCustom ?? undefined}>{getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom)}</td>
              <td>{item.workTimeText ?? '—'}</td><td>{formatEmployeeRate(item.baseDailyRate)}</td><td><div className="employee-object-chips">
                {item.currentObjects.length ? item.currentObjects.map((object) => <span key={object.id}>{object.name}</span>) : '—'}</div></td>
              <td>{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td></tr>)}</tbody></table></div>
              <div className="employee-mobile-list">{result.items.map((item) => <Link key={item.id} href={`/employees/${item.id}`} className="page-card employee-mobile-card">
                <div className="section-header"><div><strong>{item.fullName}</strong><div className="page-muted">{item.position ?? 'Должность не указана'}</div></div>
                  <span className="employee-type-badge">{getEmployeeTypeLabel(item.employeeType)}</span></div>
                <div className="employee-mobile-card__meta"><span>{item.phone ?? 'Телефон не указан'}</span><span>{getEmployeeStatusLabel(item.employmentStatus)}</span>
                  <span>{getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom)}</span></div>
                <div className="employee-object-chips">{item.currentObjects.length ? item.currentObjects.map((object) => <span key={object.id}>{object.name}</span>) : <span>Без объекта</span>}</div>
              </Link>)}</div></>}

          {result.total > 0 ? <div className="page-card pagination-row"><span className="page-muted">{firstItem}–{lastItem} из {result.total}</span>
            <SearchableSelect label="На странице" value={String(limit)} clearable={false}
              options={[25, 50, 100].map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(value) => replaceQuery({ limit: value === String(DEFAULT_LIMIT) ? null : value, page: null })} />
            <button type="button" className="button-secondary" disabled={result.page <= 1 || isLoading} onClick={() => replaceQuery({ page: String(result.page - 1) })}>Назад</button>
            <button type="button" className="button-secondary" disabled={result.page >= result.totalPages || isLoading} onClick={() => replaceQuery({ page: String(result.page + 1) })}>Вперёд</button>
          </div> : null}
        </div>
      )}</>
  );
}
