'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { getNotificationUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/entities/notification/api/notification-client';
import type { AppNotification } from '@/entities/notification/model/notification.types';

export function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = (): void => { void getNotificationUnreadCount().then((value) => { if (active) setCount(value.count); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next) { setLoading(true); void listNotifications(1, 15).then((result) => setItems(result.items)).catch(() => setItems([])).finally(() => setLoading(false)); }
  };
  const openNotification = (item: AppNotification): void => {
    setOpen(false);
    if (item.targetUrl) router.push(item.targetUrl);
    if (!item.readAt) {
      void markNotificationRead(item.id)
        .then(() => {
          setCount((value) => Math.max(0, value - 1));
          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: entry.readAt ?? new Date().toISOString() } : entry));
        })
        .catch(() => undefined);
    }
  };

  return <div className="notification-bell"><button type="button" className="notification-bell__trigger" onClick={toggle} aria-label={`Уведомления, непрочитанных: ${count}`} aria-expanded={open}>Уведомления{count > 0 ? <span>{count > 99 ? '99+' : count}</span> : null}</button>{open ? <div className="notification-popover"><div className="notification-popover__header"><strong>Уведомления</strong>{count > 0 ? <button type="button" onClick={() => { void markAllNotificationsRead().then(() => { setCount(0); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))); }); }}>Прочитать все</button> : null}</div><div className="notification-popover__list">{loading ? <div className="page-muted">Загрузка...</div> : items.length === 0 ? <div className="page-muted">Уведомлений пока нет.</div> : items.map((item) => <button type="button" key={item.id} className={item.readAt ? 'notification-item' : 'notification-item notification-item--unread'} onClick={() => openNotification(item)}><strong>{item.title}</strong>{item.body ? <span>{item.body}</span> : null}<small>{new Date(item.createdAt).toLocaleString('ru-RU')}</small></button>)}</div></div> : null}</div>;
}
