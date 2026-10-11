import React from 'react';

import type { OneTimeOrderHistoryItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

const ACTION_LABELS: Record<string, string> = {
  'one_time_order.created': 'Заказ создан',
  'one_time_order.copied': 'Заказ скопирован',
  'one_time_order.updated': 'Карточка заказа изменена',
  'one_time_order.status_changed': 'Статус заказа изменён',
  'one_time_order.completed': 'Заказ завершён',
  'one_time_order.reopened': 'Заказ возвращён в работу',
  'one_time_order.review_updated': 'Отзыв обновлён',
  'one_time_order.review_cleared': 'Отзыв удалён',
  'one_time_order.payment_corrected': 'Исправлены данные оплаты',
  'one_time_order.manager_added': 'Назначен менеджер',
  'one_time_order.manager_removed': 'Менеджер снят с заказа',
  'one_time_order.attendance.submitted': 'Отметка о выходе сохранена',
  'one_time_order.attendance.corrected': 'Отметка о выходе исправлена',
  'one_time_order.comment_created': 'Добавлен комментарий',
  'one_time_order.daily_report_upserted': 'Отчёт о выполнении обновлён',
  'one_time_order.photo_created': 'Добавлен файл или фото',
  'one_time_order.photo_deleted': 'Файл или фото удалён',
  'one_time_order.photo_restored': 'Файл или фото восстановлен',
  'one_time_order.specification_item_created': 'Добавлен пункт задания',
  'one_time_order.specification_item_updated': 'Пункт задания изменён',
  'one_time_order.specification_item_deleted': 'Пункт задания удалён',
  'one_time_order.specification_item_completed': 'Пункт задания выполнен',
  'one_time_order.specification_item_reopened': 'Пункт задания возвращён в работу',
  'one_time_order.specification_reordered': 'Изменён порядок пунктов задания',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Название заказа',
  executionAddress: 'Адрес выполнения',
  executionDate: 'Дата выполнения',
  executionStartDate: 'Начало периода',
  executionEndDate: 'Окончание периода',
  contactName: 'Контакт',
  contactPhone: 'Телефон контакта',
  agreedSum: 'Согласованная сумма',
  plannedPaymentMethod: 'Плановый способ оплаты',
  linkedObjectId: 'Связанный объект',
  status: 'Статус',
  description: 'Описание',
  financialNotes: 'Финансовые заметки',
  expenseNotes: 'Расходные заметки',
  reviewText: 'Текст отзыва',
  reviewRating: 'Оценка отзыва',
  employeeCount: 'Количество сотрудников',
  operationDate: 'Дата выхода',
  reason: 'Причина',
  comment: 'Комментарий',
};

function getActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action.startsWith('task.')) return 'Связанная задача обновлена';
  return 'Изменение по заказу';
}

function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Не указано';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (Array.isArray(value)) return value.length ? `${value.length} записей` : 'Нет';
  if (typeof value === 'object') return 'Изменено';
  if (field === 'status') {
    const statusLabels: Record<string, string> = {
      new: 'Новый', planned: 'Запланирован', in_progress: 'В работе',
      completed: 'Завершён', cancelled: 'Отменён',
    };
    return statusLabels[String(value)] ?? 'Изменён';
  }
  if (field === 'plannedPaymentMethod') {
    const methodLabels: Record<string, string> = {
      cash: 'Наличные', personal_card_transfer: 'Перевод на личную карту',
      organization_transfer: 'Перевод организации', other: 'Другой способ',
    };
    return methodLabels[String(value)] ?? 'Изменён';
  }
  if (field === 'agreedSum' || field === 'reviewRating') {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? field === 'reviewRating'
        ? `${amount} из 5`
        : `${amount.toLocaleString('ru-RU')} ₽`
      : 'Изменено';
  }
  return String(value);
}

function getReadableChanges(item: OneTimeOrderHistoryItem): Array<{
  label: string;
  before?: string;
  after: string;
}> {
  const oldValues = item.oldValues ?? {};
  const newValues = item.newValues ?? {};
  const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
  return [...keys].flatMap((key) => {
    const label = FIELD_LABELS[key];
    if (!label) return [];
    const hadOld = Object.prototype.hasOwnProperty.call(oldValues, key);
    const hasNew = Object.prototype.hasOwnProperty.call(newValues, key);
    if (!hadOld && !hasNew) return [];
    return [{
      label,
      ...(hadOld ? { before: formatAuditValue(key, oldValues[key]) } : {}),
      after: hasNew ? formatAuditValue(key, newValues[key]) : 'Удалено',
    }];
  });
}

export function OneTimeOrderHistoryList({
  items,
}: {
  items: OneTimeOrderHistoryItem[];
}): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 12 }}>
      <div className="section-header">
        <div>
          <div className="section-title">История</div>
          <div className="section-subtitle">Изменения заказа и связанных действий.</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="page-muted">История по заказу пока пуста.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <div key={item.id} className="record-card">
              <div style={{ fontWeight: 600 }}>{getActionLabel(item.action)}</div>
              <div className="page-muted" style={{ marginTop: 4 }}>
                {item.actor
                  ? [
                      getUserDisplayName(item.actor),
                      getUserSecondaryLabel(item.actor),
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : 'Системное событие'}{' '}
                · {new Date(item.createdAt).toLocaleString('ru-RU')}
              </div>
              {getReadableChanges(item).length > 0 ? (
                <div className="detail-grid" style={{ marginTop: 10 }}>
                  {getReadableChanges(item).map((change) => (
                    <div className="detail-field" key={change.label}>
                      <div className="detail-label">{change.label}</div>
                      <div className="detail-value">
                        {change.before !== undefined ? `${change.before} → ` : ''}
                        {change.after}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
