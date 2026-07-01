'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';

import {
  addChatParticipants,
  buildChatRealtimeUrl,
  closeChatRoom,
  createDirectChat,
  createGroupChat,
  deleteChatMessage,
  editChatMessage,
  forwardChatMessage,
  hideChatRoom,
  leaveChatRoom,
  listChatRoomParticipants,
  listChatMessages,
  listChatRooms,
  markChatRoomRead,
  renameChatRoom,
  searchChats,
  sendChatMessage,
  toggleChatMessageHeart,
  unhideChatRoom,
} from '@/entities/chat/api/chat-client';
import type {
  ChatMessage,
  ChatRoom,
  ChatRoomCode,
  ChatRoomParticipant,
  ChatSearchResponse,
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
  target: 'message' | 'bottom';
  unreadMessageId: string | null;
};

type LoadMessagesOptions = {
  scheduleInitial?: boolean;
  roomSnapshot?: ChatRoom | null;
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

  if (room.roomType === 'direct') {
    return 'Личный чат';
  }

  if (room.roomType === 'group') {
    return 'Группа';
  }

  return 'Чат';
}

function getRoomDisplayTitle(room: ChatRoom): string {
  return room.displayTitle || room.title;
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

  if (!latestMessage) {
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
      target: 'message',
      unreadMessageId,
    };
  }

  return {
    messageId: latestMessage.id,
    target: 'bottom',
    unreadMessageId: null,
  };
}

