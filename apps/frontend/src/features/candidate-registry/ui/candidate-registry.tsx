'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import {
  listCandidateManagers,
  listCandidates,
} from '@/entities/candidate/api/candidate-client';
import {
  CANDIDATE_SLA_OPTIONS,
  CANDIDATE_STATUS_OPTIONS,
  CANDIDATE_TYPE_OPTIONS,
  candidateActiveAssignments,
  candidateAssignmentSla,
  candidatePhones,
  candidateSlaLabel,
  candidateStatusLabel,
  candidateTypeLabel,
} from '@/entities/candidate/lib/candidate-presentation';
import type {
  CandidateArchiveState,
  CandidateListResponse,
  CandidateSlaState,
  CandidateStatus,
  CandidateType,
} from '@/entities/candidate/model/candidate.types';
import { useAuth } from '@/shared/auth/use-auth';
import { formatRegistryDate } from '@/shared/lib/registry-presentation';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import type {
  ActiveRegistryFilter,
  AvailableRegistryFilter,
} from '@/shared/ui/registry-filters/registry-toolbar';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryOpenLink } from '@/shared/ui/data-table/registry-open-link';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import styles from './candidate-fields.module.css';
import { Alert, Badge, ButtonLink, Surface } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';
import registryStyles from '@/features/candidate-registry/ui/candidate-registry.module.css';

const EMPTY: CandidateListResponse = {
  items: [],
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,
};

const ARCHIVE_FILTER_OPTIONS = [
  { value: 'active', label: 'Активные' },
  { value: 'archived', label: 'В архиве' },
];

