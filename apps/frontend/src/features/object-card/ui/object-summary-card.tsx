'use client';

import Link from 'next/link';
import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

interface ObjectSummaryCardProps {
  item: ServiceObject;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Активный';
    case 'frozen': return 'Заморожен';
    case 'archived': return 'Архивный';
    default: return status;
  }
}

function getSeasonLabel(seasonMode: string | null): string {
  switch (seasonMode) {
    case 'summer': return 'Летний';
    case 'winter': return 'Зимний';
    case null: return 'Без сезонности';
    default: return seasonMode;
  }
}

export function ObjectSummaryCard({ item }: ObjectSummaryCardProps): React.JSX.Element {
  const allowEdit = item.capabilities.canEdit;

  return (
    <div className="page-card workspace-surface hero-card" style={{ display: 'grid', gap: 18 }}>
      <div className="section-header">
        <div>
          <div className="hero-title">{item.name}</div>
          <div className="hero-meta">{item.internalName ?? 'Без внутреннего имени'}</div>
          <div style={{ marginTop: 8 }}>
            <span className="status-pill" data-status={item.status}>{getStatusLabel(item.status)}</span>
          </div>
        </div>

        <div className="action-row">
          {allowEdit ? (
            <Link className="button-link" href={`/objects/${item.id}/edit`}>Редактировать</Link>
          ) : null}
          <Link className="button-link" href={`/objects/${item.id}/history`}>История</Link>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-field">
          <div className="detail-label">Адрес</div>
          <div className="detail-value">{item.address}</div>
        </div>
        <div className="detail-field">
          <div className="detail-label">Сезон</div>
          <div className="detail-value">{getSeasonLabel(item.seasonMode)}</div>
        </div>
        <div className="detail-field">
          <div className="detail-label">Ответственный</div>
          <div className="detail-value">
            {item.responsible ? getUserDisplayName(item.responsible) : 'Не назначен'}
            {item.responsible && getUserSecondaryLabel(item.responsible) ? (
              <span className="identity-secondary">{getUserSecondaryLabel(item.responsible)}</span>
            ) : null}
          </div>
        </div>
        <div className="detail-field">
          <div className="detail-label">Ставка за день</div>
          <div className="detail-value">{item.dailyRate.toLocaleString('ru-RU')} ₽</div>
        </div>
      </div>

      {item.notes ? (
        <div className="detail-field">
          <div className="detail-label">Комментарий</div>
          <div className="detail-value">{item.notes}</div>
        </div>
      ) : null}
    </div>
  );
}
