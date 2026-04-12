'use client';

import Link from 'next/link';
import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';

interface ObjectSummaryCardProps {
  item: ServiceObject;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Активный';
    case 'frozen':
      return 'Заморожен';
    case 'archived':
      return 'Архивный';
    default:
      return status;
  }
}

export function ObjectSummaryCard({
  item,
}: ObjectSummaryCardProps): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{item.name}</div>
          <div className="page-muted">{item.internalName ?? 'Без внутреннего имени'}</div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Link href={`/objects/${item.id}/edit`}>Редактировать</Link>
          <Link href={`/objects/${item.id}/history`}>История</Link>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <div>
          <div className="page-muted">Адрес</div>
          <div>{item.address}</div>
        </div>

        <div>
          <div className="page-muted">Статус</div>
          <div>{getStatusLabel(item.status)}</div>
        </div>

        <div>
          <div className="page-muted">Сезон</div>
          <div>{item.seasonMode}</div>
        </div>

        <div>
          <div className="page-muted">Ставка за день</div>
          <div>{item.dailyRate}</div>
        </div>
      </div>

      {item.notes ? (
        <div>
          <div className="page-muted">Комментарий</div>
          <div>{item.notes}</div>
        </div>
      ) : null}
    </div>
  );
}
