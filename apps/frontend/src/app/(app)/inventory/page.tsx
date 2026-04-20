'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

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
  const [category, setCategory] = useState('');
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
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
        });

        if (!cancelled) {
          setItems(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(
              loadError,
              'Не удалось загрузить реестр расходников.',
            ),
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
  }, [canAccessInventory, search, category]);

  const totalItems = items.length;
  const totalActiveItems = items.filter((item) => item.isActive).length;

  return (
    <>
      <PageTitle title="Расходники" />

      {!canAccessInventory ? (
        <div className="page-card">У вас нет доступа к inventory-модулю.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label>
                <div style={{ marginBottom: 6 }}>Поиск</div>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                  placeholder="Название или категория"
                />
              </label>
              <label>
                <div style={{ marginBottom: 6 }}>Категория</div>
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                  placeholder="Например, Моющие средства"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canManageInventoryCatalog ? (
                <Link href="/inventory/new">
                  <button type="button">Новая позиция</button>
                </Link>
              ) : null}
              <Link href="/inventory/movements">
                <button type="button">Движения</button>
              </Link>
              <Link href="/inventory/reports">
                <button type="button">Отчеты</button>
              </Link>
            </div>

            <div className="page-muted">
              Всего позиций: {totalItems} • Активных: {totalActiveItems}
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
        </div>
      )}
    </>
  );
}
