'use client';

import React from 'react';

import { FactStrip } from '@/shared/ui/foundation';

export function InventoryReportSummary({
  totalItems,
  totalActiveItems,
  movementCount,
  totalStockValueEstimate,
  missingPhotoBridgeCount,
}: {
  totalItems: number;
  totalActiveItems: number;
  movementCount: number;
  totalStockValueEstimate: number;
  missingPhotoBridgeCount: number;
}): React.JSX.Element {
  return (
    <FactStrip
      aria-label="Сводка по расходникам"
      items={[
        { key: 'items', label: 'Всего позиций', value: totalItems },
        { key: 'active', label: 'Активных позиций', value: totalActiveItems },
        { key: 'movements', label: 'Всего движений', value: movementCount },
        { key: 'value', label: 'Оценка остатка', value: `${totalStockValueEstimate.toLocaleString('ru-RU')} ₽` },
        { key: 'bridge', label: 'Без фото — ждут согласования', value: missingPhotoBridgeCount },
      ]}
    />
  );
}
