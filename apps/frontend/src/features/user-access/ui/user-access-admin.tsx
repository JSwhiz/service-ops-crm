'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getAccessCatalog, listAccessUsers } from '@/entities/user-access/api/user-access-client';
import type { AccessCatalog, AccessPage, AccessUser } from '@/entities/user-access/model/user-access.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserRoleLabel } from '@/shared/lib/display-name';
import { Alert, Button, ButtonLink, EmptyState, LoadingState, PageHeader, Surface } from '@/shared/ui/foundation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { accessError } from './access-presentation';
import { UserAccessDialog } from './user-access-dialog';
import styles from './user-access.module.css';

/** Guard precedes every admin consumer, including catalog loading. */
export function UserAccessAdmin(): React.JSX.Element {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Проверка доступа…" />;
  const founder = user?.roleCode === 'founder' || user?.roleCodes.includes('founder');
  if (!founder || !user?.capabilities?.canManageUserAccess) return <div className="ui-page">
    <PageHeader title="Пользователи и доступы" />
    <EmptyState title="Доступ закрыт" description="Управление доступами разрешено только учредителю с действующим правом администрирования." action={<ButtonLink href="/dashboard">На рабочий стол</ButtonLink>} />
  </div>;
  return <AccessRegistry />;
}

function AccessRegistry(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const [data, setData] = useState<AccessPage<AccessUser> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const close = useCallback(() => {
    setSelectedId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('user'); params.delete('accessTab');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
  }, []);
  const saved = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search);
    setQuery(initial.get('q') ?? '');
    setSelectedId(initial.get('user'));
    const initialPage = Number(initial.get('page') ?? 1);
    setPage(Number.isSafeInteger(initialPage) && initialPage > 0 ? initialPage : 1);
    const restore = (): void => {
      const params = new URLSearchParams(window.location.search);
      setQuery(params.get('q') ?? '');
      const value = Number(params.get('page') ?? 1);
      setPage(Number.isSafeInteger(value) && value > 0 ? value : 1);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (query) params.set('q', query); else params.delete('q');
      if (page > 1) params.set('page', String(page)); else params.delete('page');
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
      void Promise.all([getAccessCatalog(controller.signal), listAccessUsers(query, (page - 1) * 30, 30, controller.signal)])
        .then(([nextCatalog, result]) => {
          if (!active) return;
          setCatalog(nextCatalog); setData(result);
          if (page > 1 && !result.items.length) setPage(Math.max(1, Math.ceil(result.total / 30)));
        })
        .catch((cause: unknown) => { if (active) setError(accessError(cause)); })
        .finally(() => { if (active) setBusy(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [query, page, refresh]);

  return <div className="ui-page">
    <PageHeader title="Пользователи и доступы" description="Персональные правила, действующие источники доступа и история изменений пользователей CRM." />
    <RegistryToolbar searchValue={query} searchLabel="Поиск пользователей по ФИО или логину" searchPlaceholder="ФИО или логин…" onSearchChange={(value) => { setQuery(value); setPage(1); }} activeFilters={[]} availableFilters={[]} />
    {error ? <Alert tone="danger" role="alert" action={<Button onClick={saved}>Повторить загрузку</Button>}>{error}</Alert> : null}
    {!data && busy ? <LoadingState label="Загрузка пользователей…" /> : null}
    {data ? <Surface padding="none" aria-busy={busy}>
      {data.items.length ? <DataTable label="Пользователи CRM">
        <thead><tr><th scope="col">Пользователь</th><th scope="col">Роли</th><th scope="col">Активность</th><th scope="col">Действие</th></tr></thead>
        <tbody>{data.items.map((item) => <tr key={item.id}>
          <td><strong className={styles.fullName}>{item.fullName || 'Имя не указано'}</strong><span className={styles.login}>{item.login}</span></td>
          <td>{item.roleCodes.map(getUserRoleLabel).join(', ') || 'Роли не назначены'}</td>
          <td>{item.isActive ? 'Активен' : 'Неактивен'}</td>
          <td><Button size="sm" disabled={busy || !catalog} onClick={() => {
            setSelectedId(item.id);
            const params = new URLSearchParams(window.location.search);
            params.set('user', item.id);
            window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
          }} aria-label={`Открыть права: ${item.fullName || item.login}`}>Права и доступы</Button></td>
        </tr>)}</tbody>
      </DataTable> : <EmptyState title={query ? 'Пользователи не найдены' : 'Пользователей нет'} description={query ? 'Проверьте ФИО или логин.' : 'Доступные пользователи появятся в этом списке.'} action={query ? <Button onClick={() => { setQuery(''); setPage(1); }}>Сбросить поиск</Button> : undefined} />}
      <TablePagination page={page} totalPages={Math.ceil(data.total / 30)} onPageChange={setPage} pending={busy} label="Страницы пользователей" summary={`Пользователей: ${data.total}`} />
    </Surface> : null}
    {selectedId && catalog ? <UserAccessDialog key={selectedId} userId={selectedId} catalog={catalog} onClose={close} onSaved={saved} /> : null}
  </div>;
}
