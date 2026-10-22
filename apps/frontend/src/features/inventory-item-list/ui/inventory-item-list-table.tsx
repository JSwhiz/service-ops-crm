'use client';

import Link from 'next/link';
import React from 'react';

import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryOpenLink } from '@/shared/ui/data-table/registry-open-link';

export function InventoryItemListTable({
  items,
}: {
  items: InventoryItem[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="ui-empty-state">Номенклатура пока не заведена.</div>;
  }

  return (
    <DataTable label="Таблица номенклатуры" className="data-table">
        <thead>
          <tr>
            <th scope="col">Номенклатура</th>
            <th scope="col">Категория</th>
            <th scope="col">Ед.</th>
            <th scope="col">Остаток</th>
            <th scope="col">Макс. цена поставки</th>
            <th scope="col">Оценка</th>
            <th scope="col">Статус</th>
            <th scope="col">Движений</th>
            <th scope="col" aria-label="Открыть карточку номенклатуры" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
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
              <td>{item.isActive ? 'Активна' : 'Удалена'}</td>
              <td>{item.summary.movementsCount}</td>
              <td className="registry-open-cell"><RegistryOpenLink href={`/inventory/${item.id}`} label={`Открыть ${item.name}`} /></td>
            </tr>
          ))}
        </tbody>
    </DataTable>
  );
}
