'use client';

import React, { useEffect, useRef, useState } from 'react';
import { listChatMessages, searchChats } from '@/entities/chat/api/chat-client';
import type {
  ChatMessage,
  ChatSearchResponse,
} from '@/entities/chat/model/chat.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { ChatIcon } from './chat-icon';
import styles from './chat-ui.module.css';

function snippet(text: string, query: string): React.ReactNode {
  const at = text
    .toLocaleLowerCase('ru')
    .indexOf(query.toLocaleLowerCase('ru'));
  if (at < 0) return text;
  const start = Math.max(0, at - 50);
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length, at + query.length + 100)}
    </>
  );
}

function RoomSearch({
  roomId,
  onMessage,
}: {
  roomId: string;
  onMessage: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ChatSearchResponse>({
    rooms: [],
    messages: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => {
    const version = ++requestVersion.current;
    setResult({ rooms: [], messages: [] });
    setError('');
    if (query.trim().length < 2) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void searchChats(query, { roomId })
        .then((response) => {
          if (requestVersion.current === version) setResult(response);
        })
        .catch(() => {
          if (requestVersion.current === version)
            setError('Не удалось выполнить поиск. Попробуйте ещё раз.');
        })
        .finally(() => {
          if (requestVersion.current === version) setBusy(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current++;
    };
  }, [roomId, query]);
  const loadMore = async (): Promise<void> => {
    const version = requestVersion.current;
    setBusy(true);
    setError('');
    try {
      const next = await searchChats(query, {
        roomId,
        before: result.nextCursor ?? undefined,
      });
      if (version === requestVersion.current)
        setResult((current) => ({
          ...next,
          messages: [...current.messages, ...next.messages],
        }));
    } catch {
      if (version === requestVersion.current)
        setError('Не удалось загрузить результаты. Повторите попытку.');
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };
  return (
    <div className={styles.explorerBody}>
      <div className={styles.searchField}>
        <ChatIcon name="search" />
        <input
          autoFocus
          aria-label="Поиск сообщений в этом чате"
          placeholder="Найти сообщение"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="Очистить запрос"
            onClick={() => setQuery('')}
          >
            <ChatIcon name="close" />
          </button>
        ) : null}
      </div>
      <div className={styles.resultList} aria-busy={busy}>
        {query.trim().length < 2 ? (
          <p className={styles.hint}>Введите хотя бы два символа.</p>
        ) : null}
        {result.messages.map((message) => (
          <button
            type="button"
            className={styles.resultRow}
            key={message.id}
            onClick={() => onMessage(message.id)}
          >
            <span className={styles.resultMeta}>
              <strong>
                {message.author
                  ? getUserDisplayName(message.author)
                  : 'Система'}
              </strong>
              <time>
                {new Date(message.createdAt).toLocaleDateString('ru-RU')}
              </time>
            </span>
            <span>{snippet(message.text, query.trim())}</span>
          </button>
        ))}
        {!busy &&
        !error &&
        query.trim().length >= 2 &&
        result.messages.length === 0 ? (
          <p className={styles.hint}>В этом чате ничего не найдено.</p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className={styles.hint} role="status">
            Поиск…
          </p>
        ) : null}
        {result.nextCursor ? (
          <button
            type="button"
            className={styles.textAction}
            disabled={busy}
            onClick={() => void loadMore()}
          >
            Ещё результаты
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RoomAttachments({
  roomId,
  onMessage,
  media,
}: {
  roomId: string;
  onMessage: (id: string) => void;
  media: boolean;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [before, setBefore] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const version = useRef(0);
  useEffect(() => {
    const current = ++version.current;
    setBusy(true);
    void listChatMessages(roomId, { limit: 100 })
      .then((batch) => {
        if (current !== version.current) return;
        setMessages(batch);
        setBefore(batch[0]?.id);
        setHasMore(batch.length === 100);
      })
      .catch(() => {
        if (current === version.current)
          setError('Не удалось загрузить вложения.');
      })
      .finally(() => {
        if (current === version.current) setBusy(false);
      });
    return () => {
      version.current++;
    };
  }, [roomId]);
  const loadMore = async (): Promise<void> => {
    const current = version.current;
    setBusy(true);
    setError('');
    try {
      const batch = await listChatMessages(roomId, { limit: 100, before });
      if (current !== version.current) return;
      setMessages((previous) => [...batch, ...previous]);
      setBefore(batch[0]?.id);
      setHasMore(batch.length === 100);
    } catch {
      if (current === version.current)
        setError('Не удалось загрузить вложения.');
    } finally {
      if (current === version.current) setBusy(false);
    }
  };
  const entries = messages
    .flatMap((message) =>
      message.isDeleted
        ? []
        : message.attachments
            .filter((file) => {
              const isMedia =
                file.mimeType.startsWith('image/') ||
                file.mimeType.startsWith('video/');
              return (
                media === isMedia &&
                file.originalName
                  .toLocaleLowerCase('ru')
                  .includes(query.toLocaleLowerCase('ru'))
              );
            })
            .map((file) => ({ file, message })),
    )
    .reverse();
  return (
    <div className={styles.explorerBody}>
      <div className={styles.searchField}>
        <ChatIcon name="search" />
        <input
          aria-label="Найти вложение по имени"
          placeholder="Поиск по имени файла"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={styles.resultList} aria-busy={busy}>
        {entries.map(({ file, message }) => (
          <div
            className={styles.attachmentEntry}
            key={`${message.id}:${file.id}`}
          >
            <AttachmentPreviewList
              files={[file]}
              compactMetadata
              iconDownload
            />
            <button
              type="button"
              className={styles.textAction}
              onClick={() => onMessage(message.id)}
            >
              К сообщению ·{' '}
              {new Date(message.createdAt).toLocaleDateString('ru-RU')}
            </button>
          </div>
        ))}
        {!busy && entries.length === 0 ? (
          <p className={styles.hint}>
            {hasMore
              ? 'В просмотренной части истории вложений нет.'
              : 'Вложений не найдено.'}
          </p>
        ) : null}
        {busy ? (
          <p className={styles.hint} role="status">
            Загрузка вложений…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {hasMore || error ? (
          <button
            type="button"
            className={styles.textAction}
            disabled={busy}
            onClick={() => void loadMore()}
          >
            {error ? 'Повторить' : 'Загрузить предыдущие сообщения'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ChatExplorer({
  roomId,
  roomTitle,
  initialTab,
  onClose,
  onMessage,
}: {
  roomId: string;
  roomTitle: string;
  initialTab: 'search' | 'media' | 'files';
  onClose: () => void;
  onMessage: (id: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState(initialTab);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  return (
    <aside
      ref={panelRef}
      className={styles.explorerPanel}
      aria-label={`Поиск и вложения: ${roomTitle}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          document
            .querySelector<HTMLButtonElement>(
              '[aria-label="Поиск в этом чате"]',
            )
            ?.focus();
        }
      }}
    >
      <header className={styles.explorerHeader}>
        <strong>{roomTitle}</strong>
        <button
          type="button"
          aria-label="Закрыть поиск и вложения"
          onClick={onClose}
        >
          <ChatIcon name="close" />
        </button>
      </header>
      <div className={styles.tabs} role="group" aria-label="Просмотр чата">
        {(
          [
            ['search', 'Поиск'],
            ['media', 'Медиа'],
            ['files', 'Файлы'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'search' ? (
        <RoomSearch roomId={roomId} onMessage={onMessage} />
      ) : (
        <RoomAttachments
          roomId={roomId}
          onMessage={onMessage}
          media={tab === 'media'}
        />
      )}
    </aside>
  );
}
