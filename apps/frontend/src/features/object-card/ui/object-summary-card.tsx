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

function getSeasonLabel(seasonMode: string): string {
  switch (seasonMode) {
    case 'summer':
      return 'Летний';
    case 'winter':
      return 'Зимний';
    case 'all_year':
      return 'Круглый год';
    default:
      return seasonMode;
  }
}

export function ObjectSummaryCard({
  item,
}: ObjectSummaryCardProps): React.JSX.Element {
  const allowEdit = item.capabilities.canEdit;

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{item.name}</div>
          <div className="page-muted">
            {item.internalName ?? 'Без внутреннего имени'}
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="status-pill">{getStatusLabel(item.status)}</span>
          </div>
        </div>

        <div className="action-row">
          {allowEdit ? (
            <Link href={`/objects/${item.id}/edit`}>
              <button type="button">Редактировать</button>
            </Link>
          ) : null}

          <Link href={`/objects/${item.id}/history`}>
            <button type="button">История</button>
          </Link>
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
          <div>{getSeasonLabel(item.seasonMode)}</div>
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
