import React from 'react';

import type { OneTimeOrderHistoryItem } from '@/entities/one-time-order/model/one-time-order.types';

export function OneTimeOrderHistoryList({
  items,
}: {
  items: OneTimeOrderHistoryItem[];
}): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontWeight: 600 }}>История</div>

      {items.length === 0 ? (
        <div className="page-muted">История по заказу пока пуста.</div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>{item.action}</div>
            <div className="page-muted" style={{ marginTop: 4 }}>
              {item.actor
                ? `${item.actor.fullName} (${item.actor.login})`
                : 'Системное событие'}{' '}
              · {new Date(item.createdAt).toLocaleString('ru-RU')}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
