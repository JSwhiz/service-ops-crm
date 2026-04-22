import React from 'react';

import type { ObjectFeedItem } from '@/entities/object/model/object-operations.types';

interface ObjectFeedListProps {
  items: ObjectFeedItem[];
}

export function ObjectFeedList({
  items,
}: ObjectFeedListProps): React.JSX.Element {
  return (
    <div className="page-card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Лента объекта</div>
          <div className="section-subtitle">
            Отчеты, комментарии и операционные события.
          </div>
        </div>
      </div>

      <div className="record-list local-scroll">
        {items.length === 0 ? (
          <div className="page-muted">Событий пока нет.</div>
        ) : (
          items.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              style={{
                borderLeft: '3px solid #d1d5db',
                paddingLeft: 12,
              }}
            >
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                {item.title} · {item.author.fullName}
              </div>
              <div>{item.description}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
