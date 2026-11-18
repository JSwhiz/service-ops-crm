'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { listWorkforceSubstitutions, type WorkforceSubstitutionPage } from '@/entities/workforce-substitution/api/workforce-substitution-client';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { formatUiDate } from '@/shared/lib/format-date';
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader, Surface } from '@/shared/ui/foundation';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import styles from './workforce-substitution-list.module.css';

const statuses: Record<string, string> = { planned: 'Запланирована', active: 'Действует', completed: 'Завершена', cancelled: 'Отменена' };
type Result = { key: string; data?: WorkforceSubstitutionPage; error?: string };

export function WorkforceSubstitutionList(): React.JSX.Element {
  const params = useSearchParams();
  const objectId = params.get('objectId') || undefined;
  const revision = useAccessRevision();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([revision, objectId, q, from, to, page, limit, retry]);
  const current = result?.key === key ? result : null;
  useEffect(() => { setPage(1); }, [objectId, revision]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void listWorkforceSubstitutions({ objectId, q, from, to, page, limit }, controller.signal)
        .then((data) => { if (active) setResult({ key, data }); })
        .catch((error: unknown) => {
          if (active) setResult({ key, error: error instanceof Error ? error.message : 'Не удалось загрузить кадровые подмены.' });
        });
    }, 200);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [key, objectId, q, from, to, page, limit]);

  return <div className={styles.page}>
    <PageHeader title="Кадровые подмены" description="Сотрудники, периоды и объекты в доступной вам области. Только просмотр." />
    <RegistryToolbar searchValue={q} searchLabel="Поиск кадровых подмен" searchPlaceholder="ФИО сотрудника или название объекта"
      onSearchChange={(value) => { setQ(value); setPage(1); }} activeFilters={[]} availableFilters={[]} />
    <Surface padding="md">
      <div className={styles.filters}>
        <Field label="Период с"><DatePicker value={from} max={to || undefined} onChange={(value) => { setFrom(value); setPage(1); }} /></Field>
        <Field label="Период по"><DatePicker value={to} min={from || undefined} onChange={(value) => { setTo(value); setPage(1); }} /></Field>
        <Field label="Записей на странице"><Select value={String(limit)} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}>
          <option value="25">25</option><option value="50">50</option>
        </Select></Field>
      </div>
      {objectId ? <p>Показаны подмены выбранного объекта.</p> : null}
    </Surface>
    {!current ? <LoadingState label="Загрузка кадровых подмен…" /> : current.error ? <Alert tone="warning" role="alert">
      <p>{current.error}</p><Button onClick={() => setRetry((value) => value + 1)}>Проверить доступ и повторить</Button>
    </Alert> : current.data ? <>
      {!current.data.items.length ? <EmptyState title="Подмены не найдены" description="В доступной области нет записей, подходящих под выбранные условия." /> :
        <ul className={styles.list} aria-label="Кадровые подмены">{current.data.items.map((item) => <li key={item.id}>
          <Surface padding="md">
            <div className={styles.row}>
              <div className={styles.names}><strong>{item.substituteEmployeeName}</strong><span>Подменяет: {item.employeeName}</span></div>
              <Badge>{statuses[item.status] || 'Статус не определён'}</Badge>
            </div>
            <div className={styles.details}>
              <span>{formatUiDate(item.startDate, { timeZone: 'Europe/Moscow' })} — {item.endDate ? formatUiDate(item.endDate, { timeZone: 'Europe/Moscow' }) : 'Без окончания'}</span>
              {item.object.canView ? <Link href={`/objects/${item.object.id}`}>{item.object.name}</Link> : <span>{item.object.name}</span>}
            </div>
          </Surface>
        </li>)}</ul>}
      <TablePagination page={current.data.page} totalPages={current.data.totalPages} onPageChange={setPage}
        summary={`Найдено: ${current.data.total}`} label="Страницы кадровых подмен" />
    </> : null}
  </div>;
}
