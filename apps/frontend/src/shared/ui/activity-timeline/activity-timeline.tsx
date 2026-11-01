import React from 'react';

import styles from './activity-timeline.module.css';

export interface ActivityTimelineEntry {
  id: string;
  title: React.ReactNode;
  occurredAt: string;
  actor?: React.ReactNode;
  children?: React.ReactNode;
}

const dateOptions = { timeZone: 'Europe/Moscow' };
const dayFormat = new Intl.DateTimeFormat('ru-RU', { ...dateOptions, day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { ...dateOptions, hour: '2-digit', minute: '2-digit' });

/** Presentation only: callers retain domain formatting, access filtering and server order. */
export function ActivityTimeline({ entries, emptyText = 'Событий пока нет.' }: {
  entries: ActivityTimelineEntry[];
  emptyText?: string;
}): React.JSX.Element {
  if (!entries.length) return <p className="ui-text-muted">{emptyText}</p>;

  const groups: { day: string; entries: ActivityTimelineEntry[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.occurredAt);
    const day = Number.isFinite(date.getTime()) ? dayFormat.format(date) : 'Дата не указана';
    const previous = groups.at(-1);
    if (previous?.day === day) previous.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  return <div className={styles.timeline}>
    {groups.map((group, index) => <section key={`${group.day}-${index}`} className={styles.day} aria-label={group.day}>
      <h3 className={styles.dayTitle}>{group.day}</h3>
      <ol className={styles.events}>
        {group.entries.map((entry) => <li key={entry.id} className={styles.event}>
          <span className={styles.dot} aria-hidden="true" />
          <div className={styles.body}>
            <div className={styles.head}>
              <strong>{entry.title}</strong>
              {Number.isFinite(new Date(entry.occurredAt).getTime()) ? <time dateTime={entry.occurredAt} title={dayFormat.format(new Date(entry.occurredAt))}>
                {timeFormat.format(new Date(entry.occurredAt))}
              </time> : null}
            </div>
            {entry.actor ? <div className={styles.actor}>{entry.actor}</div> : null}
            {entry.children ? <div className={styles.details}>{entry.children}</div> : null}
          </div>
        </li>)}
      </ol>
    </section>)}
  </div>;
}
