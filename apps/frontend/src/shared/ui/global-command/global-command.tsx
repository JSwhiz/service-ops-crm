'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { globalSearch, type GlobalSearchEntityType } from '@/shared/api/global-search';
import { useAuth } from '@/shared/auth/use-auth';

import {
  COMMAND_GROUP_ORDER,
  type CommandGroup,
  type CommandItem,
  resolveGlobalActions,
  resolveGlobalNavigation,
} from './global-command-registry';
import {
  readRecentItems,
  recordRecentCommand,
  type StoredRecentItem,
} from './global-command-recent';

const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_LIMIT_PER_DOMAIN = 5;

const SEARCH_GROUP_BY_TYPE: Record<GlobalSearchEntityType, CommandGroup> = {
  object: 'Объекты',
  one_time_order: 'Разовые заказы',
  task: 'Задачи',
  employee: 'Сотрудники',
  candidate: 'Кандидаты',
};

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

function toCommandItem(item: {
  id: string;
  type: GlobalSearchEntityType;
  label: string;
  description: string | null;
  href: string;
}): CommandItem {
  return {
    id: `${item.type}-${item.id}`,
    group: SEARCH_GROUP_BY_TYPE[item.type],
    label: item.label,
    description: item.description ?? undefined,
    href: item.href,
    kind: 'entity',
  };
}

export function GlobalCommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element | null {
  const router = useRouter();
  const { user } = useAuth();
  const navigation = useMemo(() => resolveGlobalNavigation(user), [user]);
  const actions = useMemo(() => resolveGlobalActions(user), [user]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteItems, setRemoteItems] = useState<CommandItem[]>([]);
  const [recent, setRecent] = useState<StoredRecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const normalized = query.trim();
  const normalizedLower = normalized.toLocaleLowerCase('ru');

  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setRemoteItems([]);
      setRecent(readRecentItems(user?.id));
      setActiveIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, [open, user?.id]);

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
      requestRef.current += 1;
      setRemoteItems([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void globalSearch(normalized, SEARCH_LIMIT_PER_DOMAIN)
        .then((response) => {
          if (requestId !== requestRef.current) return;
          setRemoteItems(response.items.map(toCommandItem));
        })
        .catch(() => {
          if (requestId === requestRef.current) setRemoteItems([]);
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [normalized, open]);

  const staticMatches = useMemo(() => {
    if (!normalizedLower) return [];
    return [...actions, ...navigation].filter((item) =>
      `${item.label} ${item.description ?? ''} ${item.keywords ?? ''}`
        .toLocaleLowerCase('ru')
        .includes(normalizedLower),
    );
  }, [actions, navigation, normalizedLower]);

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

  const grouped = useMemo(
    () =>
      COMMAND_GROUP_ORDER.map((group) => ({
        group,
        items: rawItems.filter((item) => item.group === group),
      })).filter((section) => section.items.length > 0),
    [rawItems],
  );

  const orderedItems = useMemo(
    () => grouped.flatMap((section) => section.items),
    [grouped],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, remoteItems.length]);

  useEffect(() => {
    const active = dialogRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const run = (item: CommandItem): void => {
    recordRecentCommand(user?.id, item);
    onOpenChange(false);
    router.push(item.href);
  };

  if (!open) return null;

  let flatIndex = -1;
  return (
    <div className="command-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section
        ref={dialogRef}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Глобальный поиск и команды"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="command-search">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти объект, заказ, задачу, сотрудника или кандидата…"
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
            <div className="command-empty">
              <strong>Ничего не найдено</strong>
              <span>Попробуйте название, ФИО, телефон или команду.</span>
            </div>
          ) : null}

          {grouped.map((section) => (
            <div className="command-group" key={section.group}>
              <div className="command-group__title">{section.group}</div>
              {section.items.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    data-command-index={index}
                    className={`command-item${activeIndex === index ? ' is-active' : ''}`}
                    key={`${section.group}-${item.id}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                  >
                    <span className={`command-item__icon command-item__icon--${item.kind}`} aria-hidden="true">
                      {item.kind === 'action' ? <PlusIcon /> : item.kind === 'navigation' ? <ArrowIcon /> : <SearchIcon />}
                    </span>
                    <span className="command-item__copy">
                      <strong>{item.label}</strong>
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                    <span className="command-item__enter" aria-hidden="true">↵</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
          <span><kbd>↵</kbd> открыть</span>
          <span><kbd>Esc</kbd> закрыть</span>
        </footer>
      </section>
    </div>
  );
}

export function GlobalCreateMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const actions = useMemo(() => resolveGlobalActions(user), [user]);
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
      <button type="button" className="global-create__trigger" aria-label="Создать" title="Создать" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}><PlusIcon /></button>
      {open ? (
        <div className="global-create__menu" role="menu">
          <div className="global-create__label">Новое</div>
          {actions.map((item) => (
            <button type="button" role="menuitem" key={item.id} onClick={() => { onOpenChange(false); router.push(item.href); }}>
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
