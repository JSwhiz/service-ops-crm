'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { OneTimeOrderListTable } from '@/features/one-time-order-list/ui/one-time-order-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import {
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function OneTimeOrdersPage(): React.JSX.Element {
  const { user } = useAuth();
  const canCreateOneTimeOrder =
    user?.capabilities?.canCreateOneTimeOrder ?? false;

  const [items, setItems] = useState<OneTimeOrderItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listOneTimeOrders({
          search: search || undefined,
          status: status || undefined,
        });

        if (!cancelled) {
          setItems(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось загрузить разовые заказы.'),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [search, status]);

  return (
    <>
      <PageTitle title="Разовые заказы" />

      <div className="page-card">
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            alignItems: 'end',
          }}
        >
          <label>
            <div style={{ marginBottom: 6 }}>Поиск</div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: '100%', padding: 10 }}
              placeholder="Название, адрес, контакт"
            />
          </label>

          <label>
            <div style={{ marginBottom: 6 }}>Статус</div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              style={{ width: '100%', padding: 10 }}
            >
              <option value="">Все статусы</option>
              {ONE_TIME_ORDER_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {canCreateOneTimeOrder ? (
            <div>
              <Link href="/one-time-orders/new">
                <button type="button">Создать заказ</button>
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <OneTimeOrderListTable items={items} />
      )}
    </>
  );
}
