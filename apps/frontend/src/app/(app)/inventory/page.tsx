'use client';

import Link from 'next/link';
import React, { useDeferredValue, useEffect, useState } from 'react';

import { listInventoryItems } from '@/entities/inventory/api/inventory-client';
import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { InventoryItemListTable } from '@/features/inventory-item-list/ui/inventory-item-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';

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
  const canViewInventoryReports =
    user?.capabilities?.canViewInventoryReports ?? false;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState('');
  const [categoryFilterActive, setCategoryFilterActive] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'deleted'>(
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

  const statusOptions = [
    { value: 'active', label: 'Активные' },
    { value: 'deleted', label: 'Удалённые' },
    { value: 'all', label: 'Все' },
  ];
  const sortOptions = [
    { value: 'name', label: 'Название' },
    { value: 'category', label: 'Категория' },
    { value: 'unit', label: 'Единица измерения' },
    { value: 'currentUnitPrice', label: 'Максимальная цена' },
    { value: 'updatedAt', label: 'Дата изменения' },
  ];

  return (
    <>
      <PageTitle title="Расходники" />

      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div className="page-stack workspace-page inventory-workspace">
          <div className="page-card workspace-surface registry-header" style={{ display: 'grid', gap: 14 }}>
            <div className="section-header">
              <div><div className="section-title">Каталог</div><div className="page-muted">Найдено позиций: {total}</div></div>
              <div className="action-row">
                {canManageInventoryCatalog ? (
                  <Link href="/inventory/new">
                    <button type="button">Новая позиция</button>
                  </Link>
                ) : null}
                {canViewInventoryReports ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </div>
            <RegistryToolbar
              searchValue={search}
              searchLabel="Поиск по расходникам"
              searchPlaceholder="Название, категория или единица"
              onSearchChange={(value) => { setSearch(value); setPage(1); }}
              activeFilters={[
                categoryFilterActive ? { id: 'category', label: 'Категория', value: category, options: [{ value: '', label: 'Название категории' }], onChange: (value: string) => { setCategory(value); setPage(1); }, onRemove: () => { setCategory(''); setCategoryFilterActive(false); setPage(1); }, customControl: <input aria-label="Точное название категории" placeholder="Название категории" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} /> } : null,
                activeFilter !== 'all' ? { id: 'status', label: 'Статус', value: activeFilter, options: statusOptions, onChange: (value: string) => { setActiveFilter(value as 'all' | 'active' | 'deleted'); setPage(1); }, onRemove: () => { setActiveFilter('all'); setPage(1); } } : null,
                sortBy !== 'name' ? { id: 'sort', label: 'Сортировка', value: sortBy, options: sortOptions, onChange: (value: string) => { setSortBy(value as typeof sortBy); setPage(1); }, onRemove: () => { setSortBy('name'); setPage(1); } } : null,
                sortDirection !== 'asc' ? { id: 'direction', label: 'Порядок', value: sortDirection, options: [{ value: 'asc', label: 'По возрастанию' }, { value: 'desc', label: 'По убыванию' }], onChange: (value: string) => { setSortDirection(value as 'asc' | 'desc'); setPage(1); }, onRemove: () => { setSortDirection('asc'); setPage(1); } } : null,
              ].filter((filter): filter is NonNullable<typeof filter> => filter !== null)}
              availableFilters={[
                !categoryFilterActive ? { id: 'category', label: 'Категория', options: [{ value: '', label: 'Название категории' }], onAdd: () => { setCategoryFilterActive(true); setPage(1); } } : null,
                activeFilter === 'all' ? { id: 'status', label: 'Статус', options: statusOptions.filter((option) => option.value !== 'all'), onAdd: (value: string) => { setActiveFilter(value as 'all' | 'active' | 'deleted'); setPage(1); } } : null,
                sortBy === 'name' ? { id: 'sort', label: 'Сортировка', options: sortOptions.filter((option) => option.value !== 'name'), onAdd: (value: string) => { setSortBy(value as typeof sortBy); setPage(1); } } : null,
                sortDirection === 'asc' ? { id: 'direction', label: 'Порядок', options: [{ value: 'desc', label: 'По убыванию' }], onAdd: (value: string) => { setSortDirection(value as 'asc' | 'desc'); setPage(1); } } : null,
              ].filter((filter): filter is NonNullable<typeof filter> => filter !== null)}
            />
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
