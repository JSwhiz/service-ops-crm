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
    { label: 'Всего движений', value: movementCount },
    {
      label: 'Оценка остатка',
      value: `${totalStockValueEstimate.toLocaleString('ru-RU')} ₽`,
    },
    { label: 'Без фото / bridge', value: missingPhotoBridgeCount },
  ];

  return (
    <div className="stat-grid">
      {cards.map((card) => (
        <div key={card.label} className="stat-card">
          <div className="detail-label">{card.label}</div>
          <div className="stat-card__value">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
