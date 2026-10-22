'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  listOneTimeOrderAttention,
  type OneTimeOrderAttentionResponse,
} from '@/entities/one-time-order/api/one-time-order-attention-client';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { Alert, Badge, ButtonLink, StatusBadge, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

const EMPTY: OneTimeOrderAttentionResponse = { items: [], page: 1, limit: 20, total: 0, totalPages: 0 };

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatDate(value: string | null): string {
  if (!value) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function moscowDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function urgency(value: string | null): string {
  if (!value) return 'Без даты';
  const today = moscowDate();
  if (value < today) return 'Просрочен';
  if (value === today) return 'Сегодня';
  return 'Ближайший';
}

export default function OneTimeOrderAttentionPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = parsePage(searchParams.get('page'));
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(20);
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listOneTimeOrderAttention({ page, limit: pageSize })
      .then((response) => { if (active) setResult(response); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить горящие разовые заказы.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, pageSize]);

  return (
    <div className={`ui-page ${orderStyles.oneTimeOrderRegistry}`}>
      <PageTitle title="Разовые заказы" />
      <Surface padding="md" className="ui-section-header registry-header">
        <div><div className="ui-section-title">Операционный приоритет</div><div className="ui-text-muted">Просроченные → сегодня → ближайшие → без даты. Доступно: {result.total}</div></div>
        <ButtonLink href="/one-time-orders">Снять фильтр</ButtonLink>
      </Surface>
      <Surface padding="md" className="filter-panel">
        <StatusBadge status="attention">Горящие ×</StatusBadge>
        <span className="ui-text-muted">Выборка строится на backend до пагинации и учитывает права текущего пользователя.</span>
      </Surface>
      {loading ? <div className="ui-empty-state">Загрузка…</div> : error ? <Alert tone="warning">{error}</Alert> : result.items.length === 0 ? <div className="ui-empty-state">Горящих разовых заказов нет.</div> : (
        <DataTable label="Таблица горящих разовых заказов" className="data-table" frameClassName="table-scroll">
            <thead><tr><th scope="col">Приоритет</th><th scope="col">Заказ</th><th scope="col">Дата</th><th scope="col">Статус</th><th scope="col">Объект / адрес</th><th scope="col">Менеджеры</th><th scope="col" aria-label="Действие" /></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id}>
              <td><Badge>{urgency(item.executionStartDate)}</Badge></td>
              <td><strong>{item.title}</strong></td>
              <td>{formatDate(item.executionStartDate)}</td>
              <td>{getOneTimeOrderStatusLabel(item.status)}</td>
              <td>{item.linkedObject?.name ?? item.executionAddress}</td>
              <td>{item.managers.map((manager) => manager.fullName || manager.login).join(', ') || '—'}</td>
              <td><Link href={`/one-time-orders/${item.id}`}>Открыть</Link></td>
            </tr>)}</tbody>
        </DataTable>
      )}
      {!loading ? <TablePagination page={result.page} totalPages={result.totalPages} label="Страницы заказов, требующих внимания"
        summary={result.total > 0 ? `Показано ${(result.page - 1) * result.limit + 1}–${Math.min(result.page * result.limit, result.total)} из ${result.total}` : 'Заказов не найдено'}
        onPageChange={(nextPage) => router.replace(`/one-time-orders/attention?page=${nextPage}${pageSize !== 20 ? `&limit=${pageSize}` : ''}`)}
        pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={setPageSize} /> : null}
    </div>
  );
}
