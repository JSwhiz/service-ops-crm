'use client';

import React, { useEffect, useState } from 'react';

import {
  getInventoryReportSummary,
  listInventoryItems,
  listInventoryMovements,
} from '@/entities/inventory/api/inventory-client';
import type {
  InventoryItem,
  InventoryMovement,
  InventoryReportSummary as InventoryReportSummaryData,
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
  const [summary, setSummary] = useState<InventoryReportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessInventory || !canViewInventoryReports) {
      setItems([]);
      setMovements([]);
      setSummary(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const [loadedSummary, loadedItems, loadedMovements] = await Promise.all([
          getInventoryReportSummary(),
          listInventoryItems({ limit: 100 }),
          listInventoryMovements({ limit: 20 }),
        ]);

        if (!cancelled) {
          setSummary(loadedSummary);
          setItems(loadedItems.items);
          setMovements(loadedMovements.items);
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
          {summary ? <InventoryReportSummary {...summary} /> : null}
          <InventoryItemListTable items={items} />
          <InventoryMovementList items={movements} />
        </div>
      )}
    </>
  );
}
