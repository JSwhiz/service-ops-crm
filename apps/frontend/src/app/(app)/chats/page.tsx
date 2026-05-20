'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  addChatParticipants,
  buildChatRealtimeUrl,
  createChatRoom,
  editChatMessage,
  listChatRoomParticipants,
  listChatMessages,
  listChatRooms,
  markChatRoomRead,
  renameChatRoom,
  sendChatMessage,
} from '@/entities/chat/api/chat-client';
import type {
  ChatMessage,
  ChatRoom,
  ChatRoomCode,
  ChatRoomParticipant,
} from '@/entities/chat/model/chat.types';
import { listChatParticipantCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { PageTitle } from '@/shared/ui/page-title/page-title';

type RealtimePayload = {
  type?: string;
  roomId?: string;
  payload?: unknown;
};

type InitialScrollTarget = {
  messageId: string;
  align: 'start' | 'end';
  unreadMessageId: string | null;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'нет активности';
  }

  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRoomTypeLabel(room: ChatRoom): string {
  if (room.code === 'objects') {
    return 'Объекты';
  }

  if (room.code === 'one_time_orders') {
    return 'Разовые заказы';
  }

  if (room.code === 'leadership') {
    return 'Руководство';
  }

  return 'Custom room';
}

function isAtBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

function getFirstUnreadMessageId(
  room: ChatRoom | null,
  messages: ChatMessage[],
  currentUserId: string | undefined,
): string | null {
  if (!room?.lastReadAt || room.unreadCount <= 0) {
    return null;
  }

  const lastReadAt = Date.parse(room.lastReadAt);

  if (!Number.isFinite(lastReadAt)) {
    return null;
  }

  return (
    messages.find((message) => {
      const createdAt = Date.parse(message.createdAt);
      const isOwnMessage =
        message.author !== null && message.author.id === currentUserId;

      return (
        Number.isFinite(createdAt) &&
        createdAt > lastReadAt &&
        !isOwnMessage
      );
    })?.id ?? null
  );
}

function getInitialScrollTarget(
  room: ChatRoom | null,
  messages: ChatMessage[],
  currentUserId: string | undefined,
): InitialScrollTarget | null {
  const latestMessage = messages.at(-1);

  if (!room || !latestMessage) {
    return null;
  }

  const unreadMessageId = getFirstUnreadMessageId(
    room,
    messages,
    currentUserId,
  );

  if (unreadMessageId) {
    return {
      messageId: unreadMessageId,
      align: 'start',
      unreadMessageId,
    };
  }

  return {
    messageId: latestMessage.id,
    align: 'end',
    unreadMessageId: null,
  };
}

function getParticipantRoleLabel(roleInRoom: string): string {
  return roleInRoom === 'admin' ? 'Администратор' : 'Участник';
}

function ParticipantPicker({
  candidates,
  selectedIds,
  onChange,
  placeholder,
}: {
  candidates: SystemUserOption[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  placeholder: string;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const selectedIdSet = new Set(selectedIds);
  const selectedUsers = candidates.filter((candidate) =>
    selectedIdSet.has(candidate.id),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const filteredCandidates = candidates
    .filter((candidate) => candidate.isActive && !selectedIdSet.has(candidate.id))
    .filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${candidate.fullName} ${candidate.login}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedQuery);
    })
    .slice(0, 8);

  const removeUser = (userId: string): void => {
    onChange(selectedIds.filter((selectedId) => selectedId !== userId));
  };

  return (
    <div className="participant-picker">
      <div className="participant-picker__chips">
        {selectedUsers.length === 0 ? (
          <span className="page-muted">Участники не выбраны.</span>
        ) : (
          selectedUsers.map((participant) => (
            <span key={participant.id} className="identity-chip">
              <span>
                <strong>{getUserDisplayName(participant)}</strong>
                {getUserSecondaryLabel(participant) ? (
                  <small>{getUserSecondaryLabel(participant)}</small>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Убрать ${getUserDisplayName(participant)}`}
                onClick={() => removeUser(participant.id)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
      />

      {filteredCandidates.length > 0 ? (
        <div className="participant-picker__options">
          {filteredCandidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => {
                onChange([...selectedIds, candidate.id]);
                setQuery('');
              }}
            >
              <span>
                <strong>{getUserDisplayName(candidate)}</strong>
                {getUserSecondaryLabel(candidate) ? (
                  <small>{getUserSecondaryLabel(candidate)}</small>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ChatsPage(): React.JSX.Element {
  const searchParams = useSearchParams();
  const requestedRoomCode = searchParams.get('room') as ChatRoomCode | null;
  const { user } = useAuth();
  const canManageChats = user?.capabilities?.canManageChats ?? false;
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<SystemUserOption[]>([]);
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomParticipantIds, setNewRoomParticipantIds] = useState<string[]>([]);
  const [renameTitle, setRenameTitle] = useState('');
  const [addParticipantIds, setAddParticipantIds] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [isParticipantsPanelOpen, setIsParticipantsPanelOpen] = useState(false);
  const [isRoomListOpen, setIsRoomListOpen] = useState(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [initialUnreadMessageId, setInitialUnreadMessageId] = useState<
    string | null
  >(null);
  const [roomParticipants, setRoomParticipants] = useState<
    ChatRoomParticipant[]
  >([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string | null>(null);
  const initialScrollRoomIdRef = useRef<string | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const latestMessageId = messages.at(-1)?.id ?? null;

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'auto'): void => {
    window.requestAnimationFrame(() => {
      const container = messageListRef.current;

      if (!container) {
        return;
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      setHasNewMessagesBelow(false);
    });
  };

  const loadRooms = async (): Promise<ChatRoom[]> => {
    const nextRooms = await listChatRooms();
    setRooms(nextRooms);

    if (!activeRoomId && nextRooms.length > 0) {
      const requestedRoom = requestedRoomCode
        ? nextRooms.find((room) => room.code === requestedRoomCode)
        : null;
      const fallbackRoom = requestedRoom ?? nextRooms[0];

      if (fallbackRoom) {
        setActiveRoomId(fallbackRoom.id);
        if (requestedRoomCode) {
          setIsRoomListOpen(false);
        }
      }
    }

    return nextRooms;
  };

  const loadMessages = async (roomId: string): Promise<ChatMessage[]> => {
    setIsLoadingMessages(true);
    try {
      const nextMessages = await listChatMessages(roomId);
      setMessages(nextMessages);
      return nextMessages;
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const markActiveRoomRead = async (messageId: string): Promise<void> => {
    if (!activeRoomId) {
      return;
    }

    if (lastMarkedReadMessageIdRef.current === messageId) {
      return;
    }

    const updatedRoom = await markChatRoomRead(activeRoomId, {
      lastReadMessageId: messageId,
    });
    lastMarkedReadMessageIdRef.current = messageId;
    setInitialUnreadMessageId(null);
    setRooms((current) =>
      current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
    );
  };

  const loadRoomParticipants = async (roomId: string): Promise<void> => {
    setIsLoadingParticipants(true);

    try {
      const nextParticipants = await listChatRoomParticipants(roomId);
      setRoomParticipants(nextParticipants);
    } catch {
      setRoomParticipants([]);
    } finally {
      setIsLoadingParticipants(false);
    }
  };

  useEffect(() => {
    setIsLoadingRooms(true);
    setError(null);

    void loadRooms()
      .catch((loadError) => {
        setError(getErrorMessage(loadError, 'Не удалось загрузить чаты.'));
        setRooms([]);
      })
      .finally(() => setIsLoadingRooms(false));
  }, []);

  useEffect(() => {
    if (!canManageChats) {
      return;
    }

    void listChatParticipantCandidates()
      .then(setParticipants)
      .catch(() => setParticipants([]));
  }, [canManageChats]);

  useEffect(() => {
    if (!activeRoomId) {
      setMessages([]);
      return;
    }

    setError(null);
    activeRoomIdRef.current = activeRoomId;
    lastMarkedReadMessageIdRef.current = null;
    initialScrollRoomIdRef.current = null;
    pendingScrollToBottomRef.current = false;
    setInitialUnreadMessageId(null);
    setHasNewMessagesBelow(false);
    setIsRoomSettingsOpen(false);
    setIsParticipantsPanelOpen(false);
    setRoomParticipants([]);
    void loadMessages(activeRoomId).catch((loadError) => {
      setError(getErrorMessage(loadError, 'Не удалось загрузить сообщения.'));
      setMessages([]);
    });
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoom) {
      setRenameTitle('');
      return;
    }

    setRenameTitle(activeRoom.title);
    setAddParticipantIds([]);
  }, [activeRoom]);

  useEffect(() => {
    if (!activeRoom || messages.length === 0) {
      return;
    }

    if (initialScrollRoomIdRef.current === activeRoom.id) {
      return;
    }

    const target = getInitialScrollTarget(activeRoom, messages, user?.id);

    if (!target) {
      return;
    }

    initialScrollRoomIdRef.current = activeRoom.id;
    setInitialUnreadMessageId(target.unreadMessageId);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const container = messageListRef.current;

        if (!container) {
          return;
        }

        const targetElement = Array.from(
          container.querySelectorAll<HTMLElement>('[data-message-id]'),
        ).find((element) => element.dataset.messageId === target.messageId);

        if (!targetElement) {
          return;
        }

        targetElement.scrollIntoView({
          block: target.align,
          behavior: 'auto',
        });
        setHasNewMessagesBelow(false);
      });
    });
  }, [activeRoom, messages, user?.id]);

  useEffect(() => {
    if (!pendingScrollToBottomRef.current) {
      return;
    }

    pendingScrollToBottomRef.current = false;
    scrollMessagesToBottom('auto');
  }, [activeRoomId, messages.length]);

  useEffect(() => {
    const root = messageListRef.current;
    const sentinel = bottomSentinelRef.current;

    if (!root || !sentinel || !activeRoomId || !latestMessageId) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isBottomVisible = entries.some((entry) => entry.isIntersecting);

        if (!isBottomVisible) {
          return;
        }

        setHasNewMessagesBelow(false);
        void markActiveRoomRead(latestMessageId).catch(() => undefined);
      },
      {
        root,
        threshold: 0.9,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [activeRoomId, latestMessageId]);

  useEffect(() => {
    const socket = new WebSocket(buildChatRealtimeUrl());

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as RealtimePayload;

        if (!payload.type?.startsWith('chat.')) {
          return;
        }

        if (payload.type === 'chat.room_updated') {
          void listChatRooms().then(setRooms).catch(() => undefined);
          return;
        }

        if (
          payload.type === 'chat.message_created' ||
          payload.type === 'chat.message_updated'
        ) {
          void listChatRooms().then(setRooms).catch(() => undefined);
        }

        if (payload.roomId && payload.roomId === activeRoomIdRef.current) {
          const shouldStickToBottom = messageListRef.current
            ? isAtBottom(messageListRef.current)
            : true;
          pendingScrollToBottomRef.current = shouldStickToBottom;
          setHasNewMessagesBelow(!shouldStickToBottom);

          if (
            (payload.type === 'chat.message_created' ||
              payload.type === 'chat.message_updated') &&
            payload.payload &&
            typeof payload.payload === 'object'
          ) {
            const incomingMessage = payload.payload as ChatMessage;
            setMessages((current) => {
              const exists = current.some((message) => message.id === incomingMessage.id);

              if (payload.type === 'chat.message_updated') {
                return current.map((message) =>
                  message.id === incomingMessage.id ? incomingMessage : message,
                );
              }

              return exists ? current : [...current, incomingMessage];
            });
          }
        }
      } catch {
        // Ignore malformed realtime events.
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!activeRoomId || isSending) {
      return;
    }

    setIsSending(true);
    setError(null);
    pendingScrollToBottomRef.current = true;
    setHasNewMessagesBelow(false);

    try {
      const sentMessage = await sendChatMessage({
        roomId: activeRoomId,
        text,
        files,
      });
      setText('');
      setFiles([]);
      setMessages((current) =>
        current.some((message) => message.id === sentMessage.id)
          ? current
          : [...current, sentMessage],
      );
      void loadRooms().catch(() => undefined);
    } catch (sendError) {
      setError(getErrorMessage(sendError, 'Не удалось отправить сообщение.'));
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateRoom = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!newRoomTitle.trim()) {
      return;
    }

    setError(null);

    try {
      const created = await createChatRoom({
        title: newRoomTitle.trim(),
        participantUserIds: newRoomParticipantIds,
      });
      setNewRoomTitle('');
      setNewRoomParticipantIds([]);
      setIsCreateRoomOpen(false);
      setIsRoomListOpen(false);
      await loadRooms();
      setActiveRoomId(created.id);
    } catch (createError) {
      setError(getErrorMessage(createError, 'Не удалось создать чат.'));
    }
  };

  const handleRenameRoom = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!activeRoom || !renameTitle.trim()) {
      return;
    }

    setError(null);

    try {
      await renameChatRoom(activeRoom.id, { title: renameTitle.trim() });
      setIsRoomSettingsOpen(false);
      await loadRooms();
    } catch (renameError) {
      setError(getErrorMessage(renameError, 'Не удалось переименовать чат.'));
    }
  };

  const handleAddParticipants = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!activeRoom || addParticipantIds.length === 0) {
      return;
    }

    setError(null);

    try {
      await addChatParticipants(activeRoom.id, { userIds: addParticipantIds });
      setAddParticipantIds([]);
      await loadRooms();
      if (isParticipantsPanelOpen) {
        await loadRoomParticipants(activeRoom.id);
      }
    } catch (addError) {
      setError(getErrorMessage(addError, 'Не удалось добавить участников.'));
    }
  };

  const handleEdit = async (message: ChatMessage): Promise<void> => {
    if (!editingText.trim()) {
      return;
    }

    setError(null);

    try {
      await editChatMessage(message.id, { text: editingText.trim() });
      setEditingMessageId(null);
      setEditingText('');
      await loadMessages(message.chatRoomId);
      await loadRooms();
    } catch (editError) {
      setError(getErrorMessage(editError, 'Не удалось изменить сообщение.'));
    }
  };

  const selectableParticipants = participants.filter(
    (participant) => participant.isActive,
  );
  const roomParticipantUserIds = new Set(
    roomParticipants.map((participant) => participant.user.id),
  );
  const addableParticipants = selectableParticipants.filter(
    (participant) => !roomParticipantUserIds.has(participant.id),
  );
  const activeRoomTypeLabel = activeRoom ? getRoomTypeLabel(activeRoom) : '';
  const layoutClassName = `chat-layout${
    isRoomListOpen ? ' chat-layout--room-list-open' : ''
  }`;
  const selectRoom = (roomId: string): void => {
    setActiveRoomId(roomId);
    setIsRoomListOpen(false);
  };

  const openParticipantsPanel = (): void => {
    if (!activeRoom) {
      return;
    }

    setIsParticipantsPanelOpen(true);
    void loadRoomParticipants(activeRoom.id);
  };

  const removePendingFile = (indexToRemove: number): void => {
    setFiles((current) =>
      current.filter((_file, index) => index !== indexToRemove),
    );
  };

  const handleTextKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    composerFormRef.current?.requestSubmit();
  };

  return (
    <>
      <PageTitle title="Чаты" />

      <div className="page-stack chat-page-stack">
        {error ? (
          <div className="page-card" style={{ color: '#b91c1c' }}>
            {error}
          </div>
        ) : null}

        <div className={layoutClassName}>
          <aside className="chat-room-panel page-card">
            <div className="section-header">
              <div>
                <div className="section-title">Комнаты</div>
                <div className="section-subtitle">
                  Рабочие чаты отдельно от комментариев.
                </div>
              </div>
              {canManageChats ? (
                <button
                  type="button"
                  className="chat-icon-button"
                  onClick={() => setIsCreateRoomOpen(true)}
                >
                  Новый чат
                </button>
              ) : null}
            </div>

            <div className="chat-room-list">
              {isLoadingRooms ? (
                <div className="page-muted">Загрузка комнат...</div>
              ) : rooms.length === 0 ? (
                <div className="page-muted">Доступных чатов пока нет.</div>
              ) : (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    className={`chat-room-item${
                      room.id === activeRoomId ? ' chat-room-item--active' : ''
                    }`}
                    type="button"
                    onClick={() => selectRoom(room.id)}
                  >
                    <span className="chat-room-item__main">
                      <strong>{room.title}</strong>
                      <span>
                        {room.lastMessagePreview ?? 'Сообщений пока нет'}
                      </span>
                    </span>
                    <span className="chat-room-item__meta">
                      <span className="chat-room-item__type">
                        {getRoomTypeLabel(room)}
                      </span>
                      <span>{formatDateTime(room.lastMessageAt)}</span>
                      {room.unreadCount > 0 ? (
                        <span className="chat-unread">{room.unreadCount}</span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="chat-main page-card">
            {activeRoom ? (
              <>
                <header className="chat-header">
                  <div className="chat-header__main">
                    <button
                      type="button"
                      className="chat-back-button"
                      onClick={() => setIsRoomListOpen(true)}
                    >
                      Комнаты
                    </button>
                    <div>
                      <div className="section-title">{activeRoom.title}</div>
                      <div className="section-subtitle">
                        <span className="chat-room-type-badge">
                          {activeRoomTypeLabel}
                        </span>
                        <button
                          type="button"
                          className="chat-participants-link"
                          onClick={openParticipantsPanel}
                        >
                          Участники: {activeRoom.participantCount}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="chat-header__actions">
                    <span className="status-pill">
                      {activeRoom.unreadCount > 0
                        ? `Новых: ${activeRoom.unreadCount}`
                        : 'Прочитано'}
                    </span>
                    {activeRoom.capabilities.canManage ? (
                      <button
                        type="button"
                        onClick={() =>
                          setIsRoomSettingsOpen((current) => !current)
                        }
                      >
                        Настройки
                      </button>
                    ) : null}
                  </div>
                </header>

                <div className="chat-message-stage">
                  <div
                    ref={messageListRef}
                    className="chat-message-list"
                    onScroll={() => {
                      if (
                        messageListRef.current &&
                        isAtBottom(messageListRef.current)
                      ) {
                        setHasNewMessagesBelow(false);
                      }
                    }}
                  >
                    {isLoadingMessages ? (
                      <div className="page-muted">Загрузка сообщений...</div>
                    ) : messages.length === 0 ? (
                      <div className="chat-empty">
                        Пока нет сообщений. Напишите текст или прикрепите файл.
                      </div>
                    ) : (
                      messages.map((message) => {
                        const isOwn = message.author?.id === user?.id;
                        const isEditing = editingMessageId === message.id;

                        return (
                          <React.Fragment key={message.id}>
                            {initialUnreadMessageId === message.id ? (
                              <div className="chat-unread-divider">
                                <span>Новые сообщения</span>
                              </div>
                            ) : null}
                          <article
                            data-message-id={message.id}
                            className={`chat-message ${
                              message.messageType === 'system'
                                ? 'chat-message--system'
                                : isOwn
                                  ? 'chat-message--own'
                                  : ''
                            }`}
                          >
                            <div className="chat-message__meta">
                              <strong>
                                {message.messageType === 'system'
                                  ? 'Система'
                                  : getUserDisplayName(message.author)}
                              </strong>
                              {message.author &&
                              getUserSecondaryLabel(message.author) ? (
                                <span>
                                  {getUserSecondaryLabel(message.author)}
                                </span>
                              ) : null}
                              <span>{formatDateTime(message.createdAt)}</span>
                              {message.editedAt ? <span>изменено</span> : null}
                            </div>

                            {isEditing ? (
                              <div className="chat-edit-box">
                                <textarea
                                  value={editingText}
                                  onChange={(event) =>
                                    setEditingText(event.target.value)
                                  }
                                  rows={3}
                                />
                                <div className="action-row">
                                  <button
                                    type="button"
                                    onClick={() => void handleEdit(message)}
                                  >
                                    Сохранить
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId(null);
                                      setEditingText('');
                                    }}
                                  >
                                    Отмена
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {message.text ? (
                                  <p className="chat-message__text">
                                    {message.text}
                                  </p>
                                ) : null}
                                {message.attachments.length > 0 ? (
                                  <AttachmentPreviewList
                                    files={message.attachments}
                                    emptyText=""
                                  />
                                ) : null}
                                {message.capabilities.canEdit ? (
                                  <button
                                    type="button"
                                    className="quiet-button"
                                    onClick={() => {
                                      setEditingMessageId(message.id);
                                      setEditingText(message.text ?? '');
                                    }}
                                  >
                                    Редактировать
                                  </button>
                                ) : null}
                              </>
                            )}
                          </article>
                          </React.Fragment>
                        );
                      })
                    )}
                    <div
                      ref={bottomSentinelRef}
                      className="chat-bottom-sentinel"
                      aria-hidden
                    />
                  </div>
                  {hasNewMessagesBelow ? (
                    <button
                      type="button"
                      className="chat-new-messages-button"
                      onClick={() => scrollMessagesToBottom('smooth')}
                    >
                      Новые сообщения ниже
                    </button>
                  ) : null}
                </div>

                {activeRoom.capabilities.canWrite ? (
                  <form
                    ref={composerFormRef}
                    className="chat-composer"
                    onSubmit={handleSend}
                  >
                    {files.length > 0 ? (
                      <div className="chat-pending-files">
                        <PendingMediaList files={files} onRemove={removePendingFile} />
                      </div>
                    ) : null}
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={handleTextKeyDown}
                      placeholder="Сообщение"
                      rows={2}
                    />
                    <div className="chat-composer__actions">
                      <label className="file-picker-button">
                        <span>Вложения</span>
                        <input
                          type="file"
                          multiple
                          onChange={(event) => {
                            const selectedFiles = Array.from(
                              event.currentTarget.files ?? [],
                            );
                            setFiles((current) => [...current, ...selectedFiles]);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <span className="page-muted">
                        {files.length > 0
                          ? `Выбрано файлов: ${files.length}`
                          : 'Текст, фото или файл'}
                      </span>
                      <button
                        type="submit"
                        disabled={isSending || (!text.trim() && files.length === 0)}
                      >
                        Отправить
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="chat-readonly-notice">
                    Нет права писать в этот чат.
                  </div>
                )}
              </>
            ) : (
              <div className="chat-empty">Выберите чат слева.</div>
            )}
          </section>
        </div>

        {canManageChats && isCreateRoomOpen ? (
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsCreateRoomOpen(false);
              }
            }}
          >
            <form className="chat-modal" onSubmit={handleCreateRoom}>
              <div className="section-header">
                <div>
                  <div className="section-title">Новый чат</div>
                  <div className="section-subtitle">
                    Участники увидят историю только после добавления.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateRoomOpen(false)}
                >
                  Закрыть
                </button>
              </div>

              <label>
                <span>Название</span>
                <input
                  value={newRoomTitle}
                  onChange={(event) => setNewRoomTitle(event.target.value)}
                  placeholder="Например: Бригада вечер"
                  autoFocus
                />
              </label>

              <label>
                <span>Участники</span>
                <ParticipantPicker
                  candidates={selectableParticipants}
                  selectedIds={newRoomParticipantIds}
                  onChange={setNewRoomParticipantIds}
                  placeholder="Найти участника по ФИО"
                />
              </label>

              <div className="action-row">
                <button type="submit">Создать чат</button>
                <button
                  type="button"
                  onClick={() => {
                    setNewRoomTitle('');
                    setNewRoomParticipantIds([]);
                    setIsCreateRoomOpen(false);
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {activeRoom?.capabilities.canManage && isRoomSettingsOpen ? (
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsRoomSettingsOpen(false);
              }
            }}
          >
            <form className="chat-modal" onSubmit={handleRenameRoom}>
              <div className="section-header">
                <div>
                  <div className="section-title">Настройки комнаты</div>
                  <div className="section-subtitle">
                    Управление названием без лишнего шума в списке комнат.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRoomSettingsOpen(false)}
                >
                  Закрыть
                </button>
              </div>

              <label>
                <span>Название комнаты</span>
                <input
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  aria-label="Название чата"
                />
              </label>

              <div className="action-row">
                <button type="submit">Сохранить название</button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomSettingsOpen(false);
                    openParticipantsPanel();
                  }}
                >
                  Участники
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {activeRoom && isParticipantsPanelOpen ? (
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsParticipantsPanelOpen(false);
              }
            }}
          >
            <div className="chat-modal chat-modal--wide">
              <div className="section-header">
                <div>
                  <div className="section-title">Участники</div>
                  <div className="section-subtitle">
                    {activeRoom.title} · {activeRoomTypeLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsParticipantsPanelOpen(false)}
                >
                  Закрыть
                </button>
              </div>

              {isLoadingParticipants ? (
                <div className="page-muted">Загрузка участников...</div>
              ) : roomParticipants.length === 0 ? (
                <div className="page-muted">Участники пока не загружены.</div>
              ) : (
                <div className="chat-participant-list">
                  {roomParticipants.map((participant) => (
                    <div key={participant.id} className="chat-participant-row">
                      <div>
                        <strong>{getUserDisplayName(participant.user)}</strong>
                        {getUserSecondaryLabel(participant.user) ? (
                          <div className="identity-secondary">
                            {getUserSecondaryLabel(participant.user)}
                          </div>
                        ) : null}
                      </div>
                      <div className="chat-participant-row__meta">
                        <span className="status-pill">
                          {getParticipantRoleLabel(participant.roleInRoom)}
                        </span>
                        <span>
                          с {formatDateTime(participant.joinedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeRoom.capabilities.canManage &&
              activeRoom.visibilityType === 'explicit_members' ? (
                <form
                  className="chat-participant-add-form"
                  onSubmit={handleAddParticipants}
                >
                  <div>
                    <div className="section-title">Добавить участников</div>
                    <div className="section-subtitle">
                      Новые участники увидят историю только после добавления.
                    </div>
                  </div>
                  <ParticipantPicker
                    candidates={addableParticipants}
                    selectedIds={addParticipantIds}
                    onChange={setAddParticipantIds}
                    placeholder="Найти пользователя"
                  />
                  <button
                    type="submit"
                    disabled={addParticipantIds.length === 0}
                  >
                    Добавить выбранных
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
