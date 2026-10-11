import Link from 'next/link';
import React from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { Button, EntityHeader } from '@/shared/ui/foundation';
import styles from './one-time-order-summary-card.module.css';

export function OneTimeOrderSummaryCard({
  item,
  onEdit,
  onComplete,
  isEditing = false,
}: {
  item: OneTimeOrderItem;
  onEdit?: () => void;
  onComplete?: () => void;
  isEditing?: boolean;
}): React.JSX.Element {
  const status = <span className="status-pill" data-status={item.status}>{getOneTimeOrderStatusLabel(item.status)}</span>;
  const facts = [
    {
      label: 'Дата исполнения',
      value: item.executionDate ? new Date(item.executionDate).toLocaleDateString('ru-RU') : 'Не назначена',
    },
    {
      label: 'Контакт',
      value: item.contactPhone ? `${item.contactName} · ${item.contactPhone}` : item.contactName,
    },
    {
      label: 'Сумма заказа',
      value: item.agreedSum !== null ? `${item.agreedSum.toLocaleString('ru-RU')} ₽` : 'Не указана',
    },
    {
      label: 'Объект',
      value: item.linkedObject
        ? item.linkedObject.canOpenObjectCard
          ? <Link href={`/objects/${item.linkedObject.id}`}>{item.linkedObject.name}</Link>
          : `${item.linkedObject.name} (без доступа к карточке)`
        : 'Не привязан',
    },
  ];

  return (
    <section className={`page-card workspace-surface hero-card ${styles.summary}`}>
      <EntityHeader
        title={item.title}
        status={status}
        metadata={item.executionAddress || 'Адрес выполнения не указан'}
        actions={(
          <div className="action-row one-time-order-summary__actions">
            {onComplete && item.capabilities.canComplete ? (
              <Button variant="primary" onClick={onComplete}>Завершить работу</Button>
            ) : null}
            {onEdit && item.capabilities.canEditOperationalFields ? (
              <Button onClick={onEdit}>{isEditing ? 'Закрыть редактирование' : 'Редактировать'}</Button>
            ) : null}
            {item.capabilities.canCopy ? (
              <Link className="ui-button" href={`/one-time-orders/new?copyFrom=${item.id}`}>Скопировать заказ</Link>
            ) : null}
          </div>
        )}
      />
      <div className={`detail-grid ${styles.facts}`}>
        {facts.map((fact) => (
          <div className="detail-field" key={fact.label}>
            <div className="detail-label">{fact.label}</div>
            <div className={`detail-value ${styles.factValue}`}>{fact.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
