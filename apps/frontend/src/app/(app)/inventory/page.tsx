'use client';

import React, { useDeferredValue, useEffect, useState } from 'react';

import { listInventoryItems } from '@/entities/inventory/api/inventory-client';
import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { InventoryItemListTable } from '@/features/inventory-item-list/ui/inventory-item-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { Alert, ButtonLink } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';

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
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(25, [25, 50, 100], () => setPage(1));
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
          limit: pageSize,
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
    pageSize,
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
      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div className="page-stack workspace-page inventory-workspace">
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
            actions={<>
              {canViewInventoryReports ? <>
                <ButtonLink href="/inventory/movements">Движения</ButtonLink>
                <ButtonLink href="/inventory/reports">Отчёты</ButtonLink>
              </> : null}
              {canManageInventoryCatalog ? <ButtonLink variant="primary" icon={<PlusIcon />} href="/inventory/new">Добавить позицию</ButtonLink> : null}
            </>}
          />

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : (
            <InventoryItemListTable items={items} />
          )}

          <TablePagination page={page} totalPages={totalPages} pending={isLoading} label="Страницы расходников"
            summary={total > 0 ? `Показано ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} из ${total}` : 'Расходники не найдены'}
            onPageChange={(nextPage) => setPage(nextPage)}
            pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={setPageSize} />
        </div>
      )}
    </>
  );
}
