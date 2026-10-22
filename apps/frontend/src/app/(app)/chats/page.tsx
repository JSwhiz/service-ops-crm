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
  getChatMessageWithRetry,
  hideChatRoom,
  leaveChatRoom,
  listChatRoomParticipants,
  listChatMessages,
  listChatMessagesAround,
  listUnreadChatMessages,
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
import { ChatIcon } from './chat-icon';
import { ChatExplorer } from './chat-explorer';
import { Dialog, useConfirm, useReasonPrompt } from '@/shared/ui/overlays';
import { UserAvatar } from '@/shared/ui/user-avatar/user-avatar';
import { ChatMessageMenu } from './chat-message-menu';
import styles from './chat-ui.module.css';
import { Alert, Button, Surface } from '@/shared/ui/foundation';

type RealtimePayload = {
  type?: string;
  roomId?: string;
  payload?: unknown;
};

function getRealtimeMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('messageId' in payload)) {
    return null;
  }

  const messageId = (payload as { messageId?: unknown }).messageId;

  return typeof messageId === 'string' && messageId ? messageId : null;
}

type InitialScrollTarget = {
  messageId: string;
  target: 'message' | 'bottom';
  unreadMessageId: string | null;
};

type LoadMessagesOptions = {
  scheduleInitial?: boolean;
  roomSnapshot?: ChatRoom | null;
};

type LoadedMessagesResult = {
  messages: ChatMessage[];
  isLatestWindow: boolean;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
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
  if (room.roomType === 'direct') {
    return 'Личный чат';
  }

  if (room.roomType === 'group') {
    return 'Группа';
  }

  return '';
}

