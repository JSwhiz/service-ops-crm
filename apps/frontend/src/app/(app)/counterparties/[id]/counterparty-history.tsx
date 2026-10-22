import Link from 'next/link';
import React from 'react';

import type { CounterpartyHistoryItem } from '@/entities/counterparty/model/counterparty.types';

import styles from './counterparty-history.module.css';

type ObjectNames = ReadonlyMap<string, string>;

type Tone = 'create' | 'link' | 'unlink' | 'edit' | 'archive';

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  legalName: 'Юридическое название',
  contactName: 'Основной контакт',
  contactPhone: 'Телефон',
  notes: 'Заметки',
  status: 'Статус',
};

const STATUS_LABELS: Record<string, string> = { active: 'Активный', archived: 'Архив' };

interface EventView {
  title: string;
  tone: Tone;
  details: React.ReactNode[];
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status' && typeof value === 'string') return STATUS_LABELS[value] ?? value;
  return String(value);
}

function getObjectId(values: Record<string, unknown> | null): string | null {
  const value = values?.objectId;
  return typeof value === 'string' ? value : null;
}

function ObjectRef({ id, names }: { id: string | null; names: ObjectNames }): React.JSX.Element {
  if (!id) return <span className={styles.missing}>не указан</span>;
  const name = names.get(id);
  return name ? (
    <Link href={`/objects/${id}`}>{name}</Link>
  ) : (
    <span className={styles.missing}>объект больше не привязан</span>
  );
}

function describe(event: CounterpartyHistoryItem, names: ObjectNames): EventView {
  const oldObject = getObjectId(event.oldValues);
  const newObject = getObjectId(event.newValues);

  switch (event.action) {
    case 'counterparty.created':
      return {
        title: 'Контрагент создан',
        tone: 'create',
        details: Object.keys(FIELD_LABELS)
          .filter((field) => field !== 'status' && event.newValues?.[field])
          .map((field) => (
            <span key={field}>
              {FIELD_LABELS[field]}: <b>{formatValue(field, event.newValues?.[field])}</b>
            </span>
          )),
      };
    case 'counterparty.updated': {
      const changed = Object.keys(FIELD_LABELS).filter(
        (field) => (event.oldValues?.[field] ?? null) !== (event.newValues?.[field] ?? null),
      );
      return {
        title: 'Данные изменены',
        tone: 'edit',
        details: changed.length
          ? changed.map((field) => (
              <span key={field}>
                {FIELD_LABELS[field]}: <s>{formatValue(field, event.oldValues?.[field])}</s>
                {' → '}<b>{formatValue(field, event.newValues?.[field])}</b>
              </span>
            ))
          : [<span key="none" className={styles.missing}>Сохранено без изменений полей</span>],
      };
    }
    case 'counterparty.archived':
      return { title: 'Перенесён в архив', tone: 'archive', details: [] };
    case 'counterparty.restored':
      return { title: 'Восстановлен из архива', tone: 'create', details: [] };
    case 'counterparty.object_linked':
      return {
        title: 'Привязан объект',
        tone: 'link',
        details: [<span key="o"><ObjectRef id={newObject} names={names} /></span>],
      };
    case 'counterparty.object_unlinked':
      return {
        title: 'Отвязан объект',
        tone: 'unlink',
        details: [<span key="o"><ObjectRef id={oldObject ?? newObject} names={names} /></span>],
      };
    case 'counterparty.object_unlinked_by_relink':
      return {
        title: 'Объект перенесён к другому контрагенту',
        tone: 'unlink',
        details: [<span key="o"><ObjectRef id={oldObject ?? newObject} names={names} /></span>],
      };
    case 'counterparty.master_object_changed':
      return {
        title: 'Сменён мастер-объект',
        tone: 'edit',
        details: [
          <span key="o">
            {oldObject ? <><ObjectRef id={oldObject} names={names} />{' → '}</> : null}
            <ObjectRef id={newObject} names={names} />
          </span>,
        ],
      };
    case 'counterparty.master_object_cleared':
      return {
        title: 'Мастер-объект снят',
        tone: 'unlink',
        details: [<span key="o">Был: <ObjectRef id={oldObject} names={names} /></span>],
      };
    default:
      return { title: event.action, tone: 'edit', details: [] };
  }
}

function dayKey(value: string): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('ru-RU', sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

export function CounterpartyHistory({
  items,
  objectNames,
}: {
  items: CounterpartyHistoryItem[];
  objectNames: ObjectNames;
}): React.JSX.Element {
  const groups: { day: string; events: CounterpartyHistoryItem[] }[] = [];
  for (const event of items) {
    const day = dayKey(event.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }

  return (
    <div className={styles.timeline}>
      {groups.map((group) => (
        <section key={group.day} className={styles.day}>
          <h3 className={styles.dayTitle}>{group.day}</h3>
          <ol className={styles.events}>
            {group.events.map((event) => {
              const view = describe(event, objectNames);
              return (
                <li key={event.id} className={styles.event} data-tone={view.tone}>
                  <span className={styles.dot} aria-hidden="true" />
                  <div className={styles.body}>
                    <div className={styles.head}>
                      <strong>{view.title}</strong>
                      <time dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </div>
                    {view.details.length ? <div className={styles.details}>{view.details}</div> : null}
                    <div className={styles.actor}>{event.actor?.fullName ?? 'Система'}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
