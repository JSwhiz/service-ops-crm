'use client';

import Link from 'next/link';
import React from 'react';

import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';

export function InventoryItemListTable({
  items,
}: {
  items: InventoryItem[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="page-card">Номенклатура пока не заведена.</div>;
  }

  return (
    <div className="page-card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Номенклатура</th>
            <th align="left">Категория</th>
            <th align="left">Ед.</th>
            <th align="left">Остаток</th>
            <th align="left">Цена</th>
            <th align="left">Оценка</th>
            <th align="left">Статус</th>
            <th align="left">Движений</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb' }}>
              <td style={{ padding: '12px 0' }}>
                <Link href={`/inventory/${item.id}`}>{item.name}</Link>
              </td>
              <td>{item.category}</td>
              <td>{item.unit}</td>
              <td>{formatInventoryQuantity(item.currentStock, item.unit)}</td>
              <td>
                {item.currentUnitPrice === null
                  ? '—'
                  : `${item.currentUnitPrice.toLocaleString('ru-RU')} ₽`}
              </td>
              <td>{item.currentEstimatedTotalValue.toLocaleString('ru-RU')} ₽</td>
              <td>{item.isActive ? 'Активна' : 'Неактивна'}</td>
              <td>{item.summary.movementsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
