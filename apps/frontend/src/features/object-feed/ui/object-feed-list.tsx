import React from 'react';

import type { ObjectFeedItem } from '@/entities/object/model/object-operations.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

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
        <div className="section-title">Лента объекта</div>
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
                {item.title} · {getUserDisplayName(item.author)} ·{' '}
                {new Date(item.occurredAt).toLocaleString('ru-RU')}
              </div>
              <div className={styles.description}>{item.description}</div>
              {item.attachments.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <AttachmentPreviewList files={item.attachments} />
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
