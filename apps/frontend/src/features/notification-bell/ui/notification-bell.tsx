'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { buildChatRealtimeUrl } from '@/entities/chat/api/chat-client';
import { dismissNotification, getNotificationUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/entities/notification/api/notification-client';
import type { AppNotification } from '@/entities/notification/model/notification.types';
import { ApiError, fetcher } from '@/shared/api/fetcher';
import { Alert, Button, IconButton } from '@/shared/ui/foundation';
import { CloseIcon } from '@/shared/ui/icons/icons';

import styles from './notification-bell.module.css';

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
  const dismissedIds = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);

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
                openNotification(item);
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
    if (next) { setError(null); setLoading(true); void listNotifications(1, 15).then((result) => setItems(result.items)).catch(() => setError('Не удалось загрузить уведомления.')).finally(() => setLoading(false)); }
  };

  function openNotification(item: AppNotification): void {
    if (dismissedIds.current.has(item.id) || openingRef.current) return;
    openingRef.current = item.id;
    setOpeningId(item.id);
    setError(null);
    void (async () => {
      try {
        if (!item.readAt) {
          const read = await markNotificationRead(item.id);
          setItems((current) => current.map((entry) => entry.id === item.id ? read : entry));
          void getNotificationUnreadCount().then((value) => setCount(value.count)).catch(() => undefined);
        }
        const target = item.targetUrl;
        if (target) {
          if (!target.startsWith('/') || target.startsWith('//')) throw new Error('Ссылка уведомления недоступна.');
          const entityPath = /^\/(objects|one-time-orders)\/([^/?#]+)/.exec(target);
          if (entityPath) await fetcher(`/${entityPath[1]}/${entityPath[2]}`, { method: 'GET' });
          setOpen(false);
          router.push(target);
        }
      } catch (caught) {
        setOpen(true);
        setError(caught instanceof ApiError && (caught.statusCode === 403 || caught.statusCode === 404)
          ? 'Карточка недоступна: у вас нет доступа или запись удалена.'
          : 'Не удалось открыть уведомление. Попробуйте ещё раз.');
      } finally {
        openingRef.current = null;
        setOpeningId(null);
      }
    })();
  }

  const dismiss = (item: AppNotification): void => {
    if (!item.readAt || dismissedIds.current.has(item.id)) return;
    dismissedIds.current.add(item.id);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setToasts((current) => current.filter((entry) => entry.id !== item.id));
    setError(null);
    void dismissNotification(item.id).catch(() => {
      dismissedIds.current.delete(item.id);
      setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
      setError('Не удалось скрыть уведомление. Попробуйте ещё раз.');
      void listNotifications(1, 15).then((result) => setItems(result.items)).catch(() => undefined);
    });
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
              <Button onClick={() => { void markAllNotificationsRead().then(async () => { const [unread, list] = await Promise.all([getNotificationUnreadCount(), listNotifications(1, 15)]); setCount(unread.count); setItems(list.items); }).catch(() => setError('Не удалось прочитать уведомления.')); }}>
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
            {error ? <Alert tone="warning">{error}</Alert> : null}
            {loading ? <div className="ui-text-muted">Загрузка...</div> : items.filter((item) => !dismissedIds.current.has(item.id)).length === 0 ? <div className="ui-text-muted">Уведомлений пока нет.</div> : items.filter((item) => !dismissedIds.current.has(item.id)).map((item) => (
              <div key={item.id} className={styles.row}>
              <button type="button" className={item.readAt ? 'notification-item' : 'notification-item notification-item--unread'} disabled={Boolean(openingId)} onClick={() => openNotification(item)}>
                <strong>{item.title}</strong>
                {item.body ? <span>{item.body}</span> : null}
                <small>{new Date(item.createdAt).toLocaleString('ru-RU')}</small>
              </button>
              {item.readAt ? <IconButton aria-label={`Скрыть уведомление: ${item.title}`} onClick={() => dismiss(item)}><CloseIcon /></IconButton> : null}
              </div>
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
