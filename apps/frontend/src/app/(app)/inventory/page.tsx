'use client';

import Link from 'next/link';
import React, { useDeferredValue, useEffect, useState } from 'react';

import { listInventoryItems } from '@/entities/inventory/api/inventory-client';
import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { InventoryItemListTable } from '@/features/inventory-item-list/ui/inventory-item-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function InventoryPage(): React.JSX.Element {
  const { user } = useAuth();
  const canAccessInventory = user?.capabilities?.canAccessInventory ?? false;
  const canManageInventoryCatalog =
    user?.capabilities?.canManageInventoryCatalog ?? false;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'archived'>(
    'active',
  );
  const [sortBy, setSortBy] = useState<
    'name' | 'category' | 'unit' | 'currentUnitPrice' | 'updatedAt'
  >('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessInventory) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listInventoryItems({
          ...(deferredSearch.trim() ? { search: deferredSearch.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(activeFilter === 'all'
            ? {}
            : { isActive: activeFilter === 'active' }),
          page,
          limit: 25,
          sortBy,
          sortDirection,
        });

        if (!cancelled) {
          setItems(response.items);
          setTotal(response.total);
          setTotalPages(response.totalPages);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось загрузить реестр расходников.'),
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
  }, [
    activeFilter,
    canAccessInventory,
    category,
    deferredSearch,
    page,
    sortBy,
    sortDirection,
  ]);

  return (
    <>
      <PageTitle title="Расходники" />

      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div className="page-stack">
          <div className="page-card" style={{ display: 'grid', gap: 14 }}>
            <div className="section-header">
              <div>
                <div className="section-title">Каталог</div>
                <div className="page-muted">Найдено позиций: {total}</div>
              </div>
              <div className="action-row">
                {canManageInventoryCatalog ? (
                  <Link href="/inventory/new">
                    <button type="button">Новая позиция</button>
                  </Link>
                ) : null}
                <Link href="/inventory/movements">
                  <button type="button" className="button-secondary">
                    Движения
                  </button>
                </Link>
                <Link href="/inventory/reports">
                  <button type="button" className="button-secondary">
                    Отчеты
                  </button>
                </Link>
              </div>
            </div>

            <div className="detail-grid">
              <label>
                <div className="detail-label">Поиск</div>
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Название, категория или единица"
                />
              </label>
              <label>
                <div className="detail-label">Категория</div>
                <input
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Точное название категории"
                />
              </label>
              <label>
                <div className="detail-label">Статус</div>
                <select
                  value={activeFilter}
                  onChange={(event) => {
                    setActiveFilter(
                      event.target.value as 'all' | 'active' | 'archived',
                    );
                    setPage(1);
                  }}
                >
                  <option value="active">Активные</option>
                  <option value="archived">Архивные</option>
                  <option value="all">Все</option>
                </select>
              </label>
              <label>
                <div className="detail-label">Сортировка</div>
                <select
                  value={sortBy}
                  onChange={(event) => {
                    setSortBy(
                      event.target.value as
                        | 'name'
                        | 'category'
                        | 'unit'
                        | 'currentUnitPrice'
                        | 'updatedAt',
                    );
                    setPage(1);
                  }}
                >
                  <option value="name">Название</option>
                  <option value="category">Категория</option>
                  <option value="unit">Единица измерения</option>
                  <option value="currentUnitPrice">Максимальная цена</option>
                  <option value="updatedAt">Дата изменения</option>
                </select>
              </label>
              <label>
                <div className="detail-label">Направление</div>
                <select
                  value={sortDirection}
                  onChange={(event) => {
                    setSortDirection(event.target.value as 'asc' | 'desc');
                    setPage(1);
                  }}
                >
                  <option value="asc">По возрастанию</option>
                  <option value="desc">По убыванию</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {error}
            </div>
          ) : (
            <InventoryItemListTable items={items} />
          )}

          {totalPages > 1 ? (
            <div className="page-card pagination-row">
              <button
                type="button"
                className="button-secondary"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Назад
              </button>
              <span className="page-muted">
                Страница {page} из {totalPages}
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((current) => current + 1)}
              >
                Далее
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
