'use client';

import Link from 'next/link';
import React, { useEffect, useRef } from 'react';

import type { LeadershipDashboardResponse } from '@/entities/dashboard/model/dashboard.types';
import type { TaskItem } from '@/entities/task/model/task.types';

import styles from './leadership-preview-drawer.module.css';

type DashboardObject = LeadershipDashboardResponse['objects']['items'][number];
type DashboardOrder = LeadershipDashboardResponse['orders']['items'][number];

export interface LeadershipSummaryPreview {
  eyebrow: string;
  title: string;
  subtitle?: string;
  facts?: Array<{ label: string; value: string }>;
  href: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export type LeadershipPreviewTarget =
  | { kind: 'object'; item: DashboardObject }
  | { kind: 'task'; item: TaskItem }
  | { kind: 'order'; item: DashboardOrder }
  | { kind: 'summary'; item: LeadershipSummaryPreview };

interface Props {
  target: LeadershipPreviewTarget | null;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return 'Не указан';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function issueLabel(value: DashboardObject['issues'][number]): string {
  return {
    no_responsible: 'Нет ответственного',
    no_employees: 'Нет сотрудников',
    attendance_missing: 'Нет отметки присутствия',
    daily_report_missing: 'Нет дневного отчёта',
  }[value];
}

function taskStatus(value: string): string {
  return {
    in_progress: 'В работе',
    awaiting_confirmation: 'Ждёт подтверждения',
    pending_auto_close: 'Ожидает автозакрытия',
    completed: 'Завершена',
  }[value] ?? value.replaceAll('_', ' ');
}

function orderStatus(value: string): string {
  return {
    new: 'Новый',
    planned: 'Запланирован',
    in_progress: 'В работе',
    active: 'Активен',
    completed: 'Завершён',
    cancelled: 'Отменён',
  }[value] ?? value.replaceAll('_', ' ');
}

export function LeadershipPreviewDrawer({ target, onClose }: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, target]);

  if (!target) return null;

  const fullHref = target.kind === 'object'
    ? `/objects/${target.item.id}`
    : target.kind === 'task'
      ? `/tasks/${target.item.id}`
      : target.kind === 'order'
        ? `/one-time-orders/${target.item.id}`
        : target.item.href;
  const title = target.kind === 'object'
    ? target.item.name
    : target.kind === 'summary'
      ? target.item.title
      : target.item.title;
  const eyebrow = target.kind === 'object'
    ? 'Объект'
    : target.kind === 'task'
      ? 'Задача'
      : target.kind === 'order'
        ? 'Разовый заказ'
        : target.item.eyebrow;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className={styles.drawer} ref={panelRef} aria-label="Краткое превью">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h2>{title}</h2>
            {target.kind === 'summary' && target.item.subtitle ? <p>{target.item.subtitle}</p> : null}
          </div>
          <button className={styles.close} type="button" onClick={onClose} aria-label="Закрыть превью">×</button>
        </header>

        <div className={styles.body}>
          {target.kind === 'object' ? (
            <>
              <div className={styles.fact}><span>Адрес</span><strong>{target.item.address || 'Не указан'}</strong></div>
              <div className={styles.fact}><span>Ответственный</span><strong>{target.item.responsible?.fullName ?? 'Не назначен'}</strong></div>
              <div className={styles.fact}><span>Сотрудники</span><strong>{target.item.employeeCount}</strong></div>
              <section className={styles.section}>
                <span className={styles.sectionLabel}>Состояние</span>
                {target.item.issues.length ? (
                  <div className={styles.chips}>{target.item.issues.map((issue) => <span className={styles.warningChip} key={issue}>{issueLabel(issue)}</span>)}</div>
                ) : <p className={styles.ok}>Операционных проблем не обнаружено.</p>}
              </section>
            </>
          ) : target.kind === 'task' ? (
            <>
              <div className={styles.fact}><span>Статус</span><strong>{taskStatus(target.item.status)}</strong></div>
              <div className={styles.fact}><span>Срок</span><strong>{formatDate(target.item.dueAt)}</strong></div>
              <div className={styles.fact}><span>Контекст</span><strong>{target.item.targetName || 'Без привязки'}</strong></div>
              <section className={styles.section}>
                <span className={styles.sectionLabel}>Исполнители</span>
                <p>{target.item.assignees.filter((item) => item.isActive).map((item) => item.fullName).join(', ') || 'Не назначены'}</p>
              </section>
            </>
          ) : target.kind === 'order' ? (
            <>
              <div className={styles.fact}><span>Статус</span><strong>{orderStatus(target.item.status)}</strong></div>
              <div className={styles.fact}><span>Дата исполнения</span><strong>{formatDate(target.item.executionStartDate)}</strong></div>
              <div className={styles.fact}><span>Объект</span><strong>{target.item.linkedObject?.name ?? 'Без привязки'}</strong></div>
              <div className={styles.fact}><span>Адрес</span><strong>{target.item.executionAddress || 'Не указан'}</strong></div>
            </>
          ) : (
            <>
              {(target.item.facts ?? []).map((fact) => (
                <div className={styles.fact} key={`${fact.label}-${fact.value}`}><span>{fact.label}</span><strong>{fact.value}</strong></div>
              ))}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          {target.kind === 'object' ? <Link className={styles.secondary} href="/objects">Все объекты</Link> : null}
          {target.kind === 'task' ? <Link className={styles.secondary} href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc">Мои задачи</Link> : null}
          {target.kind === 'order' ? <Link className={styles.secondary} href="/one-time-orders/attention">Горящие заказы</Link> : null}
          {target.kind === 'summary' && target.item.secondaryHref ? <Link className={styles.secondary} href={target.item.secondaryHref}>{target.item.secondaryLabel ?? 'Открыть раздел'}</Link> : null}
          <Link className={styles.primary} href={fullHref}>{target.kind === 'summary' ? target.item.actionLabel ?? 'Открыть выборку →' : 'Открыть полностью →'}</Link>
        </footer>
      </aside>
    </div>
  );
}
