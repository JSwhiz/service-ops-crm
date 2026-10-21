'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { buildChatRealtimeUrl } from '@/entities/chat/api/chat-client';
import { getNotificationUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/entities/notification/api/notification-client';
import type { AppNotification } from '@/entities/notification/model/notification.types';
import { Button } from '@/shared/ui/foundation';

function BellIcon(): React.JSX.Element {
  return (
    <svg
      className="notification-bell__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7.5 10.2a4.5 4.5 0 0 1 9 0c0 4.3 1.75 5.55 1.75 5.55H5.75S7.5 14.5 7.5 10.2Z" />
      <path d="M10.2 18.1a2 2 0 0 0 3.6 0" />
    </svg>
  );
}

export function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const seenNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const refresh = (): void => { void getNotificationUnreadCount().then((value) => { if (active) setCount(value.count); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!('Notification' in window)) {
      setBrowserPermission('unsupported');
      return;
    }
    setBrowserPermission(window.Notification.permission);
    setBrowserNotificationsEnabled(window.localStorage.getItem('crm-browser-notifications') === 'true');
  }, []);

  useEffect(() => {
    let stopped = false;
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    const connect = (): void => {
      if (stopped) return;
      socket = new WebSocket(buildChatRealtimeUrl());
      socket.onmessage = (message): void => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type?: string;
            payload?: AppNotification;
          };
          if (event.type !== 'notification.created' || !event.payload?.id) return;
          const item = { ...event.payload, readAt: null };
          setCount((current) => current + 1);
          setItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current].slice(0, 15));
          void getNotificationUnreadCount().then((value) => setCount(value.count)).catch(() => undefined);
          void listNotifications(1, 15).then((result) => setItems(result.items)).catch(() => undefined);
          if (!seenNotificationIds.current.has(item.id)) {
            seenNotificationIds.current.add(item.id);
            setToasts((current) => [...current, item].slice(-3));
            window.setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== item.id)), 6_000);
            if (document.hidden && browserNotificationsEnabled && window.Notification.permission === 'granted') {
              const browserNotification = new window.Notification(item.title, { body: item.body ?? undefined });
              browserNotification.onclick = () => {
                window.focus();
                if (item.targetUrl) router.push(item.targetUrl);
                browserNotification.close();
              };
            }
          }
        } catch {
          // Ignore malformed or unrelated realtime frames.
        }
      };
      socket.onclose = () => {
        if (!stopped) retryTimer = window.setTimeout(connect, 3_000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [browserNotificationsEnabled, router]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

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

  const requestBrowserPermission = (): void => {
    if (!('Notification' in window)) return;
    if (browserNotificationsEnabled) {
      setBrowserNotificationsEnabled(false);
      window.localStorage.setItem('crm-browser-notifications', 'false');
      return;
    }
    const request = window.Notification.permission === 'default'
      ? window.Notification.requestPermission()
      : Promise.resolve(window.Notification.permission);
    void request.then((permission) => {
      setBrowserPermission(permission);
      const enabled = permission === 'granted';
      setBrowserNotificationsEnabled(enabled);
      window.localStorage.setItem('crm-browser-notifications', String(enabled));
    });
  };

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        type="button"
        className="notification-bell__trigger"
        onClick={toggle}
        aria-label={`Уведомления, непрочитанных: ${count}`}
        aria-expanded={open}
        title="Уведомления"
      >
        <BellIcon />
        {count > 0 ? <span>{count > 99 ? '99+' : count}</span> : null}
      </button>

      {open ? (
        <div className="notification-popover">
          <div className="notification-popover__header">
            <strong>Уведомления</strong>
            {count > 0 ? (
              <Button onClick={() => { void markAllNotificationsRead().then(() => { setCount(0); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))); }); }}>
                Прочитать все
              </Button>
            ) : null}
          </div>
          {browserPermission !== 'unsupported' && browserPermission !== 'denied' ? (
            <button type="button" className="notification-browser-permission" onClick={requestBrowserPermission}>
              {browserNotificationsEnabled ? 'Отключить уведомления браузера' : 'Включить уведомления браузера'}
            </button>
          ) : browserPermission === 'denied' ? (
            <div className="notification-browser-permission" role="status">Разрешите уведомления для сайта в настройках браузера.</div>
          ) : null}
          <div className="notification-popover__list">
            {loading ? <div className="page-muted">Загрузка...</div> : items.length === 0 ? <div className="page-muted">Уведомлений пока нет.</div> : items.map((item) => (
              <button type="button" key={item.id} className={item.readAt ? 'notification-item' : 'notification-item notification-item--unread'} onClick={() => openNotification(item)}>
                <strong>{item.title}</strong>
                {item.body ? <span>{item.body}</span> : null}
                <small>{new Date(item.createdAt).toLocaleString('ru-RU')}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="notification-toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((item) => (
          <button type="button" key={item.id} className="notification-toast" onClick={() => { setToasts((current) => current.filter((entry) => entry.id !== item.id)); openNotification(item); }}>
            <strong>{item.title}</strong>
            {item.body ? <span>{item.body}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
