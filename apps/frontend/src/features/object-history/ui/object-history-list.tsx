'use client';

import React from 'react';

import type { ObjectAuditLogItem } from '@/entities/object/model/object.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

interface ObjectHistoryListProps {
  items: ObjectAuditLogItem[];
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  internalName: 'Внутреннее имя',
  address: 'Адрес',
  status: 'Статус',
  seasonMode: 'Сезон',
  monthlySalary: 'ЗП за месяц',
  dailyRate: 'Старая дневная ставка',
  counterpartyId: 'Контрагент',
  responsibleUserId: 'Ответственный',
  managerUserIds: 'Менеджеры',
  notes: 'Комментарий',
};

function getActionLabel(actionCode: string): string {
  switch (actionCode) {
    case 'object.created':
      return 'Объект создан';
    case 'object.updated':
      return 'Карточка объекта изменена';
    case 'object.status_changed':
      return 'Статус объекта изменён';
    case 'object.status_change_requested':
      return 'Запрошено изменение статуса';
    case 'object.responsible_added':
      return 'Назначен ответственный';
    case 'object.responsible_removed':
      return 'Снят ответственный';
    case 'object.manager_added':
      return 'Назначен менеджер';
    case 'object.manager_removed':
      return 'Снят менеджер';
    case 'object.counterparty_changed':
      return 'Изменён контрагент';
    default:
      return actionCode;
  }
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Не указано';
  if (field === 'monthlySalary' || field === 'dailyRate') {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? `${numeric.toLocaleString('ru-RU')} ₽`
      : String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'Нет' : `${value.length} шт.`;
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return String(value);
}

function getReadableChanges(
  payload: Record<string, unknown>,
): Array<{ label: string; before?: string; after: string }> {
  const changes = payload.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    return Object.entries(changes as Record<string, unknown>).flatMap(
      ([field, rawChange]) => {
        if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) {
          return [];
        }
        const change = rawChange as {
          oldValue?: unknown;
          newValue?: unknown;
        };
        return [
          {
            label: FIELD_LABELS[field] ?? field,
            before: formatValue(field, change.oldValue),
            after: formatValue(field, change.newValue),
          },
        ];
      },
    );
  }

  if ('fullName' in payload) {
    return [
      {
        label: 'Пользователь',
        after: String(payload.fullName),
      },
    ];
  }

  if ('oldStatus' in payload || 'newStatus' in payload) {
    return [
      {
        label: 'Статус',
        before: formatValue('status', payload.oldStatus),
        after: formatValue('status', payload.newStatus),
      },
    ];
  }

  return Object.entries(payload)
    .filter(([field]) => field !== 'approvalRequestId')
    .map(([field, value]) => ({
      label: FIELD_LABELS[field] ?? field,
      after: formatValue(field, value),
    }));
}

export function ObjectHistoryList({
  items,
}: ObjectHistoryListProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <section className={styles.surfaceCompact}>
        <h2 className={styles.title}>История объекта</h2>
        <p className={styles.muted}>Записей аудита пока нет.</p>
      </section>
    );
  }

  return (
    <section className={styles.surface}>
      <div>
        <h2 className={styles.title}>История объекта</h2>
        <p className={styles.description}>
          Изменения карточки, статуса и управленческих назначений.
        </p>
      </div>

      <div className={styles.recordList}>
        {items.map((item) => {
          const changes = item.payload
            ? getReadableChanges(item.payload as Record<string, unknown>)
            : [];

          return (
            <article key={item.id} className={styles.recordCard}>
              <div className={styles.auditHeader}>
                <div>
                  <div className={styles.recordTitle}>
                    {getActionLabel(item.actionCode)}
                  </div>
                  <div className={styles.muted}>
                    {getUserDisplayName(item.actor)}
                    {getUserSecondaryLabel(item.actor)
                      ? ` · ${getUserSecondaryLabel(item.actor)}`
                      : ''}
                  </div>
                </div>
                <time className={styles.auditTime}>
                  {new Date(item.createdAt).toLocaleString('ru-RU')}
                </time>
              </div>

              {changes.length > 0 ? (
                <div className={styles.auditChanges}>
                  {changes.map((change, index) => (
                    <div className={styles.auditChangeRow} key={`${change.label}-${index}`}>
                      <span>{change.label}</span>
                      <div>
                        {change.before !== undefined ? (
                          <>
                            <del>{change.before}</del>
                            <span className={styles.auditArrow}>→</span>
                          </>
                        ) : null}
                        <strong>{change.after}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {item.payload ? (
                <details className={styles.auditTechnical}>
                  <summary>Технические данные</summary>
                  <pre className={styles.payload}>
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
