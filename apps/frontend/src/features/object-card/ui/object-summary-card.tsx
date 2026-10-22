'use client';

import Link from 'next/link';
import React from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { ButtonLink, StatusBadge, Surface } from '@/shared/ui/foundation';

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
  const allowEdit = item.capabilities.canEdit || item.capabilities.canManageCompensationRates === true;

  return (
    <Surface padding="md" className="hero-card object-summary">
      <div className="object-summary__top">
        <div className="object-summary__identity">
          <div className="object-summary__title-row">
            <div className="hero-title">{item.name}</div>
            <StatusBadge status={item.status}>{getStatusLabel(item.status)}</StatusBadge>
          </div>
          {item.internalName ? (
            <div className="object-summary__internal-name">
              <span>Внутреннее имя</span>
              <strong>{item.internalName}</strong>
            </div>
          ) : null}
        </div>

        <div className="ui-inline object-summary__actions">
          {allowEdit ? (
            <ButtonLink href={`/objects/${item.id}/edit`}>Редактировать</ButtonLink>
          ) : null}
          <ButtonLink variant="ghost" href={`/objects/${item.id}/history`}>История</ButtonLink>
        </div>
      </div>

      <div className="ui-detail-grid object-summary__facts">
        <div className="ui-detail-field">
          <div className="ui-detail-label">Адрес</div>
          <div className="ui-detail-value">{item.address || 'Не указан'}</div>
        </div>
        <div className="ui-detail-field">
          <div className="ui-detail-label">Контрагент</div>
          <div className="ui-detail-value">
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
        <div className="ui-detail-field">
          <div className="ui-detail-label">Ответственный</div>
          <div className="ui-detail-value">
            {item.responsible ? getUserDisplayName(item.responsible) : 'Не назначен'}
            {item.responsible && getUserSecondaryLabel(item.responsible) ? (
              <span className="identity-secondary">{getUserSecondaryLabel(item.responsible)}</span>
            ) : null}
          </div>
        </div>
        <div className="ui-detail-field">
          <div className="ui-detail-label">Сезонность и оплата</div>
          <div className="ui-detail-value">
            {getSeasonLabel(item.seasonMode)}
            <span className="identity-secondary">
              {item.capabilities.canViewCompensationRates === false ? 'Условия оплаты скрыты' : (() => {
                // Be tolerant of an API process that has not yet been restarted
                // after seasonal-rate deployment. Older responses omit the new
                // fields; the object card must still render using legacy rates.
                const paymentType = item.seasonMode === 'summer'
                  ? item.summerPaymentType ?? item.paymentType
                  : item.seasonMode === 'winter'
                    ? item.winterPaymentType ?? item.paymentType
                    : item.paymentType;
                const amount = item.seasonMode === 'summer'
                  ? paymentType === 'monthly'
                    ? item.summerMonthlySalary ?? item.monthlySalary ?? 0
                    : item.summerDailyRate ?? item.dailyRate ?? 0
                  : item.seasonMode === 'winter'
                    ? paymentType === 'monthly'
                      ? item.winterMonthlySalary ?? item.monthlySalary ?? 0
                      : item.winterDailyRate ?? item.dailyRate ?? 0
                    : paymentType === 'monthly' ? item.monthlySalary ?? 0 : item.dailyRate ?? 0;
                return paymentType === 'monthly'
                  ? `${amount.toLocaleString('ru-RU')} ₽ / месяц`
                  : `${amount.toLocaleString('ru-RU')} ₽ / выход`;
              })()}
            </span>
          </div>
        </div>
      </div>

      <div className="object-summary__season-profile">
        <div>
          <span>Лето</span>
          <strong>{[
            item.summerWindowCleaning ? 'Мыть окна' : null,
          ].filter(Boolean).join(' · ') || 'Мытьё окон не предусмотрено'}</strong>
        </div>
        <div>
          <span>Зима</span>
          <strong>{item.winterTractorMode === 'with_removal'
            ? 'Трактор с вывозом'
            : item.winterTractorMode === 'without_removal'
              ? 'Трактор без вывоза'
              : 'Трактор не нужен'}</strong>
        </div>
      </div>

      {item.engineeringRequired ? (
        <div className="object-summary__season-profile">
          <div>
            <span>Дополнительные работы</span>
            <strong>Инженерка</strong>
          </div>
        </div>
      ) : null}

      {item.notes || item.instructionSteps.length > 0 ? (
        <div className="object-summary__note">
          {item.instructionSteps.length > 0 ? (
            <>
              <div className="ui-detail-label">Постоянные инструкции</div>
              <ol>{item.instructionSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
            </>
          ) : null}
          {item.notes ? <><div className="ui-detail-label">Что важно знать об объекте</div><div className="ui-detail-value">{item.notes}</div></> : null}
        </div>
      ) : null}
    </Surface>
  );
}
