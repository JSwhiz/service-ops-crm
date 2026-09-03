'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  listOneTimeOrderAttention,
  type OneTimeOrderAttentionResponse,
} from '@/entities/one-time-order/api/one-time-order-attention-client';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

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
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listOneTimeOrderAttention({ page, limit: 20 })
      .then((response) => { if (active) setResult(response); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить горящие разовые заказы.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page]);

  return (
    <div className="page-stack workspace-page one-time-order-registry">
      <PageTitle title="Разовые заказы" />
      <div className="page-card workspace-surface section-header registry-header">
        <div><div className="section-title">Операционный приоритет</div><div className="page-muted">Просроченные → сегодня → ближайшие → без даты. Доступно: {result.total}</div></div>
        <Link className="button-link" href="/one-time-orders">Снять фильтр</Link>
      </div>
      <div className="page-card workspace-surface filter-panel">
        <span className="status-pill" data-status="attention">Горящие ×</span>
        <span className="page-muted">Выборка строится на backend до пагинации и учитывает права текущего пользователя.</span>
      </div>
      {loading ? <div className="page-card workspace-surface workspace-empty">Загрузка…</div> : error ? <div className="page-card workspace-surface inline-notice inline-notice--warning">{error}</div> : result.items.length === 0 ? <div className="page-card workspace-surface workspace-empty">Горящих разовых заказов нет.</div> : (
        <div className="page-card workspace-surface data-table-shell table-scroll">
          <table className="data-table">
            <thead><tr><th>Приоритет</th><th>Заказ</th><th>Дата</th><th>Статус</th><th>Объект / адрес</th><th>Менеджеры</th><th /></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id}>
              <td><span className="status-pill">{urgency(item.executionStartDate)}</span></td>
              <td><strong>{item.title}</strong></td>
              <td>{formatDate(item.executionStartDate)}</td>
              <td>{getOneTimeOrderStatusLabel(item.status)}</td>
              <td>{item.linkedObject?.name ?? item.executionAddress}</td>
              <td>{item.managers.map((manager) => manager.fullName || manager.login).join(', ') || '—'}</td>
              <td><Link href={`/one-time-orders/${item.id}`}>Открыть</Link></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {!loading && result.totalPages > 1 ? <div className="page-card workspace-surface object-registry-pagination">
        <button type="button" disabled={page <= 1} onClick={() => router.replace(`/one-time-orders/attention?page=${page - 1}`)}>Назад</button>
        <span>Страница {result.page} из {result.totalPages}</span>
        <button type="button" disabled={page >= result.totalPages} onClick={() => router.replace(`/one-time-orders/attention?page=${page + 1}`)}>Далее</button>
      </div> : null}
    </div>
  );
}