export function CandidateRegistry({
  fixedType,
}: {
  fixedType?: CandidateType;
}): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sequenceRef = useRef(0);
  const q = searchParams.get('q') ?? '';
  const type =
    fixedType ??
    (searchParams.get('candidateType') as CandidateType | null) ??
    '';
  const status = (searchParams.get('status') as CandidateStatus | null) ?? '';
  const managerUserId = searchParams.get('managerUserId') ?? '';
  const slaState =
    (searchParams.get('slaState') as CandidateSlaState | null) ?? '';
  // Without an explicit filter the registry shows active and archived cards together.
  const archiveParam = searchParams.get('archiveState');
  const archiveFilter: Exclude<CandidateArchiveState, 'all'> | '' =
    archiveParam === 'active' || archiveParam === 'archived' ? archiveParam : '';
  const archiveState: CandidateArchiveState = fixedType
    ? 'active'
    : archiveFilter || 'all';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(25);
  const [search, setSearch] = useState(q);
  const [manager, setManager] = useState<SearchableSelectOption | null>(null);
  const [managerFilterActive, setManagerFilterActive] = useState(
    Boolean(managerUserId),
  );
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const canAccess = user?.capabilities?.canAccessCandidates ?? false;
  const canManage = user?.capabilities?.canManageCandidates ?? false;
  const scope = searchParams.get('scope') === 'all' ? 'all' : searchParams.get('scope') === 'mine' ? 'mine' : canManage ? 'all' : 'mine';

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
  useEffect(
    () => setManagerFilterActive(Boolean(managerUserId)),
    [managerUserId],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = search.trim();
      if (value !== q) replaceQuery({ q: value || null, page: null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, search]);
  useEffect(() => {
    if (!managerUserId) {
      setManager(null);
      return;
    }
    let active = true;
    void listCandidateManagers({ selectedId: managerUserId })
      .then(([item]) => {
        if (active)
          setManager(
            item
              ? {
                  value: item.id,
                  label: item.fullName || item.login,
                  description: `@${item.login}`,
                  searchText: item.login,
                }
              : null,
          );
      })
      .catch(() => {
        if (active) setManager(null);
      });
    return () => {
      active = false;
    };
  }, [managerUserId]);
  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    const sequence = ++sequenceRef.current;
    setLoading(true);
    setError(null);
    void listCandidates({
      scope,
      q: q || undefined,
      candidateType: type || undefined,
      status: status || undefined,
      managerUserId: managerUserId || undefined,
      slaState: slaState || undefined,
      archiveState,
      page,
      limit: pageSize,
    })
      .then((next) => {
        if (sequence === sequenceRef.current) setResult(next);
      })
      .catch(() => {
        if (sequence === sequenceRef.current)
          setError('Не удалось загрузить кандидатов.');
      })
      .finally(() => {
        if (sequence === sequenceRef.current) setLoading(false);
      });
  }, [archiveState, canAccess, managerUserId, page, pageSize, q, scope, slaState, status, type]);

  const activeRegistryFilters = [
    {
      id: 'scope', label: 'Кандидаты', value: scope,
      options: [{ value: 'mine', label: 'Мои' }, { value: 'all', label: 'Все' }],
      onChange: (value: string) => replaceQuery({ scope: value, page: null }),
      onRemove: () => replaceQuery({ scope: null, page: null }),
    },
    !fixedType && type
      ? {
          id: 'type',
          label: 'Тип',
          value: type,
          options: CANDIDATE_TYPE_OPTIONS,
          onChange: (value: string) =>
            replaceQuery({ candidateType: value || null, page: null }),
          onRemove: () => replaceQuery({ candidateType: null, page: null }),
        }
      : null,
    status
      ? {
          id: 'status',
          label: 'Статус',
          value: status,
          options: CANDIDATE_STATUS_OPTIONS,
          onChange: (value: string) =>
            replaceQuery({ status: value || null, page: null }),
          onRemove: () => replaceQuery({ status: null, page: null }),
        }
      : null,
    managerFilterActive
      ? {
          id: 'manager',
          label: 'Менеджер',
          value: managerUserId,
          options: manager
            ? [{ value: managerUserId, label: manager.label }]
            : [],
          onChange: (value: string) =>
            replaceQuery({ managerUserId: value || null, page: null }),
          onRemove: () => {
            replaceQuery({ managerUserId: null, page: null });
            setManagerFilterActive(false);
          },
          customControl: (
            <SearchableSelect
              label="Менеджер"
              hideLabel
              value={managerUserId}
              selectedOption={manager}
              options={[]}
              placeholder="Все менеджеры"
              minimumSearchLength={2}
              searchPlaceholder="Введите ФИО или логин"
              searchPromptText="Введите не менее 2 символов, чтобы найти менеджера"
              searchInputVariant="registry"
              onChange={(value) =>
                replaceQuery({ managerUserId: value || null, page: null })
              }
              asyncSearch={async (value) =>
                (await listCandidateManagers({ q: value })).map((item) => ({
                  value: item.id,
                  label: item.fullName || item.login,
                  description: `@${item.login}`,
                  searchText: item.login,
                }))
              }
            />
          ),
        }
      : null,
    slaState
      ? {
          id: 'sla',
          label: 'SLA',
          value: slaState,
          options: CANDIDATE_SLA_OPTIONS,
          onChange: (value: string) =>
            replaceQuery({ slaState: value || null, page: null }),
          onRemove: () => replaceQuery({ slaState: null, page: null }),
        }
      : null,
    !fixedType && archiveFilter
      ? {
          id: 'archive',
          label: 'Архив',
          value: archiveFilter,
          options: ARCHIVE_FILTER_OPTIONS,
          onChange: (value: string) =>
            replaceQuery({ archiveState: value || null, page: null }),
          onRemove: () => replaceQuery({ archiveState: null, page: null }),
        }
      : null,
  ].filter(Boolean) as ActiveRegistryFilter[];
  const availableRegistryFilters = [
    !fixedType && !type
      ? {
          id: 'type',
          label: 'Тип',
          options: CANDIDATE_TYPE_OPTIONS,
          onAdd: (value: string) =>
            replaceQuery({ candidateType: value, page: null }),
        }
      : null,
    !status
      ? {
          id: 'status',
          label: 'Статус',
          options: CANDIDATE_STATUS_OPTIONS,
          onAdd: (value: string) => replaceQuery({ status: value, page: null }),
        }
      : null,
    !managerFilterActive
      ? {
          id: 'manager',
          label: 'Менеджер',
          options: [{ value: 'manager', label: 'Выбрать менеджера' }],
          onAdd: () => setManagerFilterActive(true),
        }
      : null,
    !slaState
      ? {
          id: 'sla',
          label: 'SLA',
          options: CANDIDATE_SLA_OPTIONS,
          onAdd: (value: string) =>
            replaceQuery({ slaState: value, page: null }),
        }
      : null,
    !fixedType && !archiveFilter
      ? {
          id: 'archive',
          label: 'Архив',
          options: ARCHIVE_FILTER_OPTIONS,
          onAdd: (value: string) =>
            replaceQuery({ archiveState: value, page: null }),
        }
      : null,
  ].filter(Boolean) as AvailableRegistryFilter[];
  useEffect(() => {
    if (
      !result.items.some((item) =>
        candidateActiveAssignments(item).some(
          (assignment) => !assignment.firstRespondedAt,
        ),
      )
    )
      return;
    const timer = window.setInterval(
      () => setClock((value) => value + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [result.items]);

  if (!canAccess)
    return <Surface padding="md">У вас нет доступа к кандидатам.</Surface>;
  return (
    <div className="candidate-registry ui-page">
      <RegistryToolbar
        searchValue={search}
        searchLabel="Поиск по кандидатам"
        searchPlaceholder="ФИО или телефон"
        onSearchChange={setSearch}
        activeFilters={activeRegistryFilters}
        availableFilters={availableRegistryFilters}
        actions={
          canManage && !fixedType ? (
            <ButtonLink variant="primary" icon={<PlusIcon />} href="/candidates/new">
              Добавить кандидата
            </ButtonLink>
          ) : null
        }
      />
      {loading ? (
        <div className="ui-empty-state">
          Загрузка...
        </div>
      ) : error ? (
        <Alert tone="warning">
          {error}
        </Alert>
      ) : result.items.length === 0 ? (
        <div className="ui-empty-state">
          Кандидаты не найдены.
        </div>
      ) : (
        <>
          <DataTable
            label="Таблица кандидатов"
            className={`data-table ${registryStyles.candidateTable}`}
            frameClassName={registryStyles.candidateTableWrap}
          >
            <thead>
              <tr>
                <th>Кандидат</th>
                <th>Тип / стадия</th>
                <th>Объект</th>
                <th>Ответственные менеджеры</th>
                <th>Последняя обратная связь</th>
                <th>SLA</th>
                <th>Изменён</th>
                <th aria-label="Открыть" />
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/candidates/${item.id}`}>{item.fullName}</Link>
                    {item.deletedAt ? (
                      <Badge className={styles.archivedBadge}>В архиве</Badge>
                    ) : null}
                    {candidatePhones(item).length ? (
                      <div className={`ui-text-muted ${styles.phonePreview}`}>
                        <span>{candidatePhones(item)[0]}</span>
                        {candidatePhones(item).length > 1 ? (
                          <span className={styles.phoneCount}>
                            ещё {candidatePhones(item).length - 1}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="ui-text-muted">Телефон не указан</div>
                    )}
                  </td>
                  <td>
                    <div>{candidateTypeLabel(item.candidateType)}</div>
                    <div className="ui-text-muted">
                      {candidateStatusLabel(item.status)}
                    </div>
                  </td>
                  <td>
                    {item.object ? (
                      <>
                        <div>{item.object.name}</div>
                        <div className="ui-text-muted">
                          {[item.object.internalName, item.object.address]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </>
                    ) : (
                      <span className="ui-text-muted">Не назначен</span>
                    )}
                  </td>
                  <td>
                    {candidateActiveAssignments(item).length ? (
                      candidateActiveAssignments(item).map((assignment) => (
                        <div key={assignment.id} className={styles.assignment}>
                          <span>
                            {assignment.manager.fullName ||
                              assignment.manager.login}
                          </span>
                          <span className="ui-text-muted">
                            {assignment.object?.name ??
                              'Без объекта рассмотрения'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="ui-text-muted">Не назначены</span>
                    )}
                  </td>
                  <td>
                    {item.latestFeedback ? (
                      <>
                        <div>
                          {item.latestFeedback.text.length > 120
                            ? `${item.latestFeedback.text.slice(0, 120)}…`
                            : item.latestFeedback.text}
                        </div>
                        <div className="ui-text-muted">
                          {item.latestFeedback.author.fullName} ·{' '}
                          {new Date(
                            item.latestFeedback.createdAt,
                          ).toLocaleString('ru-RU')}
                        </div>
                      </>
                    ) : (
                      <span className="ui-text-muted">Пока нет</span>
                    )}
                  </td>
                  <td>
                    {candidateActiveAssignments(item).length
                      ? candidateActiveAssignments(item).map((assignment) => (
                          <div
                            key={assignment.id}
                            className={styles.assignment}
                          >
                            <span className="ui-text-muted">
                              {assignment.manager.fullName ||
                                assignment.manager.login}
                            </span>
                            <span
                              className={
                                styles[candidateAssignmentSla(assignment)]
                              }
                            >
                              {candidateSlaLabel(
                                candidateAssignmentSla(assignment),
                                assignment.responseDueAt,
                              )}
                            </span>
                          </div>
                        ))
                      : candidateSlaLabel('unassigned')}
                  </td>
                  <td title={new Date(item.updatedAt).toLocaleString('ru-RU')}>
                    {formatRegistryDate(item.updatedAt)}
                  </td>
                  <td className="registry-open-cell">
                    <RegistryOpenLink
                      href={`/candidates/${item.id}`}
                      label={`Открыть кандидата ${item.fullName}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className={registryStyles.candidateMobileList}>
            {result.items.map((item) => (
              <Link
                key={item.id}
                href={`/candidates/${item.id}`}
                className={`ui-surface ui-surface--padded ${registryStyles.candidateMobileCard}`}
              >
                <div className="ui-section-header">
                  <strong>{item.fullName}</strong>
                  <span>{candidateStatusLabel(item.status)}</span>
                </div>
                <div>
                  {candidateTypeLabel(item.candidateType)} ·{' '}
                  {item.object?.name ?? 'Объект не назначен'}
                </div>
                <div>
                  <span className={styles.phones}>
                    {candidatePhones(item).map((phone, index) => (
                      <span key={index}>{phone}</span>
                    ))}
                  </span>
                  {candidateActiveAssignments(item).length
                    ? candidateActiveAssignments(item).map((assignment) => (
                        <div key={assignment.id} className={styles.assignment}>
                          <span>
                            {assignment.manager.fullName ||
                              assignment.manager.login}{' '}
                            ·{' '}
                            {assignment.object?.name ??
                              'Без объекта рассмотрения'}
                          </span>
                          <span
                            className={
                              styles[candidateAssignmentSla(assignment)]
                            }
                          >
                            {candidateSlaLabel(
                              candidateAssignmentSla(assignment),
                              assignment.responseDueAt,
                            )}
                          </span>
                        </div>
                      ))
                    : 'Менеджеры не назначены'}
                </div>
                {item.latestFeedback ? (
                  <div className="ui-text-muted">
                    {item.latestFeedback.text.length > 90
                      ? `${item.latestFeedback.text.slice(0, 90)}…`
                      : item.latestFeedback.text}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
      {!loading && !error ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          label="Страницы кандидатов"
          summary={
            result.total > 0
              ? `Показано ${(page - 1) * result.limit + 1}–${Math.min(page * result.limit, result.total)} из ${result.total}`
              : 'Кандидаты не найдены'
          }
          onPageChange={(nextPage) => replaceQuery({ page: String(nextPage) })}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageSizeChange={setPageSize}
        />
      ) : null}
    </div>
  );
}
