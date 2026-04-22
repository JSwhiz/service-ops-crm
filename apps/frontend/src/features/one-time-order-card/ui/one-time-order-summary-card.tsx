import Link from 'next/link';
import React from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';

export function OneTimeOrderSummaryCard({
  item,
}: {
  item: OneTimeOrderItem;
}): React.JSX.Element {
  return (
    <div
      className="page-card hero-card"
      style={{ display: 'grid', gap: 18 }}
    >
      <div className="section-header">
        <div>
          <div className="hero-title">{item.title}</div>
          <div className="hero-meta">{item.executionAddress}</div>
        </div>
        <span className="status-pill" data-status={item.status}>
          {getOneTimeOrderStatusLabel(item.status)}
        </span>
      </div>

      <div className="detail-grid">
        <Field
          label="Дата исполнения"
          value={
            item.executionDate
              ? new Date(item.executionDate).toLocaleDateString('ru-RU')
              : '—'
          }
        />
        <Field
          label="Контакт"
          value={
            item.contactPhone
              ? `${item.contactName} (${item.contactPhone})`
              : item.contactName
          }
        />
        <Field
          label="Сумма"
          value={
            item.agreedSum !== null
              ? `${item.agreedSum.toLocaleString('ru-RU')} ₽`
              : '—'
          }
        />
        <Field
          label="Связанный объект"
          value={
            item.linkedObject
              ? item.linkedObject.canOpenObjectCard
                ? item.linkedObject.name
                : `${item.linkedObject.name} (без доступа к карточке)`
              : '—'
          }
          href={
            item.linkedObject?.canOpenObjectCard
              ? `/objects/${item.linkedObject.id}`
              : undefined
          }
        />
        <Field
          label="Менеджеры"
          value={item.managers.map((manager) => manager.fullName).join(', ') || '—'}
        />
        <Field label="Описание" value={item.description ?? '—'} />
        <Field label="Финансовые заметки" value={item.financialNotes ?? '—'} />
        <Field label="Расходные заметки" value={item.expenseNotes ?? '—'} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}): React.JSX.Element {
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value">
        {href ? <Link href={href}>{value}</Link> : value}
      </div>
    </div>
  );
}
