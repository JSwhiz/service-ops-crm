'use client';

import Link from 'next/link';
import React from 'react';

import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';

export function EquipmentListTable({
  items,
}: {
  items: EquipmentUnit[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="page-card">Оборудование пока не заведено.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((item) => (
        <div key={item.id} className="page-card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <Link href={`/equipment/${item.id}`} style={{ fontWeight: 700 }}>
                {item.catalogItem.name} · {item.inventoryNumber}
              </Link>
              <div className="page-muted">
                {item.catalogItem.category}
                {item.catalogItem.brand ? ` · ${item.catalogItem.brand}` : ''}
                {item.catalogItem.model ? ` · ${item.catalogItem.model}` : ''}
              </div>
            </div>
            <div>{getEquipmentStatusLabel(item.status)}</div>
          </div>
          <div className="page-muted">
            {item.currentObject
              ? `Объект: ${item.currentObject.name}`
              : item.currentOneTimeOrder
                ? `Заказ: ${item.currentOneTimeOrder.title}`
                : 'Текущая локация: склад / без привязки'}
          </div>
        </div>
      ))}
    </div>
  );
}
