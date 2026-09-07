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

function getActionLabel(actionCode: string): string {
  switch (actionCode) {
    case 'object.created': return 'Объект создан';
    case 'object.updated': return 'Карточка объекта изменена';
    case 'object.status_changed': return 'Статус объекта изменен';
    case 'object.responsible_added': return 'Назначен ответственный';
    case 'object.responsible_removed': return 'Снят ответственный';
    case 'object.manager_added': return 'Назначен менеджер';
    case 'object.manager_removed': return 'Снят менеджер';
    default: return actionCode;
  }
}

export function ObjectHistoryList({ items }: ObjectHistoryListProps): React.JSX.Element {
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
        <p className={styles.description}>Audit trail карточки, статуса и управленческих назначений.</p>
      </div>

      <div className={styles.recordList}>
        {items.map((item) => (
          <article key={item.id} className={styles.recordCard}>
            <div className={styles.recordTitle}>{getActionLabel(item.actionCode)}</div>
            <div className={styles.muted}>
              {new Date(item.createdAt).toLocaleString('ru-RU')} · {getUserDisplayName(item.actor)}
              {getUserSecondaryLabel(item.actor) ? ` ${getUserSecondaryLabel(item.actor)}` : ''}
            </div>
            {item.payload ? <pre className={styles.payload}>{JSON.stringify(item.payload, null, 2)}</pre> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
