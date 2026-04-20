'use client';

import React, { useEffect, useState } from 'react';

import {
  listInventoryItems,
  listInventoryMovements,
} from '@/entities/inventory/api/inventory-client';
import type {
  InventoryItem,
  InventoryMovement,
} from '@/entities/inventory/model/inventory.types';
import { InventoryItemListTable } from '@/features/inventory-item-list/ui/inventory-item-list-table';
import { InventoryMovementList } from '@/features/inventory-movement-list/ui/inventory-movement-list';
import { InventoryReportSummary } from '@/features/inventory-report/ui/inventory-report-summary';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function InventoryReportsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canAccessInventory = user?.capabilities?.canAccessInventory ?? false;
  const canViewInventoryReports =
    user?.capabilities?.canViewInventoryReports ?? false;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessInventory || !canViewInventoryReports) {
      setItems([]);
      setMovements([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const [loadedItems, loadedMovements] = await Promise.all([
          listInventoryItems(),
          listInventoryMovements(),
        ]);

        if (!cancelled) {
          setItems(loadedItems);
          setMovements(loadedMovements);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось загрузить inventory-отчеты.'),
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
  }, [canAccessInventory, canViewInventoryReports]);

  return (
    <>
      <PageTitle title="Отчеты по расходникам" />

      {!canAccessInventory || !canViewInventoryReports ? (
        <div className="page-card">У вас нет доступа к inventory-отчетам.</div>
      ) : isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <InventoryReportSummary
            totalItems={items.length}
            totalActiveItems={items.filter((item) => item.isActive).length}
            movementCount={movements.length}
          />
          <InventoryItemListTable items={items} />
          <InventoryMovementList items={movements.slice(0, 20)} />
        </div>
      )}
    </>
  );
}
