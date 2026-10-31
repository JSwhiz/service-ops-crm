'use client';

import React, { useState } from 'react';

import type { ObjectFeedItem } from '@/entities/object/model/object-operations.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

import styles from './object-feed-list.module.css';
import { Button, Field, Surface } from '@/shared/ui/foundation';
import { ActivityTimeline } from '@/shared/ui/activity-timeline/activity-timeline';
import { Select } from '@/shared/ui/searchable-select/select';

interface ObjectFeedListProps {
  items: ObjectFeedItem[];
}

export function ObjectFeedList({
  items,
}: ObjectFeedListProps): React.JSX.Element {
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const visible = items.filter((item) => (type === 'all' || item.type === type)
    && (!query || `${item.title} ${item.description} ${getUserDisplayName(item.author)}`.toLocaleLowerCase('ru-RU').includes(query)));
  return (
    <Surface padding="md" className={`${styles.card}`}>
      <div className={`ui-section-header ${styles.header}`}>
        <h3 className="ui-section-title">Лента объекта</h3>
      </div>
      {items.length ? <>
        <div className={styles.filters}>
          <Field label="Поиск по загруженным событиям"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Событие, текст или автор…" /></Field>
          <Field label="Тип события"><Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Все события</option>
            <option value="daily_report">Ежедневные отчёты</option>
            <option value="arrival_photo">Фото прибытия</option>
            <option value="comment">Комментарии</option>
          </Select></Field>
          {query || type !== 'all' ? <Button onClick={() => { setType('all'); setSearch(''); }}>Сбросить</Button> : null}
        </div>
        <p className="ui-section-subtitle" role="status">Показано {visible.length} из {items.length} загруженных событий. Аудит изменений доступен отдельно по ссылке выше.</p>
      </> : null}
      <ActivityTimeline emptyText={items.length ? 'По заданным условиям событий нет. Сбросьте фильтры.' : 'Событий пока нет.'} entries={visible.map((item) => ({
        id: `${item.type}-${item.id}`,
        title: item.title,
        occurredAt: item.occurredAt,
        actor: getUserDisplayName(item.author),
        children: <>
          <div className={styles.description}>{item.description}</div>
          {item.attachments.length ? <AttachmentPreviewList files={item.attachments} compact iconDownload /> : null}
        </>,
      }))} />
    </Surface>
  );
}
