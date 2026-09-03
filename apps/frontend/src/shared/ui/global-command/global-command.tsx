'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { listEmployees } from '@/entities/employee/api/employee-client';
import { listObjectsPage } from '@/entities/object/api/object-client';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import { listTasks } from '@/entities/task/api/task-client';
import { useAuth } from '@/shared/auth/use-auth';

const RECENT_KEY = 'service-ops-command-recent-v1';
const MAX_RECENT = 6;

type CommandGroup =
  | 'Недавние'
  | 'Объекты'
  | 'Разовые заказы'
  | 'Задачи'
  | 'Сотрудники'
  | 'Действия'
  | 'Навигация';

interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  href: string;
  keywords?: string;
  kind: 'entity' | 'action' | 'navigation';
}

interface StoredRecentItem {
  id: string;
  label: string;
  description?: string;
  href: string;
  kind: CommandItem['kind'];
}

const GROUP_ORDER: CommandGroup[] = [
  'Недавние',
  'Объекты',
  'Задачи',
  'Разовые заказы',
  'Сотрудники',
  'Действия',
  'Навигация',
];

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12h8m-3-3 3 3-3 3" />
    </svg>
  );
}

function readRecent(): StoredRecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? (parsed.slice(0, MAX_RECENT) as StoredRecentItem[])
      : [];
  } catch {
    return [];
  }
}

