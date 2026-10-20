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
import { formatRegistryDate } from '@/shared/lib/registry-presentation';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import type { ActiveRegistryFilter, AvailableRegistryFilter } from '@/shared/ui/registry-filters/registry-toolbar';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryOpenLink } from '@/shared/ui/data-table/registry-open-link';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

import styles from './employee-registry.module.css';

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
): 'all' | 'regular' | 'one_time' | 'substitution' | 'archived' {
  if (archiveState === 'archived') return 'archived';
  if (employeeType === 'regular') return 'regular';
  if (employeeType === 'one_time') return 'one_time';
  if (employeeType === 'substitution') return 'substitution';
  return 'all';
}

export default function EmployeesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestSequenceRef = useRef(0);
  const registryNavRef = useRef<HTMLElement>(null);
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;

  const querySearch = searchParams.get('search') ?? '';
  const objectId = searchParams.get('objectId') ?? '';
  const position = searchParams.get('position') ?? '';
  const employmentStatus = searchParams.get('employmentStatus') ?? '';
  const employeeType = searchParams.get('employeeType') ?? '';
  const passportFilter = searchParams.get('passportReceived') ?? '';
  const contractFilter = searchParams.get('contractReceived') ?? '';
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
  const [workTimeFilterActive, setWorkTimeFilterActive] = useState(Boolean(workTimeSearch));
  const [objectFilterActive, setObjectFilterActive] = useState(Boolean(objectId));
  const [result, setResult] = useState<EmployeeListResponse>(EMPTY_RESULT);
  const [objects, setObjects] = useState<EmployeeObjectReference[]>([]);
  const [positions, setPositions] = useState<EmployeePositionReference[]>([]);
  const [isLoadingReferences, setIsLoadingReferences] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
  useEffect(() => setWorkTimeFilterActive(Boolean(workTimeSearch)), [workTimeSearch]);
  useEffect(() => setObjectFilterActive(Boolean(objectId)), [objectId]);

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
      objectId ? listEmployeeObjectReferences(undefined, objectId) : Promise.resolve([]),
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
      passportReceived: passportFilter === 'true' ? true : passportFilter === 'false' ? false : undefined,
      contractReceived: contractFilter === 'true' ? true : contractFilter === 'false' ? false : undefined,
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
    sortOrder, workScheduleCode, workTimeSearch, passportFilter, contractFilter]);

  const tab = getRegistryTab(employeeType, archiveState);

  useEffect(() => {
    const nav = registryNavRef.current;
    const activeTab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !activeTab) return;

    const viewport = nav.getBoundingClientRect();
    const selected = activeTab.getBoundingClientRect();
    // Scroll only the navigation strip; scrollIntoView can also move the page.
    if (selected.left < viewport.left) {
      nav.scrollLeft += selected.left - viewport.left;
    } else if (selected.right > viewport.right) {
      nav.scrollLeft += selected.right - viewport.right;
    }
  }, [tab, canAccessEmployeesHr]);

  const activeFilterCount = [objectId, position, employmentStatus, birthMonth,
    assignmentFilter, workScheduleCode, workTimeSearch, passportFilter, contractFilter].filter(Boolean).length;
  const firstItem = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1;
  const lastItem = Math.min(result.total, result.page * result.limit);
  const selectedObjectOption = objects.find((object) => object.id === objectId);
  const positionOptions = positions.map((item) => ({ value: item.value, label: item.label }));

  const setTab = (nextTab: typeof tab): void => {
    replaceQuery({
      employeeType: nextTab === 'regular' || nextTab === 'one_time' || nextTab === 'substitution' ? nextTab : null,
      archiveState: nextTab === 'archived' ? 'archived' : null,
      page: null,
    });
  };

  const statusOptions = [{ value: 'active', label: 'Работает' }, { value: 'inactive', label: 'Неактивен' }];
  const assignmentOptions = [{ value: 'true', label: 'Назначен на объект' }, { value: 'false', label: 'Без активного объекта' }];
  const sortOptions = [{ value: 'fullName', label: 'ФИО' }, { value: 'position', label: 'Должность' }, { value: 'employeeType', label: 'Тип сотрудника' }, { value: 'employmentStatus', label: 'Статус работы' }, { value: 'birthDate', label: 'Дата рождения' }, { value: 'updatedAt', label: 'Дата изменения' }];
  const sortValue = `${sortBy}:${sortOrder}`;
  const sortValueOptions = sortOptions.flatMap((option) => [{ value: `${option.value}:asc`, label: `${option.label} · по возрастанию` }, { value: `${option.value}:desc`, label: `${option.label} · по убыванию` }]);
  const activeRegistryFilters: ActiveRegistryFilter[] = ([
    ...([
      ['passportReceived', 'Паспорт', passportFilter],
      ['contractReceived', 'Трудовой договор', contractFilter],
    ] as const).filter(([, , value]) => value).map(([id, label, value]) => ({
      id, label, value,
      options: [{ value: 'true', label: 'Получен' }, { value: 'false', label: 'Не получен' }],
      onChange: (nextValue: string) => replaceQuery({ [id]: nextValue || null, page: null }),
      onRemove: () => replaceQuery({ [id]: null, page: null }),
    })),
    objectFilterActive || objectId ? { id: 'object', label: 'Объект', value: objectId, options: selectedObjectOption ? [{ value: objectId, label: selectedObjectOption.name }] : [], onChange: (value: string) => replaceQuery({ objectId: value || null, page: null }), onRemove: () => { setObjectFilterActive(false); replaceQuery({ objectId: null, page: null }); }, customControl: <SearchableSelect label="Объект" hideLabel value={objectId} options={[]} selectedOption={selectedObjectOption ? { value: objectId, label: selectedObjectOption.name } : null} placeholder="Все объекты" loading={isLoadingReferences} asyncSearch={searchObjectOptions} minimumSearchLength={2} searchPlaceholder="Введите название объекта" searchPromptText="Введите не менее 2 символов, чтобы найти объект" searchInputVariant="registry" onChange={(value) => replaceQuery({ objectId: value || null, page: null })} /> } : null,
    position ? { id: 'position', label: 'Должность', value: position, options: positionOptions, onChange: (value: string) => replaceQuery({ position: value || null, page: null }), onRemove: () => replaceQuery({ position: null, page: null }), customControl: <SearchableSelect label="Должность" hideLabel value={position} options={positionOptions} placeholder="Все должности" loading={isLoadingReferences} minimumSearchLength={2} searchPlaceholder="Введите должность" searchPromptText="Введите не менее 2 символов, чтобы найти должность" searchInputVariant="registry" asyncSearch={searchPositionOptions} onChange={(value) => replaceQuery({ position: value || null, page: null })} /> } : null,
    employmentStatus ? { id: 'employment', label: 'Статус работы', value: employmentStatus, options: statusOptions, onChange: (value: string) => replaceQuery({ employmentStatus: value || null, page: null }), onRemove: () => replaceQuery({ employmentStatus: null, page: null }) } : null,
    workScheduleCode ? { id: 'schedule', label: 'График', value: workScheduleCode, options: EMPLOYEE_SCHEDULE_OPTIONS, onChange: (value: string) => replaceQuery({ workScheduleCode: value || null, page: null }), onRemove: () => replaceQuery({ workScheduleCode: null, page: null }) } : null,
    workTimeFilterActive ? { id: 'worktime', label: 'Время работы', value: workTimeSearch, options: [], onChange: (value: string) => setWorkTimeInput(value), onRemove: () => { setWorkTimeInput(''); setWorkTimeFilterActive(false); replaceQuery({ workTimeSearch: null, page: null }); }, customControl: <input aria-label="Фильтр времени работы" placeholder="Например: 08:00–17:00" value={workTimeInput} onChange={(event) => setWorkTimeInput(event.target.value)} /> } : null,
    birthMonth ? { id: 'birth-month', label: 'Месяц рождения', value: birthMonth, options: MONTH_OPTIONS, onChange: (value: string) => replaceQuery({ birthMonth: value || null, page: null }), onRemove: () => replaceQuery({ birthMonth: null, page: null }) } : null,
    assignmentFilter ? { id: 'assignment', label: 'Назначение', value: assignmentFilter, options: assignmentOptions, onChange: (value: string) => replaceQuery({ hasActiveObjectAssignment: value || null, page: null }), onRemove: () => replaceQuery({ hasActiveObjectAssignment: null, page: null }) } : null,
    sortValue !== 'fullName:asc' ? { id: 'sort', label: 'Сортировка', value: sortValue, options: sortValueOptions, onChange: (value: string) => { const [sortBy, sortOrder] = value.split(':') as [EmployeeSortField, 'asc' | 'desc']; replaceQuery({ sortBy, sortOrder: sortOrder === 'asc' ? null : sortOrder, page: null }); }, onRemove: () => replaceQuery({ sortBy: null, sortOrder: null, page: null }) } : null,
  ].filter(Boolean) as ActiveRegistryFilter[]);
  const availableRegistryFilters: AvailableRegistryFilter[] = ([
    ...([
      ['passportReceived', 'Паспорт', passportFilter],
      ['contractReceived', 'Трудовой договор', contractFilter],
    ] as const).filter(([, , value]) => !value).map(([id, label]) => ({
      id, label,
      options: [{ value: 'true', label: 'Получен' }, { value: 'false', label: 'Не получен' }],
      onAdd: (value: string) => replaceQuery({ [id]: value, page: null }),
    })),
    !objectFilterActive && !objectId ? { id: 'object', label: 'Объект', options: [{ value: 'object', label: 'Выбрать объект' }], onAdd: () => setObjectFilterActive(true) } : null,
    !position && positionOptions.length ? { id: 'position', label: 'Должность', options: positionOptions, onAdd: (value: string) => replaceQuery({ position: value, page: null }) } : null,
    !employmentStatus ? { id: 'employment', label: 'Статус работы', options: statusOptions, onAdd: (value: string) => replaceQuery({ employmentStatus: value, page: null }) } : null,
    !workScheduleCode ? { id: 'schedule', label: 'График', options: EMPLOYEE_SCHEDULE_OPTIONS, onAdd: (value: string) => replaceQuery({ workScheduleCode: value, page: null }) } : null,
    !workTimeFilterActive ? { id: 'worktime', label: 'Время работы', options: [{ value: 'worktime', label: 'Указать время' }], onAdd: () => { setWorkTimeFilterActive(true); setWorkTimeInput(''); } } : null,
    !birthMonth ? { id: 'birth-month', label: 'Месяц рождения', options: MONTH_OPTIONS, onAdd: (value: string) => replaceQuery({ birthMonth: value, page: null }) } : null,
    !assignmentFilter ? { id: 'assignment', label: 'Назначение на объект', options: assignmentOptions, onAdd: (value: string) => replaceQuery({ hasActiveObjectAssignment: value, page: null }) } : null,
    sortValue === 'fullName:asc' ? { id: 'sort', label: 'Сортировка', options: sortValueOptions, onAdd: (value: string) => { const [sortBy, sortOrder] = value.split(':') as [EmployeeSortField, 'asc' | 'desc']; replaceQuery({ sortBy, sortOrder: sortOrder === 'asc' ? null : sortOrder, page: null }); } } : null,
  ].filter(Boolean) as AvailableRegistryFilter[]);

  return (
    <>{!canAccessEmployeesHr ? (
        <div className="page-card inline-notice inline-notice--warning">У вас нет доступа к HR-контуру сотрудников.</div>
      ) : (
        <div className="page-stack workspace-page employee-registry">
          <nav ref={registryNavRef} className={`employee-tabs ${styles.tabs}`} aria-label="Разделы реестра">
            {([['all', 'Все сотрудники'], ['regular', 'Постоянные'], ['one_time', 'Разовые'], ['substitution', 'Подменные'], ['archived', 'Архив']] as const)
              .map(([value, label]) => <button key={value} type="button" className={tab === value ? 'is-active' : undefined}
                aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}
            {user?.capabilities?.canAccessCandidates ? <Link href="/employees/reserve">Резерв</Link> : null}
          </nav>

          <RegistryToolbar
            searchValue={searchInput}
            searchLabel="Поиск по сотрудникам"
            searchPlaceholder="Поиск по ФИО или телефону"
            onSearchChange={setSearchInput}
            activeFilters={activeRegistryFilters}
            availableFilters={availableRegistryFilters}
            actions={result.capabilities.canCreate ? <Link className="button-link button-link--primary" href="/employees/new">Добавить сотрудника</Link> : null}
          />

          {isLoading ? <div className="page-card employee-loading" aria-live="polite">Загружаем сотрудников...</div>
            : error ? <div className="page-card inline-notice inline-notice--warning"><div>{error}</div>
              <button type="button" className="button-secondary" onClick={() => setReloadKey((current) => current + 1)}>Повторить</button></div>
            : result.items.length === 0 ? <div className="page-card workspace-surface workspace-empty">{querySearch || activeFilterCount
              ? 'По выбранным фильтрам сотрудников нет.' : 'Сотрудники не найдены.'}</div>
            : <><DataTable label="Таблица сотрудников" className="employee-registry-table" frameClassName="page-card workspace-surface data-table-shell employee-table-wrap"><thead><tr>
              <th>ФИО</th><th>Телефон</th><th>Должность</th><th>Тип</th><th>Статус</th><th>Дата рождения</th>
              <th>График</th><th>Время работы</th><th>Ставка за день</th><th>Текущие объекты</th><th>Изменён</th><th aria-label="Открыть" />
            </tr></thead><tbody>{result.items.map((item) => <tr key={item.id} tabIndex={0}
              onClick={() => router.push(`/employees/${item.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') router.push(`/employees/${item.id}`); }}>
              <td title={item.fullName}><Link href={`/employees/${item.id}`}>{item.fullName}</Link></td><td title={item.phone ?? undefined}>{item.phone ?? '—'}</td><td title={item.position ?? undefined}>{item.position ?? '—'}</td>
              <td><span className="employee-type-badge">{getEmployeeTypeLabel(item.employeeType)}</span></td><td>{getEmployeeStatusLabel(item.employmentStatus)}</td>
              <td>{formatEmployeeDate(item.birthDate)}</td><td title={item.workScheduleCustom ?? undefined}>{getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom)}</td>
              <td title={item.workTimeText ?? undefined}>{item.workTimeText ?? '—'}</td><td>{formatEmployeeRate(item.baseDailyRate)}</td><td title={item.currentObjects.map((object) => object.name).join(', ') || undefined}><div className="employee-object-chips">
                {item.currentObjects.length ? item.currentObjects.map((object) => <span key={object.id}>{object.name}</span>) : '—'}</div></td>
              <td title={new Date(item.updatedAt).toLocaleString('ru-RU')}>{formatRegistryDate(item.updatedAt)}</td>
              <td className="registry-open-cell"><RegistryOpenLink href={`/employees/${item.id}`} label={`Открыть сотрудника ${item.fullName}`} /></td></tr>)}</tbody></DataTable>
              <div className="employee-mobile-list">{result.items.map((item) => <Link key={item.id} href={`/employees/${item.id}`} className="page-card employee-mobile-card">
                <div className="section-header"><div><strong>{item.fullName}</strong><div className="page-muted">{item.position ?? 'Должность не указана'}</div></div>
                  <span className="employee-type-badge">{getEmployeeTypeLabel(item.employeeType)}</span></div>
                <div className="employee-mobile-card__meta"><span>{item.phone ?? 'Телефон не указан'}</span><span>{getEmployeeStatusLabel(item.employmentStatus)}</span>
                  <span>{getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom)}</span>
                  <span>Паспорт: {item.passportReceived ? 'получен' : 'не получен'}</span>
                  <span>Договор: {item.contractReceived ? 'получен' : 'не получен'}</span></div>
                <div className="employee-object-chips">{item.currentObjects.length ? item.currentObjects.map((object) => <span key={object.id}>{object.name}</span>) : <span>Без объекта</span>}</div>
              </Link>)}</div></>}

          <div className={styles.pagination}>
          <TablePagination page={result.page} totalPages={result.totalPages} pending={isLoading} label="Страницы сотрудников"
            summary={result.total > 0 ? `Показано ${firstItem}–${lastItem} из ${result.total}` : 'Сотрудники не найдены'}
            onPageChange={(nextPage) => replaceQuery({ page: String(nextPage) })}
            beforeNavigation={<SearchableSelect label="На странице" value={String(limit)} clearable={false}
              options={[25, 50, 100].map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(value) => replaceQuery({ limit: value === String(DEFAULT_LIMIT) ? null : value, page: null })} />} />
          </div>
        </div>
      )}</>
  );
}