function getInitialScrollRunId(
  roomId: string,
  room: ChatRoom | null,
  messages: ChatMessage[],
  target: InitialScrollTarget,
): string {
  return [
    roomId,
    room?.lastReadAt ?? 'no-read-marker',
    room?.unreadCount ?? 0,
    target.target,
    target.messageId,
    messages.length,
    messages.at(-1)?.id ?? 'empty',
  ].join(':');
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

  const addUser = (userId: string): void => {
    onChange(Array.from(new Set([...selectedIds, userId])));
    setQuery('');
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
              onClick={() => addUser(candidate.id)}
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
  const canCreateDirectChat = user?.capabilities?.canCreateDirectChat ?? false;
  const canCreateGroupChat = user?.capabilities?.canCreateGroupChat ?? false;
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [archivedRooms, setArchivedRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<SystemUserOption[]>([]);
  const [newRoomMode, setNewRoomMode] = useState<'direct' | 'group'>('direct');
  const [directTargetUserId, setDirectTargetUserId] = useState('');
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomParticipantIds, setNewRoomParticipantIds] = useState<string[]>([]);
  const [renameTitle, setRenameTitle] = useState('');
  const [addParticipantIds, setAddParticipantIds] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(
    null,
  );
  const [forwardTargetRoomId, setForwardTargetRoomId] = useState('');
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingArchivedRooms, setIsLoadingArchivedRooms] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [isParticipantsPanelOpen, setIsParticipantsPanelOpen] = useState(false);
  const [isRoomListOpen, setIsRoomListOpen] = useState(true);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [initialUnreadMessageId, setInitialUnreadMessageId] = useState<
    string | null
  >(null);
  const [roomParticipants, setRoomParticipants] = useState<
    ChatRoomParticipant[]
  >([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSearchResponse>({
    rooms: [],
    messages: [],
  });
  const [isSearching, setIsSearching] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string | null>(null);
  const initialScrollRunIdRef = useRef<string | null>(null);
  const scheduledInitialScrollRunIdRef = useRef<string | null>(null);
  const initialScrollTimeoutsRef = useRef<number[]>([]);
  const openingRoomSnapshotRef = useRef<ChatRoom | null>(null);
  const isInitialScrollPendingRef = useRef(false);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const latestMessageId = messages.at(-1)?.id ?? null;

  const clearInitialScrollTimers = useCallback((): void => {
    for (const timeoutId of initialScrollTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }

    initialScrollTimeoutsRef.current = [];
    scheduledInitialScrollRunIdRef.current = null;
  }, []);

  const forceScrollMessagesToBottom = useCallback((): boolean => {
    const container = messageListRef.current;

    if (!container) {
      return false;
    }

    container.scrollTop = container.scrollHeight;
    setHasNewMessagesBelow(false);

    return true;
  }, []);

  const scrollMessagesToBottom = useCallback((
    behavior: ScrollBehavior = 'auto',
  ): void => {
    const container = messageListRef.current;

    if (!container) {
      return;
    }

    if (behavior === 'auto') {
      forceScrollMessagesToBottom();
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    setHasNewMessagesBelow(false);
  }, [forceScrollMessagesToBottom]);

  const scrollToMessage = useCallback((messageId: string): boolean => {
    const container = messageListRef.current;

    if (!container) {
      return false;
    }

    const targetElement = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((element) => element.dataset.messageId === messageId);

    if (!targetElement) {
      return false;
    }

    targetElement.scrollIntoView({
      block: 'start',
      behavior: 'auto',
    });
    setHasNewMessagesBelow(false);

    return true;
  }, []);

  const scheduleInitialScroll = useCallback((
    target: InitialScrollTarget,
    runId: string,
  ): void => {
    if (initialScrollRunIdRef.current === runId) {
      return;
    }

    clearInitialScrollTimers();
    isInitialScrollPendingRef.current = true;
    scheduledInitialScrollRunIdRef.current = runId;
    let isDone = false;

    if (target.target === 'bottom') {
      const runBottomCorrection = (isFinalAttempt: boolean): void => {
        if (isDone || scheduledInitialScrollRunIdRef.current !== runId) {
          return;
        }

        forceScrollMessagesToBottom();

        if (isFinalAttempt) {
          isDone = true;
          initialScrollRunIdRef.current = runId;
          isInitialScrollPendingRef.current = false;
          scheduledInitialScrollRunIdRef.current = null;
          initialScrollTimeoutsRef.current = [];
        }
      };

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          runBottomCorrection(false);
        });
      });

      for (const delayMs of [60, 160]) {
        const timeoutId = window.setTimeout(() => {
          runBottomCorrection(false);
        }, delayMs);
        initialScrollTimeoutsRef.current.push(timeoutId);
      }

      const finalTimeoutId = window.setTimeout(() => {
        runBottomCorrection(true);
      }, 320);
      initialScrollTimeoutsRef.current.push(finalTimeoutId);
      return;
    }

    const finishMessageAttempts = (): void => {
      initialScrollRunIdRef.current = runId;
      isInitialScrollPendingRef.current = false;
      scheduledInitialScrollRunIdRef.current = null;
      clearInitialScrollTimers();
    };

    const attemptMessageScroll = (isFinalAttempt: boolean): void => {
      if (isDone || scheduledInitialScrollRunIdRef.current !== runId) {
        return;
      }

      if (scrollToMessage(target.messageId) || isFinalAttempt) {
        isDone = true;
        finishMessageAttempts();
        return;
      }
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        attemptMessageScroll(false);
      });
    });

    for (const delayMs of [60, 160]) {
      const timeoutId = window.setTimeout(() => {
        attemptMessageScroll(false);
      }, delayMs);
      initialScrollTimeoutsRef.current.push(timeoutId);
    }

    const finalTimeoutId = window.setTimeout(() => {
      attemptMessageScroll(true);
    }, 320);
    initialScrollTimeoutsRef.current.push(finalTimeoutId);
  }, [
    clearInitialScrollTimers,
    forceScrollMessagesToBottom,
    scrollToMessage,
  ]);

  const loadRooms = async (): Promise<ChatRoom[]> => {
    const nextRooms = await listChatRooms({ view: 'active' });
    setRooms(nextRooms);

    if (!activeRoomId && requestedRoomCode) {
      const requestedRoom = nextRooms.find((room) => room.code === requestedRoomCode);

      if (requestedRoom) {
        openingRoomSnapshotRef.current = requestedRoom;
        initialScrollRunIdRef.current = null;
        setActiveRoomId(requestedRoom.id);
        setIsRoomListOpen(false);
      }
    }

    return nextRooms;
  };

  const loadArchivedRooms = async (): Promise<ChatRoom[]> => {
    setIsLoadingArchivedRooms(true);

    try {
      const nextRooms = await listChatRooms({ view: 'archived' });
      setArchivedRooms(nextRooms);
      return nextRooms;
    } finally {
      setIsLoadingArchivedRooms(false);
    }
  };

  const refreshRoomLists = async (): Promise<ChatRoom[]> => {
    const [nextRooms] = await Promise.all([loadRooms(), loadArchivedRooms()]);

    return nextRooms;
  };

  const loadMessages = async (
    roomId: string,
    options: LoadMessagesOptions = {},
  ): Promise<ChatMessage[]> => {
    setIsLoadingMessages(true);

    try {
      const nextMessages = await listChatMessages(roomId);
      setMessages(nextMessages);

      if (options?.scheduleInitial) {
        const roomSnapshot =
          options.roomSnapshot ?? openingRoomSnapshotRef.current;

        const target = getInitialScrollTarget(roomSnapshot, nextMessages, user?.id);

        setInitialUnreadMessageId(target?.unreadMessageId ?? null);

        if (target) {
          scheduleInitialScroll(
            target,
            getInitialScrollRunId(roomId, roomSnapshot, nextMessages, target),
          );
        } else {
          initialScrollRunIdRef.current = `${roomId}:empty`;
          isInitialScrollPendingRef.current = false;
        }
      }

      return nextMessages;
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const markRoomRead = async (
    roomId: string,
    messageId: string,
  ): Promise<void> => {
    if (activeRoomIdRef.current !== roomId) {
      return;
    }

    if (lastMarkedReadMessageIdRef.current === messageId) {
      return;
    }

    const updatedRoom = await markChatRoomRead(roomId, {
      lastReadMessageId: messageId,
    });

    lastMarkedReadMessageIdRef.current = messageId;
    setInitialUnreadMessageId(null);

    setRooms((current) =>
      current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
    );

    setArchivedRooms((current) =>
      current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
    );
  };

  const scheduleMarkLatestMessageRead = (
    roomId: string,
    messageId: string,
  ): void => {
    const tryMarkRead = (attempt = 0): void => {
      if (activeRoomIdRef.current !== roomId) {
        return;
      }

      if (lastMarkedReadMessageIdRef.current === messageId) {
        return;
      }

      const container = messageListRef.current;

      if (!container) {
        return;
      }

      if (isInitialScrollPendingRef.current && attempt < 8) {
        window.setTimeout(() => tryMarkRead(attempt + 1), 80);
        return;
      }

      if (!isAtBottom(container)) {
        return;
      }

      void markRoomRead(roomId, messageId).catch(() => undefined);
    };

    window.setTimeout(() => tryMarkRead(), 360);
  };

  const resetActiveChatSelection = (): void => {
    clearInitialScrollTimers();

    openingRoomSnapshotRef.current = null;
    initialScrollRunIdRef.current = null;
    scheduledInitialScrollRunIdRef.current = null;
    lastMarkedReadMessageIdRef.current = null;
    activeRoomIdRef.current = null;
    isInitialScrollPendingRef.current = false;
    pendingScrollToBottomRef.current = false;

    setActiveRoomId(null);
    setMessages([]);
    setInitialUnreadMessageId(null);
    setHasNewMessagesBelow(false);
    setRoomParticipants([]);
    setReplyingTo(null);
    setForwardingMessage(null);
    setForwardTargetRoomId('');
    setIsRoomSettingsOpen(false);
    setIsParticipantsPanelOpen(false);
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

    void refreshRoomLists()
      .catch((loadError) => {
        setError(getErrorMessage(loadError, 'Не удалось загрузить чаты.'));
        setRooms([]);
        setArchivedRooms([]);
      })
      .finally(() => setIsLoadingRooms(false));
  }, []);

  useEffect(() => () => clearInitialScrollTimers(), [clearInitialScrollTimers]);

  useEffect(() => {
    if (!canManageChats && !canCreateDirectChat && !canCreateGroupChat) {
      return;
    }

    void listChatParticipantCandidates()
      .then(setParticipants)
      .catch(() => setParticipants([]));
  }, [canManageChats, canCreateDirectChat, canCreateGroupChat]);

  useEffect(() => {
    if (!activeRoomId) {
      resetActiveChatSelection();
      return;
    }

    setError(null);
    activeRoomIdRef.current = activeRoomId;
    lastMarkedReadMessageIdRef.current = null;
    clearInitialScrollTimers();
    initialScrollRunIdRef.current = null;
    isInitialScrollPendingRef.current = false;
    pendingScrollToBottomRef.current = false;
    setInitialUnreadMessageId(null);
    setHasNewMessagesBelow(false);
    setIsRoomSettingsOpen(false);
    setIsParticipantsPanelOpen(false);
    setRoomParticipants([]);
    const roomSnapshot =
      openingRoomSnapshotRef.current?.id === activeRoomId
        ? openingRoomSnapshotRef.current
        : rooms.find((room) => room.id === activeRoomId) ?? null;

    openingRoomSnapshotRef.current = roomSnapshot;

    void loadMessages(activeRoomId, {
      scheduleInitial: true,
      roomSnapshot,
    })
      .then((nextMessages) => {
        const latestLoadedMessageId = nextMessages.at(-1)?.id;

        if (latestLoadedMessageId) {
          scheduleMarkLatestMessageRead(activeRoomId, latestLoadedMessageId);
        }
      })
      .catch((loadError) => {
        setError(getErrorMessage(loadError, 'Не удалось загрузить сообщения.'));
        setMessages([]);
        isInitialScrollPendingRef.current = false;
      });
  }, [activeRoomId, clearInitialScrollTimers]);

  useEffect(() => {
    if (!activeRoom) {
      setRenameTitle('');
      return;
    }

    setRenameTitle(activeRoom.title);
    setAddParticipantIds([]);
  }, [activeRoom]);

  useEffect(() => {
    const query = searchQuery.trim();

    if (query.length < 2) {
      setSearchResults({ rooms: [], messages: [] });
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      void searchChats(query)
        .then((results) => {
          if (!isCancelled) {
            setSearchResults(results);
          }
        })
        .catch((searchError) => {
          if (!isCancelled) {
            setError(getErrorMessage(searchError, 'Не удалось выполнить поиск.'));
          }
        })
        .finally(() => {
          if (!isCancelled) {
            setIsSearching(false);
          }
        });
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

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

        if (isInitialScrollPendingRef.current) {
          return;
        }

        setHasNewMessagesBelow(false);
        void markRoomRead(activeRoomId, latestMessageId).catch(() => undefined);
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

        if (
          payload.type === 'chat.room_updated' ||
          payload.type === 'chat.room_created' ||
          payload.type === 'chat.room_unhidden'
        ) {
          void refreshRoomLists().catch(() => undefined);
          return;
        }

        if (
          payload.type === 'chat.room_hidden' ||
          payload.type === 'chat.room_left' ||
          payload.type === 'chat.room_closed'
        ) {
          void refreshRoomLists()
            .then((nextRooms) => {
              if (
                payload.roomId === activeRoomIdRef.current &&
                !nextRooms.some((room) => room.id === payload.roomId)
              ) {
                resetActiveChatSelection();
              }
            })
            .catch(() => undefined);
          return;
        }

        if (
          payload.type === 'chat.message_created' ||
          payload.type === 'chat.message_updated'
        ) {
          void refreshRoomLists().catch(() => undefined);
        }

        if (payload.roomId && payload.roomId === activeRoomIdRef.current) {
          const isMessageCreated = payload.type === 'chat.message_created';
          const isMessageUpdated = payload.type === 'chat.message_updated';

          if (
            (isMessageCreated || isMessageUpdated) &&
            payload.payload &&
            typeof payload.payload === 'object'
          ) {
            const incomingMessage = payload.payload as ChatMessage;

            if (isMessageCreated) {
              const shouldStickToBottom = messageListRef.current
                ? isAtBottom(messageListRef.current)
                : true;

              pendingScrollToBottomRef.current = shouldStickToBottom;
              setHasNewMessagesBelow(!shouldStickToBottom);
            }

            setMessages((current) => {
              const exists = current.some((message) => message.id === incomingMessage.id);

              if (isMessageUpdated) {
                return current.map((message) =>
                  message.id === incomingMessage.id
                    ? {
                        ...incomingMessage,
                        capabilities: message.capabilities,
                        myReactions: message.myReactions,
                      }
                    : message,
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
        replyToMessageId: replyingTo?.id,
      });
      setText('');
      setFiles([]);
      setReplyingTo(null);
      setMessages((current) =>
        current.some((message) => message.id === sentMessage.id)
          ? current
          : [...current, sentMessage],
      );
      void refreshRoomLists().catch(() => undefined);
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

    if (newRoomMode === 'direct' && !directTargetUserId) {
      return;
    }

    if (
      newRoomMode === 'group' &&
      (!newRoomTitle.trim() || newRoomParticipantIds.length === 0)
    ) {
      return;
    }

    setError(null);

    try {
      const created =
        newRoomMode === 'direct'
          ? await createDirectChat({ targetUserId: directTargetUserId })
          : await createGroupChat({
              title: newRoomTitle.trim(),
              participantUserIds: newRoomParticipantIds,
            });

      setDirectTargetUserId('');
      setNewRoomTitle('');
      setNewRoomParticipantIds([]);
      setIsCreateRoomOpen(false);
      setIsRoomListOpen(false);
      const nextRooms = await refreshRoomLists();
      openingRoomSnapshotRef.current =
        nextRooms.find((room) => room.id === created.id) ?? created;
      initialScrollRunIdRef.current = null;
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
      await refreshRoomLists();
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
      await refreshRoomLists();
      if (isParticipantsPanelOpen) {
        await loadRoomParticipants(activeRoom.id);
      }
    } catch (addError) {
      setError(getErrorMessage(addError, 'Не удалось добавить участников.'));
    }
  };

  const clearActiveRoomAfterRemoval = async (): Promise<void> => {
    await refreshRoomLists();
    resetActiveChatSelection();
  };

  const handleHideRoom = async (): Promise<void> => {
    if (!activeRoom) {
      return;
    }

    setError(null);

    try {
      await hideChatRoom(activeRoom.id);
      await clearActiveRoomAfterRemoval();
    } catch (hideError) {
      setError(getErrorMessage(hideError, 'Не удалось скрыть чат.'));
    }
  };

  const handleOpenArchivedRoom = async (roomId: string): Promise<void> => {
    setError(null);

    try {
      const restoredRoom = await unhideChatRoom(roomId);
      const nextRooms = await refreshRoomLists();
      const roomSnapshot =
        nextRooms.find((room) => room.id === restoredRoom.id) ?? restoredRoom;

      openingRoomSnapshotRef.current = roomSnapshot;
      initialScrollRunIdRef.current = null;
      setActiveRoomId(restoredRoom.id);
      setIsArchiveOpen(false);
      setIsRoomListOpen(false);
    } catch (unhideError) {
      setError(getErrorMessage(unhideError, 'Не удалось вернуть чат из архива.'));
    }
  };

  const handleUnhideRoom = async (roomId: string): Promise<void> => {
    setError(null);

    try {
      await unhideChatRoom(roomId);
      await refreshRoomLists();
    } catch (unhideError) {
      setError(getErrorMessage(unhideError, 'Не удалось вернуть чат из архива.'));
    }
  };

  const handleLeaveRoom = async (): Promise<void> => {
    if (!activeRoom) {
      return;
    }

    if (!window.confirm('Покинуть групповой чат?')) {
      return;
    }

    setError(null);

    try {
      await leaveChatRoom(activeRoom.id);
      await clearActiveRoomAfterRemoval();
    } catch (leaveError) {
      setError(getErrorMessage(leaveError, 'Не удалось покинуть чат.'));
    }
  };

  const handleCloseRoom = async (): Promise<void> => {
    if (!activeRoom) {
      return;
    }

    const reason = window.prompt('Причина закрытия чата для всех', '');

    if (reason === null) {
      return;
    }

    setError(null);

    try {
      await closeChatRoom(activeRoom.id, { reason: reason.trim() || undefined });
      await clearActiveRoomAfterRemoval();
    } catch (closeError) {
      setError(getErrorMessage(closeError, 'Не удалось закрыть чат.'));
    }
  };

  const handleEdit = async (message: ChatMessage): Promise<void> => {
    if (!editingText.trim()) {
      return;
    }

    setError(null);

    try {
      const updatedMessage = await editChatMessage(message.id, {
        text: editingText.trim(),
      });
      setEditingMessageId(null);
      setEditingText('');
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === updatedMessage.id ? updatedMessage : currentMessage,
        ),
      );
      void refreshRoomLists().catch(() => undefined);
    } catch (editError) {
      setError(getErrorMessage(editError, 'Не удалось изменить сообщение.'));
    }
  };

  const handleDeleteMessage = async (message: ChatMessage): Promise<void> => {
    if (!window.confirm('Удалить сообщение?')) {
      return;
    }

    setError(null);

    try {
      const updatedMessage = await deleteChatMessage(message.id);
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === updatedMessage.id ? updatedMessage : currentMessage,
        ),
      );
      void refreshRoomLists().catch(() => undefined);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Не удалось удалить сообщение.'));
    }
  };

  const handleForwardMessage = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!forwardingMessage || !forwardTargetRoomId) {
      return;
    }

    setError(null);

    try {
      await forwardChatMessage(forwardingMessage.id, {
        targetRoomId: forwardTargetRoomId,
      });
      setForwardingMessage(null);
      setForwardTargetRoomId('');
      await refreshRoomLists();
    } catch (forwardError) {
      setError(getErrorMessage(forwardError, 'Не удалось переслать сообщение.'));
    }
  };

  const handleToggleHeart = async (message: ChatMessage): Promise<void> => {
    setError(null);

    try {
      const updatedMessage = await toggleChatMessageHeart(message.id);
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === updatedMessage.id ? updatedMessage : currentMessage,
        ),
      );
    } catch (reactionError) {
      setError(getErrorMessage(reactionError, 'Не удалось изменить реакцию.'));
    }
  };

  const selectableParticipants = participants.filter(
    (participant) => participant.isActive,
  );
  const directParticipants = selectableParticipants.filter(
    (participant) => participant.id !== user?.id,
  );
  const roomParticipantUserIds = new Set(
    roomParticipants.map((participant) => participant.user.id),
  );
  const addableParticipants = selectableParticipants.filter(
    (participant) => !roomParticipantUserIds.has(participant.id),
  );
  const isCreateRoomDisabled =
    newRoomMode === 'direct'
      ? !directTargetUserId
      : !newRoomTitle.trim() || newRoomParticipantIds.length === 0;
  const forwardTargetRooms = rooms.filter(
    (room) => room.id !== activeRoomId && room.capabilities.canWrite,
  );
  const activeRoomTypeLabel = activeRoom ? getRoomTypeLabel(activeRoom) : '';
  const layoutClassName = `chat-layout${
    isRoomListOpen ? ' chat-layout--room-list-open' : ''
  }`;
  const selectRoom = (roomId: string): void => {
    openingRoomSnapshotRef.current =
      rooms.find((room) => room.id === roomId) ?? null;
    initialScrollRunIdRef.current = null;
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
              {canCreateDirectChat || canCreateGroupChat ? (
                <button
                  type="button"
                  className="chat-icon-button"
                  onClick={() => {
                    setNewRoomMode(canCreateDirectChat ? 'direct' : 'group');
                    setIsCreateRoomOpen(true);
                  }}
                >
                  Новый чат
                </button>
              ) : null}
            </div>

            <div className="chat-search-box">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск по чатам и сообщениям"
                aria-label="Поиск по чатам и сообщениям"
              />
              {searchQuery.trim().length >= 2 ? (
                <div className="chat-search-results">
                  {isSearching ? (
                    <div className="page-muted">Поиск...</div>
                  ) : searchResults.rooms.length === 0 &&
                    searchResults.messages.length === 0 ? (
                    <div className="page-muted">Ничего не найдено.</div>
                  ) : (
                    <>
                      {searchResults.rooms.length > 0 ? (
                        <div className="chat-search-group">
                          <strong>Чаты</strong>
                          {searchResults.rooms.map((room) => (
                            <button
                              key={room.id}
                              type="button"
                              onClick={() => {
                                selectRoom(room.id);
                                setSearchQuery('');
                              }}
                            >
                              <span>{room.displayTitle || room.title}</span>
                              <small>{room.lastMessagePreview ?? 'Без сообщений'}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {searchResults.messages.length > 0 ? (
                        <div className="chat-search-group">
                          <strong>Сообщения</strong>
                          {searchResults.messages.map((message) => (
                            <button
                              key={message.id}
                              type="button"
                              onClick={() => {
                                selectRoom(message.roomId);
                                setSearchQuery('');
                              }}
                            >
                              <span>{message.room.displayTitle || message.room.title}</span>
                              <small>{message.text}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
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
                      <strong>{getRoomDisplayTitle(room)}</strong>
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

            <div className="chat-archive-block">
              <button
                type="button"
                className="chat-archive-toggle"
                onClick={() => setIsArchiveOpen((current) => !current)}
              >
                <span>Архив</span>
                <span>{archivedRooms.length}</span>
              </button>

              {isArchiveOpen ? (
                <div className="chat-room-list chat-room-list--archive">
                  {isLoadingArchivedRooms ? (
                    <div className="page-muted">Загрузка архива...</div>
                  ) : archivedRooms.length === 0 ? (
                    <div className="page-muted">В архиве пока пусто.</div>
                  ) : (
                    archivedRooms.map((room) => (
                      <div key={room.id} className="chat-room-item chat-room-item--archived">
                        <button
                          type="button"
                          className="chat-room-item__open"
                          onClick={() => void handleOpenArchivedRoom(room.id)}
                        >
                          <span className="chat-room-item__main">
                            <strong>{getRoomDisplayTitle(room)}</strong>
                            <span>
                              {room.lastMessagePreview ?? 'Сообщений пока нет'}
                            </span>
                          </span>
                          <span className="chat-room-item__meta">
                            <span className="chat-room-item__type">
                              {getRoomTypeLabel(room)}
                            </span>
                            <span>{formatDateTime(room.lastMessageAt)}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => void handleUnhideRoom(room.id)}
                        >
                          Вернуть
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
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
                      <div className="section-title">{getRoomDisplayTitle(activeRoom)}</div>
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
                    {activeRoom.capabilities.canHide ? (
                      <button type="button" onClick={() => void handleHideRoom()}>
                        Скрыть
                      </button>
                    ) : null}
                    {activeRoom.capabilities.canLeave ? (
                      <button type="button" onClick={() => void handleLeaveRoom()}>
                        Покинуть
                      </button>
                    ) : null}
                    {activeRoom.capabilities.canCloseGlobally ? (
                      <button type="button" onClick={() => void handleCloseRoom()}>
                        Закрыть для всех
                      </button>
                    ) : null}
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

                            {isEditing && !message.isDeleted ? (
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
                                {message.replyTo ? (
                                  <div className="chat-reply-preview">
                                    <strong>
                                      {message.replyTo.author
                                        ? getUserDisplayName(message.replyTo.author)
                                        : 'Система'}
                                    </strong>
                                    <span>
                                      {message.replyTo.text || 'Сообщение без текста'}
                                    </span>
                                  </div>
                                ) : null}
                                {message.forwardedFrom ? (
                                  <div className="chat-forwarded-label">
                                    Переслано ·{' '}
                                    {message.forwardedFrom.author
                                      ? getUserDisplayName(
                                          message.forwardedFrom.author,
                                        )
                                      : 'Пользователь'}
                                  </div>
                                ) : null}
                                {message.text ? (
                                  <p className="chat-message__text">
                                    {message.text}
                                  </p>
                                ) : null}
                                {!message.isDeleted && message.attachments.length > 0 ? (
                                  <AttachmentPreviewList
                                    files={message.attachments}
                                    emptyText=""
                                  />
                                ) : null}
                                {!message.isDeleted ? (
                                  <div className="action-row">
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
                                    {message.capabilities.canDelete ? (
                                      <button
                                        type="button"
                                        className="quiet-button"
                                        onClick={() => void handleDeleteMessage(message)}
                                      >
                                        Удалить
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="quiet-button"
                                      onClick={() => {
                                        setReplyingTo(message);
                                        composerFormRef.current?.querySelector('textarea')?.focus();
                                      }}
                                    >
                                      Ответить
                                    </button>
                                    {message.messageType === 'user' ? (
                                      <button
                                        type="button"
                                        className="quiet-button"
                                        onClick={() => {
                                          setForwardingMessage(message);
                                          setForwardTargetRoomId(
                                            forwardTargetRooms.at(0)?.id ?? '',
                                          );
                                        }}
                                      >
                                        Переслать
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className={`chat-reaction-button ${
                                        message.myReactions.includes('heart')
                                          ? 'is-active'
                                          : ''
                                      }`}
                                      onClick={() => void handleToggleHeart(message)}
                                      aria-label="Поставить реакцию сердце"
                                    >
                                      ♥ {message.reactionCounts.heart ?? 0}
                                    </button>
                                  </div>
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
                    {replyingTo ? (
                      <div className="chat-composer-reply">
                        <div>
                          <strong>
                            Ответ для {replyingTo.author
                              ? getUserDisplayName(replyingTo.author)
                              : 'Система'}
                          </strong>
                          <span>{replyingTo.text || 'Сообщение без текста'}</span>
                        </div>
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => setReplyingTo(null)}
                        >
                          Отменить
                        </button>
                      </div>
                    ) : null}
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

        {(canCreateDirectChat || canCreateGroupChat) && isCreateRoomOpen ? (
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
                    Личный диалог или рабочая группа без смешивания с системными комнатами.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateRoomOpen(false)}
                >
                  Закрыть
                </button>
              </div>

              <div className="chat-mode-switch" role="group" aria-label="Тип чата">
                {canCreateDirectChat ? (
                  <button
                    type="button"
                    className={
                      newRoomMode === 'direct' ? 'is-active' : undefined
                    }
                    onClick={() => setNewRoomMode('direct')}
                  >
                    Личный чат
                  </button>
                ) : null}
                {canCreateGroupChat ? (
                  <button
                    type="button"
                    className={newRoomMode === 'group' ? 'is-active' : undefined}
                    onClick={() => setNewRoomMode('group')}
                  >
                    Групповой чат
                  </button>
                ) : null}
              </div>

              {newRoomMode === 'direct' ? (
                <div className="chat-form-field">
                  <span>Собеседник</span>
                  <ParticipantPicker
                    candidates={directParticipants}
                    selectedIds={
                      directTargetUserId ? [directTargetUserId] : []
                    }
                    onChange={(selectedIds) =>
                      setDirectTargetUserId(selectedIds.at(-1) ?? '')
                    }
                    placeholder="Найти пользователя по ФИО"
                  />
                </div>
              ) : (
                <>
                  <label>
                    <span>Название</span>
                    <input
                      value={newRoomTitle}
                      onChange={(event) => setNewRoomTitle(event.target.value)}
                      placeholder="Например: Бригада вечер"
                      autoFocus
                    />
                  </label>

                  <div className="chat-form-field">
                    <span>Участники</span>
                    <ParticipantPicker
                      candidates={directParticipants}
                      selectedIds={newRoomParticipantIds}
                      onChange={setNewRoomParticipantIds}
                      placeholder="Найти участника по ФИО"
                    />
                  </div>
                </>
              )}

              <div className="action-row">
                <button type="submit" disabled={isCreateRoomDisabled}>
                  {newRoomMode === 'direct'
                    ? 'Открыть личный чат'
                    : 'Создать группу'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDirectTargetUserId('');
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
                    {getRoomDisplayTitle(activeRoom)} · {activeRoomTypeLabel}
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
              activeRoom.roomType === 'group' ? (
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

        {forwardingMessage ? (
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setForwardingMessage(null);
                setForwardTargetRoomId('');
              }
            }}
          >
            <form className="chat-modal" onSubmit={handleForwardMessage}>
              <div className="section-header">
                <div>
                  <div className="section-title">Переслать сообщение</div>
                  <div className="section-subtitle">
                    Вложения в этом этапе не копируются.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setForwardingMessage(null);
                    setForwardTargetRoomId('');
                  }}
                >
                  Закрыть
                </button>
              </div>

              <label>
                <span>Чат назначения</span>
                <select
                  value={forwardTargetRoomId}
                  onChange={(event) => setForwardTargetRoomId(event.target.value)}
                >
                  {forwardTargetRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {getRoomDisplayTitle(room)}
                    </option>
                  ))}
                </select>
              </label>

              {forwardTargetRooms.length === 0 ? (
                <div className="page-muted">
                  Нет другой комнаты, куда можно отправить сообщение.
                </div>
              ) : null}

              <div className="action-row">
                <button type="submit" disabled={!forwardTargetRoomId}>
                  Переслать
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForwardingMessage(null);
                    setForwardTargetRoomId('');
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </>
  );
}