function highlightSearch(value: string, query: string): React.ReactNode {
  const needle = query.trim().toLocaleLowerCase('ru');
  if (!needle) return value;
  const lower = value.toLocaleLowerCase('ru');
  const parts: React.ReactNode[] = [];
  let start = 0;
  let match = lower.indexOf(needle);
  while (match >= 0) {
    parts.push(value.slice(start, match));
    parts.push(
      <mark key={match}>{value.slice(match, match + needle.length)}</mark>,
    );
    start = match + needle.length;
    match = lower.indexOf(needle, start);
  }
  parts.push(value.slice(start));
  return parts;
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
        Number.isFinite(createdAt) && createdAt > lastReadAt && !isOwnMessage
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
    .filter((candidate) => candidate.isActive)
    .filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${candidate.fullName} ${candidate.login}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedQuery);
    })
    .slice(0, 50);
  const candidateNameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const name = getUserDisplayName(candidate);
    candidateNameCounts.set(name, (candidateNameCounts.get(name) ?? 0) + 1);
  }

  const removeUser = (userId: string): void => {
    onChange(selectedIds.filter((selectedId) => selectedId !== userId));
  };

  const addUser = (userId: string): void => {
    onChange(Array.from(new Set([...selectedIds, userId])));
    setQuery('');
  };

  return (
    <div className={styles.participantPicker}>
      <div className={styles.participantPickerChips}>
        {selectedUsers.length === 0
          ? null
          : selectedUsers.map((participant) => (
              <span key={participant.id} className={styles.identityChip}>
                <span>
                  <strong>{getUserDisplayName(participant)}</strong>
                  {getUserSecondaryLabel(participant) ? (
                    <small>{getUserSecondaryLabel(participant)}</small>
                  ) : null}
                </span>
                <Button
                  aria-label={`Убрать ${getUserDisplayName(participant)}`}
                  onClick={() => removeUser(participant.id)}
                >
                  <ChatIcon name="close" />
                </Button>
              </span>
            ))}
      </div>

      <div className={styles.searchField}>
        <ChatIcon name="search" />
        <input
          aria-label={placeholder}
          data-dialog-initial-focus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
        />
      </div>

      {filteredCandidates.length > 0 ? (
        <div className={styles.participantPickerOptions}>
          {filteredCandidates.map((candidate) => (
            <Button
              key={candidate.id}
              aria-pressed={selectedIdSet.has(candidate.id)}
              onClick={() =>
                selectedIdSet.has(candidate.id)
                  ? removeUser(candidate.id)
                  : addUser(candidate.id)
              }
            >
              <UserAvatar fullName={getUserDisplayName(candidate)} />
              <span>
                <strong>{getUserDisplayName(candidate)}</strong>
                {getUserSecondaryLabel(candidate) ||
                (candidateNameCounts.get(getUserDisplayName(candidate)) ?? 0) >
                  1 ? (
                  <small>
                    {getUserSecondaryLabel(candidate) ?? `@${candidate.login}`}
                  </small>
                ) : null}
              </span>
              <span className={styles.selectionCheck} aria-hidden="true">
                {selectedIdSet.has(candidate.id) ? '✓' : ''}
              </span>
            </Button>
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
  const [confirm, confirmDialog] = useConfirm();
  const [askReason, reasonDialog] = useReasonPrompt();
  const canManageChats = user?.capabilities?.canManageChats ?? false;
  const canCreateDirectChat = user?.capabilities?.canCreateDirectChat ?? false;
  const canCreateGroupChat = user?.capabilities?.canCreateGroupChat ?? false;
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [archivedRooms, setArchivedRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<
    string | null
  >(null);
  const [openReactionUsersId, setOpenReactionUsersId] = useState<string | null>(
    null,
  );
  const [isRoomMenuOpen, setIsRoomMenuOpen] = useState(false);
  const [explorer, setExplorer] = useState<'search' | 'media' | 'files' | null>(
    null,
  );
  const [groupDetailsStep, setGroupDetailsStep] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [forwardQuery, setForwardQuery] = useState('');
  const [participantsQuery, setParticipantsQuery] = useState('');
  const [participants, setParticipants] = useState<SystemUserOption[]>([]);
  const [newRoomMode, setNewRoomMode] = useState<'direct' | 'group'>('direct');
  const [directTargetUserId, setDirectTargetUserId] = useState('');
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomParticipantIds, setNewRoomParticipantIds] = useState<string[]>(
    [],
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [addParticipantIds, setAddParticipantIds] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] =
    useState<ChatMessage | null>(null);
  const [forwardTargetRoomId, setForwardTargetRoomId] = useState('');
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingArchivedRooms, setIsLoadingArchivedRooms] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
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
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !activeRoomId ||
        document.querySelector('dialog[open]')
      )
        return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setExplorer('search');
        document
          .querySelector<HTMLInputElement>(
            '[aria-label="Поиск сообщений в этом чате"]',
          )
          ?.focus();
      } else if (
        event.shiftKey &&
        event.key.toLowerCase() === 'u' &&
        rooms.find((room) => room.id === activeRoomId)?.capabilities.canWrite
      ) {
        event.preventDefault();
        attachmentInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [activeRoomId, rooms]);
  const pendingScrollToBottomRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string | null>(null);
  const initialScrollRunIdRef = useRef<string | null>(null);
  const scheduledInitialScrollRunIdRef = useRef<string | null>(null);
  const initialScrollTimeoutsRef = useRef<number[]>([]);
  const openingRoomSnapshotRef = useRef<ChatRoom | null>(null);
  const isInitialScrollPendingRef = useRef(false);
  const isLoadingOlderMessagesRef = useRef(false);
  const isLatestWindowRef = useRef(true);
  const pendingSearchMessageRef = useRef<{
    roomId: string;
    messageId: string;
  } | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const realtimeMessageRequestsRef = useRef(
    new Map<string, Promise<ChatMessage>>(),
  );
  const realtimeRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const messageLongPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = '42px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [text]);

  const clearMessageLongPressTimer = (): void => {
    if (messageLongPressTimerRef.current !== null) {
      window.clearTimeout(messageLongPressTimerRef.current);
      messageLongPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    const closeMenus = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMessageActionsId(null);
        setOpenReactionUsersId(null);
        setIsRoomMenuOpen(false);
      }
    };
    const closeMenusOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest(
          '.chat-message-menu, .chat-message__more, .chat-reaction-chip, .chat-room-menu, .chat-room-menu__trigger',
        )
      ) {
        setOpenMessageActionsId(null);
        setOpenReactionUsersId(null);
        setIsRoomMenuOpen(false);
      }
    };

    window.addEventListener('keydown', closeMenus);
    window.addEventListener('pointerdown', closeMenusOutside);
    return () => {
      window.removeEventListener('keydown', closeMenus);
      window.removeEventListener('pointerdown', closeMenusOutside);
      clearMessageLongPressTimer();
    };
  }, []);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const latestMessageId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto'): void => {
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
    },
    [forceScrollMessagesToBottom],
  );

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

  const scheduleInitialScroll = useCallback(
    (target: InitialScrollTarget, runId: string): void => {
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
    },
    [clearInitialScrollTimers, forceScrollMessagesToBottom, scrollToMessage],
  );

  const loadRooms = async (): Promise<ChatRoom[]> => {
    const nextRooms = await listChatRooms({ view: 'active' });
    setRooms(nextRooms);

    if (!activeRoomId && requestedRoomCode) {
      const requestedRoom = nextRooms.find(
        (room) => room.code === requestedRoomCode,
      );

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
  ): Promise<LoadedMessagesResult> => {
    setIsLoadingMessages(true);

    try {
      const roomSnapshot =
        options.roomSnapshot ?? openingRoomSnapshotRef.current;
      const unreadWindow =
        options.scheduleInitial && (roomSnapshot?.unreadCount ?? 0) > 0
          ? await listUnreadChatMessages(roomId)
          : null;
      const nextMessages = unreadWindow
        ? unreadWindow.messages
        : await listChatMessages(roomId, { limit: 50 });
      setMessages(nextMessages);
      setHasOlderMessages(unreadWindow?.hasOlder ?? nextMessages.length === 50);
      setHasNewerMessages(unreadWindow?.hasNewer ?? false);
      isLatestWindowRef.current = unreadWindow?.isLatestWindow ?? true;

      if (options?.scheduleInitial) {
        const target = unreadWindow?.unreadMessageId
          ? {
              messageId: unreadWindow.unreadMessageId,
              target: 'message' as const,
              unreadMessageId: unreadWindow.unreadMessageId,
            }
          : getInitialScrollTarget(roomSnapshot, nextMessages, user?.id);

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

      return {
        messages: nextMessages,
        isLatestWindow: isLatestWindowRef.current,
      };
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const loadSearchMessageWindow = async (
    roomId: string,
    messageId: string,
  ): Promise<void> => {
    setIsLoadingMessages(true);

    try {
      const windowResult = await listChatMessagesAround(roomId, messageId);

      if (activeRoomIdRef.current !== roomId) {
        return;
      }

      setMessages(windowResult.messages);
      setHasOlderMessages(windowResult.hasOlder);
      setHasNewerMessages(windowResult.hasNewer);
      isLatestWindowRef.current = windowResult.isLatestWindow;
      setInitialUnreadMessageId(null);
      const anchorMessageId = windowResult.anchorMessageId ?? messageId;
      scheduleInitialScroll(
        {
          messageId: anchorMessageId,
          target: 'message',
          unreadMessageId: null,
        },
        `${roomId}:search:${anchorMessageId}:${windowResult.messages.length}`,
      );
      setHighlightedMessageId(anchorMessageId);

      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }

      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedMessageId(null);
        highlightTimeoutRef.current = null;
      }, 3000);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const loadLatestMessages = async (): Promise<void> => {
    const roomId = activeRoomIdRef.current;

    if (!roomId) {
      return;
    }

    setIsLoadingMessages(true);
    setError(null);

    try {
      const latestMessages = await listChatMessages(roomId, { limit: 50 });
      setMessages(latestMessages);
      setHasOlderMessages(latestMessages.length === 50);
      setHasNewerMessages(false);
      isLatestWindowRef.current = true;
      setHighlightedMessageId(null);
      setInitialUnreadMessageId(null);
      pendingScrollToBottomRef.current = true;
    } catch (loadError) {
      setError(
        getErrorMessage(loadError, 'Не удалось загрузить последние сообщения.'),
      );
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const refreshActiveMessageWindow = (): Promise<void> => {
    if (realtimeRefreshPromiseRef.current) {
      return realtimeRefreshPromiseRef.current;
    }

    const roomId = activeRoomIdRef.current;

    if (!roomId) {
      return Promise.resolve();
    }

    const refreshPromise = (async (): Promise<void> => {
      const currentMessages = messagesRef.current;

      if (isLatestWindowRef.current) {
        const nextMessages = await listChatMessages(roomId, { limit: 50 });

        if (activeRoomIdRef.current !== roomId) {
          return;
        }

        setMessages(nextMessages);
        setHasOlderMessages(nextMessages.length === 50);
        setHasNewerMessages(false);
        return;
      }

      const anchorMessage =
        currentMessages[Math.floor(currentMessages.length / 2)];

      if (!anchorMessage) {
        return;
      }

      const nextWindow = await listChatMessagesAround(roomId, anchorMessage.id);

      if (activeRoomIdRef.current !== roomId) {
        return;
      }

      setMessages(nextWindow.messages);
      setHasOlderMessages(nextWindow.hasOlder);
      setHasNewerMessages(nextWindow.hasNewer);
      isLatestWindowRef.current = nextWindow.isLatestWindow;
    })().finally(() => {
      realtimeRefreshPromiseRef.current = null;
    });

    realtimeRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  };

  const loadRealtimeMessage = (messageId: string): Promise<ChatMessage> => {
    const existingRequest = realtimeMessageRequestsRef.current.get(messageId);

    if (existingRequest) {
      return existingRequest;
    }

    const request = getChatMessageWithRetry(messageId).finally(() => {
      realtimeMessageRequestsRef.current.delete(messageId);
    });
    realtimeMessageRequestsRef.current.set(messageId, request);
    return request;
  };

  const loadOlderMessages = async (): Promise<void> => {
    const roomId = activeRoomIdRef.current;
    const firstMessageId = messages.at(0)?.id;
    const container = messageListRef.current;

    if (
      !roomId ||
      !firstMessageId ||
      !container ||
      isLoadingMessages ||
      isLoadingOlderMessagesRef.current ||
      !hasOlderMessages
    ) {
      return;
    }

    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    isLoadingOlderMessagesRef.current = true;
    setIsLoadingOlderMessages(true);

    try {
      const olderMessages = await listChatMessages(roomId, {
        before: firstMessageId,
        limit: 50,
      });

      if (activeRoomIdRef.current !== roomId) {
        return;
      }

      setHasOlderMessages(olderMessages.length === 50);
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [
          ...olderMessages.filter((message) => !currentIds.has(message.id)),
          ...current,
        ];
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const currentContainer = messageListRef.current;

          if (currentContainer && activeRoomIdRef.current === roomId) {
            currentContainer.scrollTop =
              previousScrollTop +
              (currentContainer.scrollHeight - previousScrollHeight);
          }
        });
      });
    } catch (loadError) {
      setError(
        getErrorMessage(
          loadError,
          'Не удалось загрузить предыдущие сообщения.',
        ),
      );
    } finally {
      isLoadingOlderMessagesRef.current = false;
      setIsLoadingOlderMessages(false);
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
    setHasOlderMessages(false);
    isLoadingOlderMessagesRef.current = false;
    setIsLoadingOlderMessages(false);
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

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    },
    [],
  );

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
    setHasNewerMessages(false);
    isLatestWindowRef.current = false;
    setIsRoomSettingsOpen(false);
    setIsParticipantsPanelOpen(false);
    setRoomParticipants([]);
    const roomSnapshot =
      openingRoomSnapshotRef.current?.id === activeRoomId
        ? openingRoomSnapshotRef.current
        : (rooms.find((room) => room.id === activeRoomId) ?? null);

    openingRoomSnapshotRef.current = roomSnapshot;

    const pendingSearchMessage = pendingSearchMessageRef.current;

    if (pendingSearchMessage?.roomId === activeRoomId) {
      pendingSearchMessageRef.current = null;
      void loadSearchMessageWindow(
        activeRoomId,
        pendingSearchMessage.messageId,
      ).catch((loadError) => {
        setError(
          getErrorMessage(loadError, 'Не удалось открыть найденное сообщение.'),
        );
        setMessages([]);
        isInitialScrollPendingRef.current = false;
      });
      return;
    }

    void loadMessages(activeRoomId, {
      scheduleInitial: true,
      roomSnapshot,
    })
      .then((result) => {
        const latestLoadedMessageId = result.messages.at(-1)?.id;

        if (result.isLatestWindow && latestLoadedMessageId) {
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
            setError(
              getErrorMessage(searchError, 'Не удалось выполнить поиск.'),
            );
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

        if (isInitialScrollPendingRef.current || !isLatestWindowRef.current) {
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

          const messageId = getRealtimeMessageId(payload.payload);

          if ((isMessageCreated || isMessageUpdated) && messageId) {
            void loadRealtimeMessage(messageId)
              .then((incomingMessage) => {
                if (payload.roomId !== activeRoomIdRef.current) {
                  return;
                }

                if (isMessageCreated && !isLatestWindowRef.current) {
                  setHasNewerMessages(true);
                  setHasNewMessagesBelow(true);
                  return;
                }

                if (isMessageCreated) {
                  const shouldStickToBottom = messageListRef.current
                    ? isAtBottom(messageListRef.current)
                    : true;

                  pendingScrollToBottomRef.current = shouldStickToBottom;
                  setHasNewMessagesBelow(!shouldStickToBottom);
                }

                setMessages((current) => {
                  const exists = current.some(
                    (message) => message.id === incomingMessage.id,
                  );

                  if (isMessageUpdated) {
                    return current.map((message) =>
                      message.id === incomingMessage.id
                        ? incomingMessage
                        : message,
                    );
                  }

                  return exists ? current : [...current, incomingMessage];
                });
              })
              .catch(() => {
                void refreshActiveMessageWindow().catch(() => undefined);
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

  const handleSend = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
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
      setError(
        getErrorMessage(unhideError, 'Не удалось вернуть чат из архива.'),
      );
    }
  };

  const handleUnhideRoom = async (roomId: string): Promise<void> => {
    setError(null);

    try {
      await unhideChatRoom(roomId);
      await refreshRoomLists();
    } catch (unhideError) {
      setError(
        getErrorMessage(unhideError, 'Не удалось вернуть чат из архива.'),
      );
    }
  };

  const handleLeaveRoom = async (): Promise<void> => {
    if (!activeRoom) {
      return;
    }

    if (!(await confirm({
      title: 'Покинуть групповой чат?',
      consequence: 'Чат пропадёт из списка. Вернуться можно по приглашению администратора.',
      confirmLabel: 'Покинуть',
      tone: 'danger',
    }))) {
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

    const reason = await askReason({
      title: 'Закрыть чат для всех?',
      description: 'Участники больше не смогут писать в этот чат.',
      reasonLabel: 'Причина закрытия',
      confirmLabel: 'Закрыть чат',
    });

    if (reason === null) {
      return;
    }

    setError(null);

    try {
      await closeChatRoom(activeRoom.id, {
        reason: reason.trim() || undefined,
      });
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
          currentMessage.id === updatedMessage.id
            ? updatedMessage
            : currentMessage,
        ),
      );
      void refreshRoomLists().catch(() => undefined);
    } catch (editError) {
      setError(getErrorMessage(editError, 'Не удалось изменить сообщение.'));
    }
  };

  const handleDeleteMessage = async (message: ChatMessage): Promise<void> => {
    const isOwnMessage = message.author?.id === user?.id;
    const confirmation = isOwnMessage
      ? 'Удалить сообщение для всех участников чата?'
      : 'Удалить чужое сообщение для всех участников как администратор?';

    if (!(await confirm({
      title: 'Удалить сообщение?',
      consequence: confirmation,
      confirmLabel: 'Удалить',
      tone: 'danger',
    }))) {
      return;
    }

    setError(null);

    try {
      const updatedMessage = await deleteChatMessage(message.id);
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === updatedMessage.id
            ? updatedMessage
            : currentMessage,
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
      const forwardedMessage = await forwardChatMessage(forwardingMessage.id, {
        targetRoomId: forwardTargetRoomId,
      });
      if (forwardTargetRoomId === activeRoomIdRef.current) {
        setMessages((current) =>
          current.some((message) => message.id === forwardedMessage.id)
            ? current
            : [...current, forwardedMessage],
        );
        pendingScrollToBottomRef.current = true;
      }
      setForwardingMessage(null);
      setForwardTargetRoomId('');
      await refreshRoomLists();
    } catch (forwardError) {
      setError(
        getErrorMessage(forwardError, 'Не удалось переслать сообщение.'),
      );
    }
  };

  const handleToggleHeart = async (message: ChatMessage): Promise<void> => {
    setError(null);

    try {
      const updatedMessage = await toggleChatMessageHeart(message.id);
      setMessages((current) =>
        current.map((currentMessage) =>
          currentMessage.id === updatedMessage.id
            ? updatedMessage
            : currentMessage,
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
  const layoutClassName = `${styles.chatLayout}${
    isRoomListOpen ? ` ${styles.chatLayoutRoomListOpen}` : ''
  }`;
  const selectRoom = (roomId: string): void => {
    setExplorer(null);
    pendingSearchMessageRef.current = null;
    setHighlightedMessageId(null);
    openingRoomSnapshotRef.current =
      rooms.find((room) => room.id === roomId) ?? null;
    initialScrollRunIdRef.current = null;
    setActiveRoomId(roomId);
    setIsRoomListOpen(false);
  };

  const openSearchMessage = (roomId: string, messageId: string): void => {
    setSearchQuery('');
    setIsRoomListOpen(false);

    if (activeRoomIdRef.current === roomId) {
      void loadSearchMessageWindow(roomId, messageId).catch((loadError) => {
        setError(
          getErrorMessage(loadError, 'Не удалось открыть найденное сообщение.'),
        );
      });
      return;
    }

    pendingSearchMessageRef.current = { roomId, messageId };
    openingRoomSnapshotRef.current =
      rooms.find((room) => room.id === roomId) ?? null;
    initialScrollRunIdRef.current = null;
    setActiveRoomId(roomId);
  };

  const openParticipantsPanel = (): void => {
    if (!activeRoom) {
      return;
    }

    setParticipantsQuery('');
    setIsParticipantsPanelOpen(true);
    void loadRoomParticipants(activeRoom.id);
  };

  const removePendingFile = (indexToRemove: number): void => {
    setFiles((current) =>
      current.filter((_file, index) => index !== indexToRemove),
    );
  };

  const addPendingFiles = (incoming: File[]): void => {
    if (!activeRoom?.capabilities.canWrite || isSending) return;
    setFiles((current) => {
      const seen = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      return [
        ...current,
        ...incoming.filter((file) => {
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    });
  };

  const handleTextKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    composerFormRef.current?.requestSubmit();
  };

  return (
    <>
      {confirmDialog}
      {reasonDialog}
      <h1 className={styles.chatPageTitle}>Чаты</h1>

      <div className={`ui-stack ui-stack--lg chat-page-stack ${styles.workspace}`}>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}

        <div className={layoutClassName}>
          <Surface as="aside" padding="md" className="chat-room-panel">
            <div className="ui-section-header">
              <div>
                <div className="ui-section-title">Чаты</div>
              </div>
              {canCreateDirectChat || canCreateGroupChat ? (
                <button
                  type="button"
                  className={styles.chatIconButton}
                  aria-label="Новый чат"
                  title="Новый чат"
                  onClick={() => {
                    setNewRoomMode(canCreateDirectChat ? 'direct' : 'group');
                    setGroupDetailsStep(false);
                    setIsCreateRoomOpen(true);
                  }}
                >
                  <ChatIcon name="compose" />
                </button>
              ) : null}
            </div>

            <div className={styles.chatSearchBox}>
              <div className={styles.searchField}>
                <ChatIcon name="search" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск в чатах и сообщениях"
                  aria-label="Поиск в чатах и сообщениях"
                  aria-busy={isSearching}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setSearchQuery('');
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      event.currentTarget
                        .closest('.chat-room-panel')
                        ?.querySelector<HTMLButtonElement>(
                          `.${styles.chatSearchResults} button`,
                        )
                        ?.focus();
                    }
                  }}
                />
                {searchQuery ? (
                  <Button
                    aria-label="Очистить поиск в чатах"
                    onClick={() => setSearchQuery('')}
                  >
                    <ChatIcon name="close" />
                  </Button>
                ) : null}
              </div>
            </div>
            {searchQuery.trim().length >= 2 ? (
              <div
                className={styles.chatSearchResults}
                aria-label="Результаты поиска в чатах"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchQuery('');
                    return;
                  }
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
                    return;
                  event.preventDefault();
                  const items = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button',
                    ),
                  );
                  const index = items.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  items[
                    (index +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      items.length) %
                      items.length
                  ]?.focus();
                }}
              >
                {isSearching ? (
                  <div className="ui-text-muted">Поиск...</div>
                ) : searchResults.rooms.length === 0 &&
                  searchResults.messages.length === 0 ? (
                  <div className="ui-text-muted">Ничего не найдено.</div>
                ) : (
                  <>
                    {searchResults.rooms.length > 0 ? (
                      <div className={styles.chatSearchGroup}>
                        <strong>
                          Чаты <span>{searchResults.rooms.length}</span>
                        </strong>
                        {searchResults.rooms.map((room) => (
                          <Button
                            key={room.id}
                            onClick={() => {
                              selectRoom(room.id);
                              setSearchQuery('');
                            }}
                          >
                            <span>
                              {highlightSearch(
                                room.displayTitle || room.title,
                                searchQuery,
                              )}
                            </span>
                            <small>
                              {room.lastMessagePreview ?? 'Без сообщений'}
                            </small>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    {searchResults.messages.length > 0 ? (
                      <div className={styles.chatSearchGroup}>
                        <strong>
                          Сообщения <span>{searchResults.messages.length}</span>
                        </strong>
                        {searchResults.messages.map((message) => (
                          <Button
                            key={message.id}
                            onClick={() =>
                              openSearchMessage(message.roomId, message.id)
                            }
                          >
                            <span>
                              {message.room.displayTitle || message.room.title}
                            </span>
                            <small>
                              {message.author
                                ? getUserDisplayName(message.author)
                                : 'Система'}{' '}
                              · {formatDateTime(message.createdAt)}
                            </small>
                            <small>
                              {highlightSearch(message.text ?? '', searchQuery)}
                            </small>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <div
              className={styles.chatRoomList}
              hidden={searchQuery.trim().length >= 2}
            >
              {isLoadingRooms ? (
                <div className="ui-text-muted">Загрузка чатов...</div>
              ) : rooms.length === 0 ? (
                <div className="ui-text-muted">Доступных чатов пока нет.</div>
              ) : (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    className={`${styles.chatRoomItem}${
                      room.id === activeRoomId ? ` ${styles.chatRoomItemActive}` : ''
                    }`}
                    type="button"
                    onClick={() => selectRoom(room.id)}
                  >
                    <UserAvatar fullName={getRoomDisplayTitle(room)} size="medium" decorative />
                    <span className={styles.chatRoomItemMain}>
                      <strong>{getRoomDisplayTitle(room)}</strong>
                      <span>
                        {room.lastMessagePreview ?? 'Сообщений пока нет'}
                      </span>
                    </span>
                    <span className={styles.chatRoomItemMeta}>
                      <span>{formatDateTime(room.lastMessageAt)}</span>
                      {room.unreadCount > 0 ? (
                        <span className={styles.chatUnread}>{room.unreadCount}</span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className={styles.chatArchiveBlock}>
              <button
                type="button"
                className={styles.chatArchiveToggle}
                onClick={() => setIsArchiveOpen((current) => !current)}
              >
                <ChatIcon name="archive" />
                <span>Архив</span>
                <span>{archivedRooms.length}</span>
              </button>

              {isArchiveOpen ? (
                <div className={`${styles.chatRoomList} ${styles.chatRoomListArchive}`}>
                  {isLoadingArchivedRooms ? (
                    <div className="ui-text-muted">Загрузка архива...</div>
                  ) : archivedRooms.length === 0 ? (
                    <div className="ui-text-muted">В архиве пока пусто.</div>
                  ) : (
                    archivedRooms.map((room) => (
                      <div
                        key={room.id}
                        className={`${styles.chatRoomItem} ${styles.chatRoomItemArchived}`}
                      >
                        <button
                          type="button"
                          className={styles.chatRoomItemOpen}
                          onClick={() => void handleOpenArchivedRoom(room.id)}
                        >
                          <span className={styles.chatRoomItemMain}>
                            <strong>{getRoomDisplayTitle(room)}</strong>
                            <span>
                              {room.lastMessagePreview ?? 'Сообщений пока нет'}
                            </span>
                          </span>
                          <span className={styles.chatRoomItemMeta}>
                            <span>{formatDateTime(room.lastMessageAt)}</span>
                          </span>
                        </button>
                        <Button variant="ghost" size="sm"

                          onClick={() => void handleUnhideRoom(room.id)}
                        >
                          Вернуть
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </Surface>

          <Surface as="section" padding="md"
            className={styles.chatMain}
            onDragEnter={(event) => {
              if (
                !event.dataTransfer.types.includes('Files') ||
                !activeRoom?.capabilities.canWrite ||
                isSending
              )
                return;
              event.preventDefault();
              fileDragDepthRef.current++;
              setIsDraggingFiles(true);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect =
                  activeRoom?.capabilities.canWrite && !isSending
                    ? 'copy'
                    : 'none';
              }
            }}
            onDragLeave={() => {
              fileDragDepthRef.current = Math.max(
                0,
                fileDragDepthRef.current - 1,
              );
              if (!fileDragDepthRef.current) setIsDraggingFiles(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              fileDragDepthRef.current = 0;
              setIsDraggingFiles(false);
              addPendingFiles(Array.from(event.dataTransfer.files));
            }}
          >
            {activeRoom && explorer ? (
              <ChatExplorer
                key={activeRoom.id}
                roomId={activeRoom.id}
                roomTitle={getRoomDisplayTitle(activeRoom)}
                initialTab={explorer}
                onClose={() => setExplorer(null)}
                onMessage={(messageId) => {
                  setExplorer(null);
                  openSearchMessage(activeRoom.id, messageId);
                }}
              />
            ) : null}
            {isDraggingFiles ? (
              <div className={styles.dropZone}>
                <ChatIcon name="attach" />
                <strong>Добавить в сообщение</strong>
                <span>Отпустите файлы здесь</span>
              </div>
            ) : null}
            {activeRoom ? (
              <>
                <header className={styles.chatHeader}>
                  <div className={styles.chatHeaderMain}>
                    <button
                      type="button"
                      className={styles.chatBackButton}
                      aria-label="К списку чатов"
                      onClick={() => setIsRoomListOpen(true)}
                    >
                      <ChatIcon name="back" />
                    </button>
                    <button
                      type="button"
                      className={styles.roomIdentity}
                      aria-label={`Участники: ${activeRoom.participantCount}`}
                      onClick={openParticipantsPanel}
                    >
                      <span className="ui-section-title">
                        {getRoomDisplayTitle(activeRoom)}
                      </span>
                      <span className="ui-section-subtitle">
                        {activeRoomTypeLabel ? (
                          <span className={styles.chatRoomTypeBadge}>
                            {activeRoomTypeLabel}
                          </span>
                        ) : null}
                        <span>Участники: {activeRoom.participantCount}</span>
                      </span>
                    </button>
                  </div>
                  <div className={styles.chatHeaderActions}>
                    <button
                      type="button"
                      className={styles.chatIconButton}
                      aria-label="Поиск в этом чате"
                      title="Поиск в этом чате (⌘/Ctrl+F)"
                      onClick={() => setExplorer('search')}
                    >
                      <ChatIcon name="search" />
                    </button>
                    <button
                      type="button"
                      className={styles.chatIconButton}
                      aria-label="Вложения чата"
                      title="Вложения чата"
                      onClick={() => setExplorer('media')}
                    >
                      <ChatIcon name="gallery" />
                    </button>
                    {activeRoom.capabilities.canHide ||
                    activeRoom.capabilities.canLeave ||
                    activeRoom.capabilities.canCloseGlobally ||
                    activeRoom.capabilities.canManage ? (
                      <div className={styles.chatRoomMenuWrap}>
                        <button
                          type="button"
                          className="chat-room-menu__trigger"
                          aria-label="Действия с чатом"
                          aria-haspopup="menu"
                          aria-expanded={isRoomMenuOpen}
                          onClick={() => setIsRoomMenuOpen((open) => !open)}
                        >
                          <ChatIcon name="more" />
                        </button>
                        {isRoomMenuOpen ? (
                          <div
                            className="chat-room-menu"
                            role="menu"
                            aria-label="Действия с чатом"
                          >
                            <Button
                              role="menuitem"
                              onClick={() => {
                                setIsRoomMenuOpen(false);
                                openParticipantsPanel();
                              }}
                            >
                              <ChatIcon name="file" />
                              Информация о чате
                            </Button>
                            {activeRoom.capabilities.canManage ? (
                              <Button
                                role="menuitem"
                                onClick={() => {
                                  setIsRoomSettingsOpen((current) => !current);
                                  setIsRoomMenuOpen(false);
                                }}
                              >
                                <ChatIcon name="edit" />
                                Редактировать
                              </Button>
                            ) : null}
                            {activeRoom.capabilities.canHide ? (
                              <Button
                                role="menuitem"
                                onClick={() => {
                                  setIsRoomMenuOpen(false);
                                  void handleHideRoom();
                                }}
                              >
                                <ChatIcon name="archive" />
                                Скрыть чат
                              </Button>
                            ) : null}
                            {activeRoom.capabilities.canLeave ? (
                              <Button
                                role="menuitem"
                                onClick={() => {
                                  setIsRoomMenuOpen(false);
                                  void handleLeaveRoom();
                                }}
                              >
                                <ChatIcon name="back" />
                                Покинуть чат
                              </Button>
                            ) : null}
                            {activeRoom.capabilities.canCloseGlobally ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="is-danger"
                                onClick={() => {
                                  setIsRoomMenuOpen(false);
                                  void handleCloseRoom();
                                }}
                              >
                                <ChatIcon name="close" />
                                Закрыть для всех
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </header>

                <div className={styles.chatMessageStage}>
                  <div
                    ref={messageListRef}
                    className={styles.chatMessageList}
                    onScroll={(event) => {
                      const container = event.currentTarget;

                      if (container.scrollTop < 80) {
                        void loadOlderMessages();
                      }

                      if (isAtBottom(container)) {
                        setHasNewMessagesBelow(false);
                      }
                    }}
                  >
                    {isLoadingOlderMessages ? (
                      <div className={styles.chatHistoryLoader}>
                        Загрузка предыдущих сообщений...
                      </div>
                    ) : null}
                    {isLoadingMessages ? (
                      <div className="ui-text-muted">Загрузка сообщений...</div>
                    ) : messages.length === 0 ? (
                      <div className={styles.chatEmpty}>
                        Пока нет сообщений. Напишите текст или прикрепите файл.
                      </div>
                    ) : (
                      messages.map((message) => {
                        const isOwn = message.author?.id === user?.id;
                        const isEditing = editingMessageId === message.id;

                        return (
                          <React.Fragment key={message.id}>
                            {initialUnreadMessageId === message.id ? (
                              <div className={styles.chatUnreadDivider}>
                                <span>Новые сообщения</span>
                              </div>
                            ) : null}
                            <article
                              data-message-id={message.id}
                              className={`chat-message ${
                                message.messageType === 'system'
                                  ? styles.chatMessageSystem
                                  : isOwn
                                    ? styles.chatMessageOwn
                                    : ''
                              }${
                                highlightedMessageId === message.id
                                  ? ` ${styles.chatMessageHighlighted}`
                                  : ''
                              }`}
                              onContextMenu={(event) => {
                                if (!message.isDeleted) {
                                  event.preventDefault();
                                  setOpenMessageActionsId(message.id);
                                  setOpenReactionUsersId(null);
                                }
                              }}
                              onTouchStart={(event) => {
                                clearMessageLongPressTimer();
                                if (
                                  (event.target as HTMLElement).closest(
                                    'button, a, input, textarea',
                                  )
                                )
                                  return;
                                if (!message.isDeleted) {
                                  messageLongPressTimerRef.current =
                                    window.setTimeout(() => {
                                      setOpenMessageActionsId(message.id);
                                      setOpenReactionUsersId(null);
                                    }, 480);
                                }
                              }}
                              onTouchEnd={clearMessageLongPressTimer}
                              onTouchMove={clearMessageLongPressTimer}
                              onTouchCancel={clearMessageLongPressTimer}
                              onKeyDown={(event) => {
                                if (
                                  event.key === 'ContextMenu' ||
                                  (event.shiftKey && event.key === 'F10')
                                ) {
                                  event.preventDefault();
                                  setOpenMessageActionsId(message.id);
                                }
                              }}
                            >
                              <div className={styles.chatMessageMeta}>
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
                                {message.editedAt ? (
                                  <span>изменено</span>
                                ) : null}
                              </div>
                              {!message.isDeleted &&
                              (message.capabilities.canEdit ||
                                message.capabilities.canDelete ||
                                message.capabilities.canReply ||
                                message.capabilities.canForward ||
                                message.capabilities.canReact) ? (
                                <button
                                  type="button"
                                  className="chat-message__more"
                                  aria-label="Действия с сообщением"
                                  aria-haspopup="menu"
                                  aria-expanded={
                                    openMessageActionsId === message.id
                                  }
                                  onClick={() => {
                                    setOpenMessageActionsId((current) =>
                                      current === message.id
                                        ? null
                                        : message.id,
                                    );
                                    setOpenReactionUsersId(null);
                                  }}
                                >
                                  <ChatIcon name="more" />
                                </button>
                              ) : null}

                              {isEditing && !message.isDeleted ? (
                                <div className={styles.chatEditBox}>
                                  <textarea
                                    value={editingText}
                                    onChange={(event) =>
                                      setEditingText(event.target.value)
                                    }
                                    rows={3}
                                  />
                                  <div className="ui-inline">
                                    <Button
                                      onClick={() => void handleEdit(message)}
                                    >
                                      Сохранить
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        setEditingMessageId(null);
                                        setEditingText('');
                                      }}
                                    >
                                      Отмена
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {message.replyTo ? (
                                    <div className={styles.chatReplyPreview}>
                                      <strong>
                                        {message.replyTo.isAccessRestricted
                                          ? 'Недоступное сообщение'
                                          : message.replyTo.author
                                            ? getUserDisplayName(
                                                message.replyTo.author,
                                              )
                                            : 'Система'}
                                      </strong>
                                      {!message.replyTo.isAccessRestricted ? (
                                        <span>
                                          {message.replyTo.text ||
                                            'Сообщение без текста'}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {message.forwardedFrom ? (
                                    <div className={styles.chatForwardedLabel}>
                                      {message.forwardedFrom.isAccessRestricted
                                        ? 'Исходное сообщение недоступно'
                                        : `Переслано · ${
                                            message.forwardedFrom.author
                                              ? getUserDisplayName(
                                                  message.forwardedFrom.author,
                                                )
                                              : 'Пользователь'
                                          }`}
                                    </div>
                                  ) : null}
                                  {message.text ? (
                                    <p className={styles.chatMessageText}>
                                      {message.text}
                                    </p>
                                  ) : null}
                                  {!message.isDeleted &&
                                  message.attachments.length > 0 ? (
                                    <AttachmentPreviewList
                                      files={message.attachments}
                                      emptyText=""
                                      compactMetadata
                                    />
                                  ) : null}
                                  {!message.isDeleted &&
                                  (message.reactionCounts.heart ?? 0) > 0 ? (
                                    <div className={styles.chatMessageFooter}>
                                      {(message.reactionCounts.heart ?? 0) >
                                      0 ? (
                                        <div className={styles.chatReactionGroup}>
                                          <button
                                            type="button"
                                            className={`chat-reaction-chip${message.myReactions.includes('heart') ? ' is-active' : ''}`}
                                            aria-expanded={
                                              openReactionUsersId === message.id
                                            }
                                            aria-label={`Сердце: ${message.reactionCounts.heart}. Показать, кто поставил реакцию`}
                                            onClick={() => {
                                              setOpenReactionUsersId(
                                                (current) =>
                                                  current === message.id
                                                    ? null
                                                    : message.id,
                                              );
                                              setOpenMessageActionsId(null);
                                            }}
                                          >
                                            <ChatIcon name="heart" />
                                            <span>
                                              {message.reactionCounts.heart}
                                            </span>
                                            <span
                                              className={styles.chatReactionAvatars}
                                              aria-hidden="true"
                                            >
                                              {(
                                                message.reactionUsers.heart ??
                                                []
                                              )
                                                .slice(0, 3)
                                                .map((reactor) => (
                                                  <span
                                                    key={reactor.id}
                                                    title={reactor.fullName}
                                                  >
                                                    {reactor.fullName
                                                      .trim()
                                                      .charAt(0) || '?'}
                                                  </span>
                                                ))}
                                            </span>
                                          </button>
                                          {openReactionUsersId ===
                                          message.id ? (
                                            <div
                                              className={styles.chatReactionPeople}
                                              role="status"
                                              aria-label="Поставили реакцию"
                                            >
                                              {(
                                                message.reactionUsers.heart ??
                                                []
                                              ).map((reactor) => (
                                                <span key={reactor.id}>
                                                  {reactor.fullName}
                                                </span>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </>
                              )}
                              {openMessageActionsId === message.id ? (
                                <ChatMessageMenu
                                  messageId={message.id}
                                  onClose={() => setOpenMessageActionsId(null)}
                                >
                                  {message.capabilities.canReply ? (
                                    <Button
                                      role="menuitem"
                                      onClick={() => {
                                        setReplyingTo(message);
                                        setOpenMessageActionsId(null);
                                        composerFormRef.current
                                          ?.querySelector('textarea')
                                          ?.focus();
                                      }}
                                    >
                                      <ChatIcon name="reply" />
                                      Ответить
                                    </Button>
                                  ) : null}
                                  {message.capabilities.canForward ? (
                                    <Button
                                      role="menuitem"
                                      onClick={() => {
                                        setForwardingMessage(message);
                                        setForwardQuery('');
                                        setForwardTargetRoomId(
                                          forwardTargetRooms.at(0)?.id ?? '',
                                        );
                                        setOpenMessageActionsId(null);
                                      }}
                                    >
                                      <ChatIcon name="forward" />
                                      Переслать
                                    </Button>
                                  ) : null}
                                  {message.capabilities.canEdit ? (
                                    <Button
                                      role="menuitem"
                                      onClick={() => {
                                        setEditingMessageId(message.id);
                                        setEditingText(message.text ?? '');
                                        setOpenMessageActionsId(null);
                                      }}
                                    >
                                      <ChatIcon name="edit" />
                                      Редактировать
                                    </Button>
                                  ) : null}
                                  {message.capabilities.canReact ? (
                                    <Button
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMessageActionsId(null);
                                        void handleToggleHeart(message);
                                      }}
                                    >
                                      <ChatIcon name="heart" />
                                      {message.myReactions.includes('heart')
                                        ? 'Убрать реакцию'
                                        : 'Поставить реакцию'}
                                    </Button>
                                  ) : null}
                                  {message.capabilities.canDelete ? (
                                    <button
                                      type="button"
                                      className="is-danger"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMessageActionsId(null);
                                        void handleDeleteMessage(message);
                                      }}
                                    >
                                      <ChatIcon name="trash" />
                                      Удалить
                                    </button>
                                  ) : null}
                                </ChatMessageMenu>
                              ) : null}
                            </article>
                          </React.Fragment>
                        );
                      })
                    )}
                    <div
                      ref={bottomSentinelRef}
                      className={styles.chatBottomSentinel}
                      aria-hidden
                    />
                  </div>
                  {hasNewMessagesBelow ? (
                    <button
                      type="button"
                      className={styles.chatNewMessagesButton}
                      onClick={() => scrollMessagesToBottom('smooth')}
                    >
                      Новые сообщения ниже
                    </button>
                  ) : null}
                  {hasNewerMessages ? (
                    <button
                      type="button"
                      className={styles.chatLatestMessagesButton}
                      onClick={() => void loadLatestMessages()}
                    >
                      К последним сообщениям
                    </button>
                  ) : null}
                </div>

                {activeRoom.capabilities.canWrite ? (
                  <form
                    ref={composerFormRef}
                    className={styles.chatComposer}
                    onSubmit={handleSend}
                  >
                    {replyingTo ? (
                      <div className={styles.chatComposerReply}>
                        <div>
                          <strong>
                            Ответ для{' '}
                            {replyingTo.author
                              ? getUserDisplayName(replyingTo.author)
                              : 'Система'}
                          </strong>
                          <span>
                            {replyingTo.text || 'Сообщение без текста'}
                          </span>
                        </div>
                        <Button variant="ghost" size="sm"

                          onClick={() => setReplyingTo(null)}
                        >
                          Отменить
                        </Button>
                      </div>
                    ) : null}
                    {files.length > 0 ? (
                      <div className={styles.chatPendingFiles}>
                        <PendingMediaList
                          files={files}
                          onRemove={removePendingFile}
                        />
                      </div>
                    ) : null}
                    <div className={styles.chatComposerInputRow}>
                      <button
                        type="button"
                        className="chat-attach-button"
                        aria-label="Прикрепить фото или файл"
                        title="Прикрепить файл (⌘/Ctrl+Shift+U)"
                        onClick={() => attachmentInputRef.current?.click()}
                      >
                        <ChatIcon name="attach" />
                      </button>
                      <input
                        ref={attachmentInputRef}
                        hidden
                        type="file"
                        multiple
                        aria-label="Прикрепить фото или файл"
                        onChange={(event) => {
                          const selectedFiles = Array.from(
                            event.currentTarget.files ?? [],
                          );
                          addPendingFiles(selectedFiles);
                          event.currentTarget.value = '';
                        }}
                      />
                      <textarea
                        ref={composerTextareaRef}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={handleTextKeyDown}
                        onPaste={(event) => {
                          const pastedFiles = Array.from(
                            event.clipboardData.items,
                          )
                            .filter((item) => item.kind === 'file')
                            .map((item) => item.getAsFile())
                            .filter((file): file is File => file !== null);
                          if (pastedFiles.length > 0) {
                            event.preventDefault();
                            addPendingFiles(pastedFiles);
                          }
                        }}
                        placeholder="Сообщение"
                        aria-label="Сообщение"
                        rows={1}
                      />
                      <Button variant="primary"
                        type="submit"
                        aria-label={
                          isSending
                            ? 'Отправка сообщения'
                            : 'Отправить сообщение'
                        }
                        title="Отправить сообщение (Enter)"
                        disabled={
                          isSending || (!text.trim() && files.length === 0)
                        }
                      >
                        <ChatIcon name="send" />
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.chatReadonlyNotice}>
                    Нет права писать в этот чат.
                  </div>
                )}
              </>
            ) : (
              <div className={styles.chatEmpty}>Выберите чат слева.</div>
            )}
          </Surface>
        </div>

        {(canCreateDirectChat || canCreateGroupChat) && isCreateRoomOpen ? (
          <Dialog
            open
            onOpenChange={(open) => setIsCreateRoomOpen(open)}
            className={styles.dialog}
            title={
              newRoomMode === 'group' && groupDetailsStep
                ? 'Новая группа'
                : 'Новый чат'
            }
            footer={
              <div className={styles.dialogActions}>
                {newRoomMode === 'group' && groupDetailsStep ? (
                  <Button
                    onClick={() => setGroupDetailsStep(false)}
                  >
                    Назад
                  </Button>
                ) : (
                  <Button
                    onClick={() => setIsCreateRoomOpen(false)}
                  >
                    Отмена
                  </Button>
                )}
                {newRoomMode === 'group' && !groupDetailsStep ? (
                  <Button variant="primary"
                    disabled={!newRoomParticipantIds.length}
                    onClick={() => setGroupDetailsStep(true)}
                  >
                    Далее
                  </Button>
                ) : (
                  <Button variant="primary"
                    type="submit"
                    form="chat-create-form"
                    disabled={isCreateRoomDisabled}
                  >
                    {newRoomMode === 'direct'
                      ? 'Открыть чат'
                      : 'Создать группу'}
                  </Button>
                )}
              </div>
            }
          >
            <form
              id="chat-create-form"
              className={styles.dialogForm}
              onSubmit={handleCreateRoom}
            >
              {!(newRoomMode === 'group' && groupDetailsStep) ? (
                <div className={styles.tabs} role="group" aria-label="Тип чата">
                  {canCreateDirectChat ? (
                    <Button
                      aria-pressed={newRoomMode === 'direct'}
                      onClick={() => setNewRoomMode('direct')}
                    >
                      Личный чат
                    </Button>
                  ) : null}
                  {canCreateGroupChat ? (
                    <Button
                      aria-pressed={newRoomMode === 'group'}
                      onClick={() => setNewRoomMode('group')}
                    >
                      Группа
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {newRoomMode === 'direct' ? (
                <ParticipantPicker
                  candidates={directParticipants}
                  selectedIds={directTargetUserId ? [directTargetUserId] : []}
                  onChange={(ids) => setDirectTargetUserId(ids.at(-1) ?? '')}
                  placeholder="Найти собеседника"
                />
              ) : groupDetailsStep ? (
                <>
                  <label className={styles.field}>
                    <span>Название группы</span>
                    <input
                      autoFocus
                      value={newRoomTitle}
                      onChange={(event) => setNewRoomTitle(event.target.value)}
                      placeholder="Введите название"
                    />
                  </label>
                  <div className={styles.listHeading}>
                    Участники · {newRoomParticipantIds.length}
                  </div>
                  <div className={styles.peopleList}>
                    {directParticipants
                      .filter((person) =>
                        newRoomParticipantIds.includes(person.id),
                      )
                      .map((person) => (
                        <div className={styles.personRow} key={person.id}>
                          <UserAvatar fullName={getUserDisplayName(person)} />
                          <span>
                            <strong>{getUserDisplayName(person)}</strong>
                            <small>{getUserSecondaryLabel(person)}</small>
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <ParticipantPicker
                  candidates={directParticipants}
                  selectedIds={newRoomParticipantIds}
                  onChange={setNewRoomParticipantIds}
                  placeholder="Добавить участников"
                />
              )}
              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
            </form>
          </Dialog>
        ) : null}

        {activeRoom?.capabilities.canManage && isRoomSettingsOpen ? (
          <Dialog
            open
            onOpenChange={setIsRoomSettingsOpen}
            title="Редактировать чат"
            className={styles.dialog}
            footer={
              <div className={styles.dialogActions}>
                <Button
                  onClick={() => setIsRoomSettingsOpen(false)}
                >
                  Отмена
                </Button>
                <Button variant="primary"
                  type="submit"
                  form="chat-rename-form"
                  disabled={!renameTitle.trim()}
                >
                  Сохранить
                </Button>
              </div>
            }
          >
            <form
              id="chat-rename-form"
              className={styles.dialogForm}
              onSubmit={handleRenameRoom}
            >
              <label className={styles.field}>
                <span>Название чата</span>
                <input
                  autoFocus
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  aria-label="Название чата"
                  data-dialog-initial-focus
                />
              </label>
              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
            </form>
          </Dialog>
        ) : null}

        {activeRoom && isParticipantsPanelOpen ? (
          <Dialog
            open
            onOpenChange={setIsParticipantsPanelOpen}
            title="Информация о чате"
            className={styles.dialog}
          >
            <div className={styles.roomSummary}>
              <UserAvatar
                fullName={getRoomDisplayTitle(activeRoom)}
                size="large"
              />
              <strong>{getRoomDisplayTitle(activeRoom)}</strong>
              <span>Участники: {activeRoom.participantCount}</span>
            </div>
            <div className={styles.infoActions}>
              <Button
                onClick={() => {
                  setIsParticipantsPanelOpen(false);
                  setExplorer('search');
                }}
              >
                <ChatIcon name="search" />
                Поиск
              </Button>
              <Button
                onClick={() => {
                  setIsParticipantsPanelOpen(false);
                  setExplorer('media');
                }}
              >
                <ChatIcon name="gallery" />
                Медиа
              </Button>
              <Button
                onClick={() => {
                  setIsParticipantsPanelOpen(false);
                  setExplorer('files');
                }}
              >
                <ChatIcon name="file" />
                Файлы
              </Button>
            </div>
            <div className={styles.listHeading}>Участники</div>
            <div className={styles.searchField}>
              <ChatIcon name="search" />
              <input
                aria-label="Найти участника чата"
                placeholder="Найти участника"
                value={participantsQuery}
                onChange={(event) => setParticipantsQuery(event.target.value)}
              />
            </div>
            {isLoadingParticipants ? (
              <p className={styles.hint}>Загрузка участников…</p>
            ) : (
              <div className={styles.peopleList}>
                {roomParticipants
                  .filter((person) =>
                    `${person.user.fullName} ${person.user.login}`
                      .toLocaleLowerCase('ru')
                      .includes(participantsQuery.toLocaleLowerCase('ru')),
                  )
                  .map((participant) => (
                    <div className={styles.personRow} key={participant.id}>
                      <UserAvatar
                        fullName={getUserDisplayName(participant.user)}
                      />
                      <span>
                        <strong>{getUserDisplayName(participant.user)}</strong>
                        <small>{getUserSecondaryLabel(participant.user)}</small>
                      </span>
                      <small className={styles.personRole}>
                        {getParticipantRoleLabel(participant.roleInRoom)}
                      </small>
                    </div>
                  ))}
              </div>
            )}
            {activeRoom.capabilities.canManage &&
            activeRoom.roomType === 'group' ? (
              <form
                className={styles.dialogForm}
                onSubmit={handleAddParticipants}
              >
                <div className={styles.listHeading}>Добавить участников</div>
                <ParticipantPicker
                  candidates={addableParticipants}
                  selectedIds={addParticipantIds}
                  onChange={setAddParticipantIds}
                  placeholder="Найти пользователя"
                />
                <Button variant="primary"
                  type="submit"
                  disabled={!addParticipantIds.length}
                >
                  Добавить выбранных
                </Button>
                <p className={styles.hint}>
                  Новые участники увидят сообщения с момента добавления.
                </p>
              </form>
            ) : null}
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
          </Dialog>
        ) : null}

        {forwardingMessage ? (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setForwardingMessage(null);
                setForwardTargetRoomId('');
              }
            }}
            title="Переслать сообщение"
            className={styles.dialog}
            footer={
              <div className={styles.dialogActions}>
                <Button
                  onClick={() => {
                    setForwardingMessage(null);
                    setForwardTargetRoomId('');
                  }}
                >
                  Отмена
                </Button>
                <Button variant="primary"
                  type="submit"
                  form="chat-forward-form"
                  disabled={!forwardTargetRoomId}
                >
                  Переслать
                </Button>
              </div>
            }
          >
            <form
              id="chat-forward-form"
              className={styles.dialogForm}
              onSubmit={handleForwardMessage}
            >
              <div className={styles.searchField}>
                <ChatIcon name="search" />
                <input
                  autoFocus
                  value={forwardQuery}
                  onChange={(event) => setForwardQuery(event.target.value)}
                  aria-label="Найти чат для пересылки"
                  data-dialog-initial-focus
                  placeholder="Кому переслать"
                />
              </div>
              <div className={styles.peopleList}>
                {forwardTargetRooms
                  .filter((room) =>
                    getRoomDisplayTitle(room)
                      .toLocaleLowerCase('ru')
                      .includes(forwardQuery.toLocaleLowerCase('ru')),
                  )
                  .map((room) => (
                    <button
                      type="button"
                      key={room.id}
                      className={styles.personRow}
                      aria-pressed={forwardTargetRoomId === room.id}
                      onClick={() => setForwardTargetRoomId(room.id)}
                    >
                      <UserAvatar fullName={getRoomDisplayTitle(room)} />
                      <strong>{getRoomDisplayTitle(room)}</strong>
                      <span
                        className={styles.selectionCheck}
                        aria-hidden="true"
                      >
                        {forwardTargetRoomId === room.id ? '✓' : ''}
                      </span>
                    </button>
                  ))}
              </div>
              {!forwardTargetRooms.length ? (
                <p className={styles.hint}>
                  Нет доступных чатов для пересылки.
                </p>
              ) : null}
              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
            </form>
          </Dialog>
        ) : null}
      </div>
    </>
  );
}