function writeRecent(item: CommandItem): void {
  if (typeof window === 'undefined') return;
  const current = readRecent().filter((entry) => entry.href !== item.href);
  const next: StoredRecentItem[] = [
    {
      id: item.id,
      label: item.label,
      description: item.description,
      href: item.href,
      kind: item.kind,
    },
    ...current,
  ].slice(0, MAX_RECENT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function useStaticCommands(): { navigation: CommandItem[]; actions: CommandItem[] } {
  const { user } = useAuth();
  const capabilities = user?.capabilities;

  return useMemo(() => {
    const navigation: CommandItem[] = [
      { id: 'nav-dashboard', group: 'Навигация', label: 'Рабочий стол', href: '/dashboard', kind: 'navigation', keywords: 'главная dashboard workspace' },
      ...(capabilities?.canAccessApprovals ? [{ id: 'nav-approvals', group: 'Навигация' as const, label: 'Согласования', href: '/approvals', kind: 'navigation' as const }] : []),
      { id: 'nav-objects', group: 'Навигация', label: 'Объекты', href: '/objects', kind: 'navigation', keywords: 'объект адрес' },
      ...(capabilities?.canAccessOneTimeOrders || capabilities?.canViewAllOneTimeOrderReviews ? [{ id: 'nav-orders', group: 'Навигация' as const, label: 'Разовые заказы', href: '/one-time-orders', kind: 'navigation' as const, keywords: 'заказ разовый' }] : []),
      ...(capabilities?.canAccessAccountability ? [{ id: 'nav-accountability', group: 'Навигация' as const, label: 'Подотчет', href: '/accountability', kind: 'navigation' as const }] : []),
      ...(capabilities?.canAccessInventory ? [{ id: 'nav-inventory', group: 'Навигация' as const, label: 'Расходники', href: '/inventory', kind: 'navigation' as const }] : []),
      ...(capabilities?.canAccessEquipment ? [{ id: 'nav-equipment', group: 'Навигация' as const, label: 'Оборудование', href: '/equipment', kind: 'navigation' as const }] : []),
      { id: 'nav-tasks', group: 'Навигация', label: 'Задачи', href: '/tasks', kind: 'navigation', keywords: 'задача поручение' },
      { id: 'nav-timesheet', group: 'Навигация', label: 'Табель', href: '/timesheet', kind: 'navigation', keywords: 'табель выплаты зарплата аванс' },
      ...(capabilities?.canAccessCandidates ? [{ id: 'nav-candidates', group: 'Навигация' as const, label: 'Кандидаты', href: '/candidates', kind: 'navigation' as const }] : []),
      ...(capabilities?.canAccessEmployeesHr ? [{ id: 'nav-employees', group: 'Навигация' as const, label: 'Сотрудники', href: '/employees', kind: 'navigation' as const, keywords: 'работники персонал hr' }] : []),
      ...(capabilities?.canAccessChats ? [{ id: 'nav-chats', group: 'Навигация' as const, label: 'Чаты', href: '/chats', kind: 'navigation' as const }] : []),
      { id: 'nav-settings', group: 'Навигация', label: 'Настройки', href: '/settings', kind: 'navigation' },
    ];

    const actions: CommandItem[] = [
      { id: 'action-task-new', group: 'Действия', label: 'Создать задачу', description: 'Новая задача', href: '/tasks/new', kind: 'action', keywords: 'добавить новая задача' },
      ...(capabilities?.canCreateObject ? [{ id: 'action-object-new', group: 'Действия' as const, label: 'Создать объект', description: 'Новый объект', href: '/objects/new', kind: 'action' as const }] : []),
      ...(capabilities?.canCreateOneTimeOrder ? [{ id: 'action-order-new', group: 'Действия' as const, label: 'Создать разовый заказ', description: 'Новый разовый заказ', href: '/one-time-orders/new', kind: 'action' as const }] : []),
    ];

    return { navigation, actions };
  }, [capabilities]);
}

export function GlobalCommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element | null {
  const router = useRouter();
  const { user } = useAuth();
  const { navigation, actions } = useStaticCommands();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteItems, setRemoteItems] = useState<CommandItem[]>([]);
  const [recent, setRecent] = useState<StoredRecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const normalized = query.trim().toLocaleLowerCase('ru');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRemoteItems([]);
    setRecent(readRecent());
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open || normalized.length < 2) {
      setRemoteItems([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    const timeout = window.setTimeout(() => {
      const jobs: Array<Promise<CommandItem[]>> = [
        listObjectsPage({ q: normalized, page: 1, limit: 5, sortBy: 'updatedAt', sortDirection: 'desc' })
          .then((result) => result.items.map((item) => ({ id: `object-${item.id}`, group: 'Объекты' as const, label: item.name, description: item.address || item.internalName || 'Объект', href: `/objects/${item.id}`, kind: 'entity' as const })))
          .catch(() => []),
        listTasks({ q: normalized, page: 1, limit: 5, sortBy: 'updatedAt', sortDirection: 'desc' })
          .then((result) => result.items.map((item) => ({ id: `task-${item.id}`, group: 'Задачи' as const, label: item.title, description: item.targetName || item.objectName || item.oneTimeOrderTitle || 'Задача', href: `/tasks/${item.id}`, kind: 'entity' as const })))
          .catch(() => []),
      ];

      if (user?.capabilities?.canAccessOneTimeOrders) {
        jobs.push(
          listOneTimeOrders({ q: normalized, page: 1, limit: 5, sortBy: 'updatedAt', sortDirection: 'desc' })
            .then((result) => result.items.map((item) => ({ id: `order-${item.id}`, group: 'Разовые заказы' as const, label: item.title, description: item.executionAddress || 'Разовый заказ', href: `/one-time-orders/${item.id}`, kind: 'entity' as const })))
            .catch(() => []),
        );
      }

      if (user?.capabilities?.canAccessEmployeesHr) {
        jobs.push(
          listEmployees({ search: normalized, page: 1, limit: 5, archiveState: 'active' })
            .then((result) => result.items.map((item) => ({ id: `employee-${item.id}`, group: 'Сотрудники' as const, label: item.fullName, description: [item.position, item.phone].filter(Boolean).join(' · ') || 'Сотрудник', href: `/employees/${item.id}`, kind: 'entity' as const })))
            .catch(() => []),
        );
      }

      void Promise.all(jobs)
        .then((groups) => {
          if (requestId === requestRef.current) setRemoteItems(groups.flat());
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [normalized, open, user?.capabilities]);

  const staticMatches = useMemo(() => {
    if (!normalized) return [];
    return [...actions, ...navigation].filter((item) => `${item.label} ${item.description ?? ''} ${item.keywords ?? ''}`.toLocaleLowerCase('ru').includes(normalized));
  }, [actions, navigation, normalized]);

  const rawItems = useMemo<CommandItem[]>(() => {
    if (!normalized) {
      return [
        ...recent.map((item) => ({ ...item, group: 'Недавние' as const })),
        ...actions,
        ...navigation.slice(0, 6),
      ];
    }
    return [...remoteItems, ...staticMatches];
  }, [actions, navigation, normalized, recent, remoteItems, staticMatches]);

  const grouped = useMemo(() => GROUP_ORDER.map((group) => ({
    group,
    items: rawItems.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0), [rawItems]);

  const orderedItems = useMemo(() => grouped.flatMap((section) => section.items), [grouped]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, remoteItems.length]);

  const run = (item: CommandItem): void => {
    writeRecent(item);
    onOpenChange(false);
    router.push(item.href);
  };

  if (!open) return null;

  let flatIndex = -1;
  return (
    <div className="command-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section className="command-dialog" role="dialog" aria-modal="true" aria-label="Глобальный поиск и команды" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-search">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти объект, задачу, сотрудника или действие…"
            aria-label="Поиск"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((value) => Math.min(value + 1, Math.max(0, orderedItems.length - 1)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter' && orderedItems[activeIndex]) {
                event.preventDefault();
                run(orderedItems[activeIndex]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="command-results" role="listbox">
          {loading ? <div className="command-status">Ищем…</div> : null}
          {!loading && normalized && orderedItems.length === 0 ? (
            <div className="command-empty"><strong>Ничего не найдено</strong><span>Попробуйте название объекта, ФИО сотрудника или команду.</span></div>
          ) : null}

          {grouped.map((section) => (
            <div className="command-group" key={section.group}>
              <div className="command-group__title">{section.group}</div>
              {section.items.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button type="button" role="option" aria-selected={activeIndex === index} className={`command-item${activeIndex === index ? ' is-active' : ''}`} key={`${section.group}-${item.id}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(item)}>
                    <span className={`command-item__icon command-item__icon--${item.kind}`} aria-hidden="true">{item.kind === 'action' ? <PlusIcon /> : item.kind === 'navigation' ? <ArrowIcon /> : <SearchIcon />}</span>
                    <span className="command-item__copy"><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
                    <span className="command-item__enter" aria-hidden="true">↵</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> выбор</span><span><kbd>↵</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span></footer>
      </section>
    </div>
  );
}

export function GlobalCreateMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const router = useRouter();
  const { actions } = useStaticCommands();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard);
    };
  }, [onOpenChange, open]);

  return (
    <div className="global-create" ref={rootRef}>
      <button type="button" className="global-create__trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}><PlusIcon /><span>Создать</span></button>
      {open ? (
        <div className="global-create__menu" role="menu">
          <div className="global-create__label">Новое</div>
          {actions.map((item) => (
            <button type="button" role="menuitem" key={item.id} onClick={() => { writeRecent(item); onOpenChange(false); router.push(item.href); }}>
              <span className="global-create__item-icon"><PlusIcon /></span>
              <span><strong>{item.label.replace(/^Создать /, '')}</strong><small>{item.description}</small></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GlobalCommandTrigger({ onClick }: { onClick: () => void }): React.JSX.Element {
  return <button type="button" className="global-command-trigger" onClick={onClick} aria-label="Глобальный поиск, Cmd или Ctrl + K"><SearchIcon /><span>Поиск</span><kbd>⌘K</kbd></button>;
}
