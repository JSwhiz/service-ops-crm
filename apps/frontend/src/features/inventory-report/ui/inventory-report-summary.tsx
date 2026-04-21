'use client';

import React from 'react';

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
  const cards = [
    { label: 'Всего позиций', value: totalItems },
    { label: 'Активных позиций', value: totalActiveItems },
    { label: 'Движений по выборке', value: movementCount },
    {
      label: 'Оценка остатка',
      value: `${totalStockValueEstimate.toLocaleString('ru-RU')} ₽`,
    },
    { label: 'Без фото / bridge', value: missingPhotoBridgeCount },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="page-card"
          style={{ display: 'grid', gap: 4 }}
        >
          <div className="page-muted">{card.label}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
