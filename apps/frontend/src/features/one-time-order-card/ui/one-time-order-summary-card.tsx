import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';

import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { Button, EntityHeader, StatusBadge, Surface } from '@/shared/ui/foundation';
import { OverflowMenu } from '@/shared/ui/overflow-menu/overflow-menu';
import { useCreateNavigation } from '@/shared/create-navigation';
import styles from './one-time-order-summary-card.module.css';

export function OneTimeOrderSummaryCard({
  item,
  onEdit,
  onComplete,
  onReopen,
  isEditing = false,
}: {
  item: OneTimeOrderItem;
  onEdit?: () => void;
  onComplete?: () => void;
  onReopen?: () => void;
  isEditing?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const createNavigation = useCreateNavigation();
  const status = <StatusBadge status={item.status}>{getOneTimeOrderStatusLabel(item.status)}</StatusBadge>;
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
    <Surface as="section" padding="md" className={`hero-card ${styles.summary}`}>
      <EntityHeader
        title={item.title}
        status={status}
        metadata={item.executionAddress || 'Адрес выполнения не указан'}
        actions={(
          <div className="ui-inline one-time-order-summary__actions">
            {onComplete && item.capabilities.canComplete ? (
              <Button variant="primary" onClick={onComplete}>Завершить заказ</Button>
            ) : null}
            {onReopen && item.capabilities.canReopen ? (
              <Button variant="primary" onClick={onReopen}>Возобновить работу</Button>
            ) : null}
            {onEdit && item.capabilities.canEditOperationalFields ? (
              <Button onClick={onEdit}>{isEditing ? 'Закрыть редактирование' : 'Редактировать'}</Button>
            ) : null}
            {item.capabilities.canCopy ? (
              <OverflowMenu
                triggerLabel="Действия с заказом"
                items={[{
                  key: 'copy',
                  label: 'Скопировать заказ',
                  onSelect: () => {
                    const destination = `/one-time-orders/new?copyFrom=${encodeURIComponent(item.id)}`;
                    if (!createNavigation.open(destination)) router.push(destination);
                  },
                }]}
              />
            ) : null}
          </div>
        )}
      />
      <div className={`ui-detail-grid ${styles.facts}`}>
        {facts.map((fact) => (
          <div className="ui-detail-field" key={fact.label}>
            <div className="ui-detail-label">{fact.label}</div>
            <div className={`ui-detail-value ${styles.factValue}`}>{fact.value}</div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
