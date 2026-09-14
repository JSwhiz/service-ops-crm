import React from 'react';

import type { ObjectFeedItem } from '@/entities/object/model/object-operations.types';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './object-feed-list.module.css';

interface ObjectFeedListProps {
  items: ObjectFeedItem[];
}

export function ObjectFeedList({
  items,
}: ObjectFeedListProps): React.JSX.Element {
  return (
    <div className={`page-card ${styles.card}`}>
      <div className={`section-header ${styles.header}`}>
        <div>
          <div className="section-title">Лента объекта</div>
          <div className="section-subtitle">
            Отчеты, комментарии и операционные события.
          </div>
        </div>
      </div>

      <div className={`record-list local-scroll ${styles.list}`}>
        {items.length === 0 ? (
          <div className="page-muted">Событий пока нет.</div>
        ) : (
          items.map((item) => (
            <article
              key={`${item.type}-${item.id}`}
              className={styles.item}
            >
              <div className={styles.meta}>
                {item.title} · {getUserDisplayName(item.author)}
              </div>
              <div className={styles.description}>{item.description}</div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
