import React from 'react';

import type { OneTimeOrderHistoryItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

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
          <div className="section-subtitle">
            Audit trail заказа и связанных действий.
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="page-muted">История по заказу пока пуста.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <div key={item.id} className="record-card">
              <div style={{ fontWeight: 600 }}>{item.action}</div>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
