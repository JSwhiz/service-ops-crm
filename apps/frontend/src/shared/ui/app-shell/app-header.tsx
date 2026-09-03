'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listChatRooms } from '@/entities/chat/api/chat-client';
import { NotificationBell } from '@/features/notification-bell/ui/notification-bell';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName, getUserRoleLabel } from '@/shared/lib/display-name';
import {
  GlobalCommandPalette,
  GlobalCommandTrigger,
  GlobalCreateMenu,
} from '@/shared/ui/global-command/global-command';
import { UserAvatar } from '@/shared/ui/user-avatar/user-avatar';

const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/dashboard', 'Рабочий стол'],
  ['/approvals', 'Согласования'],
  ['/objects', 'Объекты'],
  ['/one-time-orders', 'Разовые заказы'],
  ['/accountability', 'Подотчет'],
  ['/inventory', 'Расходники'],
  ['/equipment', 'Оборудование'],
  ['/tasks', 'Задачи'],
  ['/timesheet', 'Табель'],
  ['/candidates', 'Кандидаты'],
  ['/employees', 'Сотрудники'],
  ['/chats', 'Чаты'],
  ['/settings', 'Настройки'],
];

function getRouteTitle(pathname: string): string {
  return ROUTE_TITLES.find(([route]) => pathname === route || pathname.startsWith(`${route}/`))?.[1] ?? 'Рабочая система';
}

function ChatIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v6.5a2.5 2.5 0 0 1-2.5 2.5h-5.2L8 20v-3H6.5A2.5 2.5 0 0 1 4 14.5V8a2.5 2.5 0 0 1 2.5-2.5Z" />
      <circle cx="9" cy="11.25" r="0.72" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.25" r="0.72" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  );
}

export function AppHeader(): React.JSX.Element {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const accountRef = useRef<HTMLDivElement>(null);
  const canAccessChats = user?.capabilities?.canAccessChats ?? false;
  const displayName = getUserDisplayName(user);
  const roleLabel = getUserRoleLabel(user?.roleCode);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setAccountOpen(false);
        setCreateOpen(false);
        setCommandOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!canAccessChats) {
      setChatUnreadCount(0);
      return;
    }

    let active = true;
    const refreshUnreadCount = (): void => {
      void listChatRooms({ view: 'active' })
        .then((rooms) => {
          if (!active) return;
          setChatUnreadCount(rooms.reduce((total, room) => total + Math.max(0, room.unreadCount), 0));
        })
        .catch(() => undefined);
    };

    refreshUnreadCount();
    const timer = window.setInterval(refreshUnreadCount, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canAccessChats, pathname]);

  useEffect(() => {
    if (!accountOpen) return;

    const handlePointerDown = (event: MouseEvent): void => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAccountOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    setAccountOpen(false);
    setCreateOpen(false);
    setCommandOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="app-header">
        <div className="app-header__context">
          <div className="app-header__title">{getRouteTitle(pathname)}</div>
          <div className="app-header__workspace-label">Service Ops CRM</div>
        </div>

        <div className="app-header__command-zone">
          <GlobalCommandTrigger
            onClick={() => {
              setAccountOpen(false);
              setCreateOpen(false);
              setCommandOpen(true);
            }}
          />
        </div>

        <div className="app-header__actions">
          <GlobalCreateMenu
            open={createOpen}
            onOpenChange={(next) => {
              setAccountOpen(false);
              setCommandOpen(false);
              setCreateOpen(next);
            }}
          />

          {canAccessChats ? (
            <Link
              href="/chats"
              className={`app-header__icon-link app-header__icon-link--with-badge${pathname.startsWith('/chats') ? ' app-header__icon-link--active' : ''}`}
              aria-label={chatUnreadCount > 0 ? `Открыть чаты, непрочитанных: ${chatUnreadCount}` : 'Открыть чаты'}
              title="Чаты"
            >
              <ChatIcon />
              {chatUnreadCount > 0 ? (
                <span className="app-header__icon-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span>
              ) : null}
            </Link>
          ) : null}

          {user ? <NotificationBell /> : null}

          {user ? <span className="app-header__separator" aria-hidden="true" /> : null}

          {user ? (
            <div className="app-header__account" ref={accountRef}>
              <button
                type="button"
                className="app-header__account-trigger"
                onClick={() => {
                  setCreateOpen(false);
                  setCommandOpen(false);
                  setAccountOpen((current) => !current);
                }}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
              >
                <UserAvatar fullName={displayName} size="small" />
                <span className="app-header__account-copy">
                  <span className="app-header__account-name">{displayName}</span>
                  <span className="app-header__account-role">{roleLabel}</span>
                </span>
                <span className="app-header__account-chevron"><ChevronIcon /></span>
              </button>

              {accountOpen ? (
                <div className="app-header__account-menu" role="menu">
                  <div className="app-header__account-summary">
                    <strong>{displayName}</strong>
                    <span>{roleLabel}</span>
                  </div>
                  <Link className="app-header__menu-link" href="/settings" role="menuitem">
                    Настройки
                  </Link>
                  <button
                    type="button"
                    className="app-header__logout"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      void logout();
                    }}
                  >
                    Выйти
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <GlobalCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
