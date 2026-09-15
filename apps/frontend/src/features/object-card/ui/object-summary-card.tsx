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
    <div className="page-card workspace-surface hero-card object-summary">
      <div className="object-summary__top">
        <div className="object-summary__identity">
          <div className="object-summary__title-row">
            <div className="hero-title">{item.name}</div>
            <span className="status-pill" data-status={item.status}>{getStatusLabel(item.status)}</span>
          </div>
          {item.internalName ? <div className="hero-meta">{item.internalName}</div> : null}
        </div>

        <div className="action-row object-summary__actions">
          {allowEdit ? (
            <Link className="button-link object-summary__primary-action" href={`/objects/${item.id}/edit`}>Редактировать</Link>
          ) : null}
          <Link className="button-link" href={`/objects/${item.id}/history`}>История</Link>
        </div>
      </div>

      <div className="detail-grid object-summary__facts">
        <div className="detail-field">
          <div className="detail-label">Адрес</div>
          <div className="detail-value">{item.address}</div>
        </div>
        <div className="detail-field">
          <div className="detail-label">Сезон</div>
          <div className="detail-value">{getSeasonLabel(item.seasonMode)}</div>
        </div>
        <div className="detail-field">
          <div className="detail-label">Контрагент</div>
          <div className="detail-value">
            {item.counterparty ? (
              item.counterparty.canOpenCounterparty ? (
                <Link href={`/counterparties/${item.counterparty.id}`}>{item.counterparty.name}</Link>
              ) : item.counterparty.name
            ) : 'Не привязан'}
            {item.counterparty?.legalName ? (
              <span className="identity-secondary">{item.counterparty.legalName}</span>
            ) : null}
          </div>
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
          <div className="detail-label">Оплата</div>
          <div className="detail-value">
            {item.paymentType === 'monthly'
              ? `${item.monthlySalary.toLocaleString('ru-RU')} ₽ / месяц`
              : `${item.dailyRate.toLocaleString('ru-RU')} ₽ / выход`}
          </div>
        </div>
      </div>

      {item.notes ? (
        <div className="object-summary__note">
          <div className="detail-label">Что важно знать об объекте</div>
          <div className="detail-value">{item.notes}</div>
        </div>
      ) : null}
    </div>
  );
}
