'use client';

import React from 'react';

import type { ObjectAuditLogItem } from '@/entities/object/model/object.types';

interface ObjectHistoryListProps {
  items: ObjectAuditLogItem[];
}

function getActionLabel(actionCode: string): string {
  switch (actionCode) {
    case 'object.created':
      return 'Объект создан';
    case 'object.updated':
      return 'Карточка объекта изменена';
    case 'object.status_changed':
      return 'Статус объекта изменен';
    case 'object.responsible_added':
      return 'Назначен ответственный';
    case 'object.responsible_removed':
      return 'Снят ответственный';
    case 'object.manager_added':
      return 'Назначен менеджер';
    case 'object.manager_removed':
      return 'Снят менеджер';
    default:
      return actionCode;
  }
}

export function ObjectHistoryList({
  items,
}: ObjectHistoryListProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="page-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>История объекта</div>
        <div className="page-muted">Записей аудита пока нет.</div>
      </div>
    );
  }

  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">История объекта</div>
          <div className="section-subtitle">
            Audit trail карточки и назначений.
          </div>
        </div>
      </div>

      <div className="record-list local-scroll local-scroll--lg">
        {items.map((item) => (
          <div
            key={item.id}
            className="record-card"
            style={{ display: 'grid', gap: 8 }}
          >
            <div style={{ fontWeight: 600 }}>{getActionLabel(item.actionCode)}</div>

            <div className="page-muted">
              {new Date(item.createdAt).toLocaleString('ru-RU')} · {item.actor.fullName} (
              {item.actor.login})
            </div>

            {item.payload ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: '#f8fafc',
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
