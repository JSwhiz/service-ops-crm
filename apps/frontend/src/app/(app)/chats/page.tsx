'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  addChatParticipants,
  buildChatRealtimeUrl,
  createChatRoom,
  editChatMessage,
  listChatMessages,
  listChatRooms,
  markChatRoomRead,
  renameChatRoom,
  sendChatMessage,
} from '@/entities/chat/api/chat-client';
import type { ChatMessage, ChatRoom, ChatRoomCode } from '@/entities/chat/model/chat.types';
import { buildFileDownloadUrl } from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { listChatParticipantCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

type RealtimePayload = {
  type?: string;
  roomId?: string;
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

function resolveFileUrl(url: string, id: string): string {
  if (url.startsWith('http')) {
    return url;
  }

  return buildFileDownloadUrl(id);
}

function isImageAttachment(file: AttachedFile): boolean {
  return file.mimeType.startsWith('image/');
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} КБ`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} МБ`;
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

function getPendingFileKey(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
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
  const [isRoomListOpen, setIsRoomListOpen] = useState(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [pendingImagePreviews, setPendingImagePreviews] = useState<
    Array<{ key: string; url: string; name: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string | null>(null);

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
      void markActiveRoomReadIfBottom().catch(() => undefined);
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

  const markActiveRoomReadIfBottom = async (): Promise<void> => {
    if (!activeRoomId || !latestMessageId || !messageListRef.current) {
      return;
    }

    if (!isAtBottom(messageListRef.current)) {
      return;
    }

    if (lastMarkedReadMessageIdRef.current === latestMessageId) {
      return;
    }

    const updatedRoom = await markChatRoomRead(activeRoomId, {
      lastReadMessageId: latestMessageId,
    });
    lastMarkedReadMessageIdRef.current = latestMessageId;
    setRooms((current) =>
      current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
    );
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
    pendingScrollToBottomRef.current = true;
    setHasNewMessagesBelow(false);
    setIsRoomSettingsOpen(false);
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
    if (!pendingScrollToBottomRef.current) {
      return;
    }

    pendingScrollToBottomRef.current = false;
    scrollMessagesToBottom('auto');
  }, [activeRoomId, messages.length]);

  useEffect(() => {
    const previews = files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => file.type.startsWith('image/'))
      .map(({ file, index }) => ({
        key: getPendingFileKey(file, index),
        url: URL.createObjectURL(file),
        name: file.name,
      }));

    setPendingImagePreviews(previews);

    return () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [files]);

  useEffect(() => {
    const socket = new WebSocket(buildChatRealtimeUrl());

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as RealtimePayload;

        if (!payload.type?.startsWith('chat.')) {
          return;
        }

        void listChatRooms().then(setRooms).catch(() => undefined);

        if (payload.roomId && payload.roomId === activeRoomIdRef.current) {
          const shouldStickToBottom = messageListRef.current
            ? isAtBottom(messageListRef.current)
            : true;
          pendingScrollToBottomRef.current = shouldStickToBottom;
          setHasNewMessagesBelow(!shouldStickToBottom);
          void loadMessages(payload.roomId).catch(() => undefined);
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
      await sendChatMessage({
        roomId: activeRoomId,
        text,
        files,
      });
      setText('');
      setFiles([]);
      await loadRooms();
      await loadMessages(activeRoomId);
      scrollMessagesToBottom('smooth');
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
  const activeRoomTypeLabel = activeRoom ? getRoomTypeLabel(activeRoom) : '';
  const layoutClassName = `chat-layout${
    isRoomListOpen ? ' chat-layout--room-list-open' : ''
  }`;
  const pendingImagePreviewMap = new Map(
    pendingImagePreviews.map((preview) => [preview.key, preview]),
  );

  const selectRoom = (roomId: string): void => {
    setActiveRoomId(roomId);
    setIsRoomListOpen(false);
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
                        </span>{' '}
                        · участников: {activeRoom.participantCount}
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

                {activeRoom.capabilities.canManage && isRoomSettingsOpen ? (
                  <div className="chat-room-settings-panel">
                    <form onSubmit={handleRenameRoom}>
                      <label>
                        <span>Название комнаты</span>
                        <input
                          value={renameTitle}
                          onChange={(event) => setRenameTitle(event.target.value)}
                          aria-label="Название чата"
                        />
                      </label>
                      <button type="submit">Переименовать</button>
                    </form>

                    {activeRoom.visibilityType === 'explicit_members' ? (
                      <form onSubmit={handleAddParticipants}>
                        <label>
                          <span>Добавить участников</span>
                          <select
                            multiple
                            value={addParticipantIds}
                            onChange={(event) =>
                              setAddParticipantIds(
                                Array.from(
                                  event.currentTarget.selectedOptions,
                                ).map((option) => option.value),
                              )
                            }
                          >
                            {selectableParticipants.map((participant) => (
                              <option key={participant.id} value={participant.id}>
                                {participant.fullName} · {participant.login}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="submit">Добавить</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}

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
                        void markActiveRoomReadIfBottom().catch(() => undefined);
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
                        const imageAttachments =
                          message.attachments.filter(isImageAttachment);
                        const fileAttachments = message.attachments.filter(
                          (file) => !isImageAttachment(file),
                        );

                        return (
                          <article
                            key={message.id}
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
                                  : message.author?.fullName ?? 'Пользователь'}
                              </strong>
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
                                {imageAttachments.length > 0 ? (
                                  <div
                                    className={`chat-image-grid chat-image-grid--${Math.min(
                                      imageAttachments.length,
                                      4,
                                    )}`}
                                  >
                                    {imageAttachments.map((file) => (
                                      <a
                                        key={file.id}
                                        href={resolveFileUrl(file.url, file.id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="chat-image-attachment"
                                      >
                                        <img
                                          src={resolveFileUrl(file.url, file.id)}
                                          alt={file.originalName}
                                        />
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                                {fileAttachments.length > 0 ? (
                                  <div className="chat-file-list">
                                    {fileAttachments.map((file) => (
                                      <a
                                        key={file.id}
                                        href={resolveFileUrl(file.url, file.id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="chat-file-card"
                                      >
                                        <span className="chat-file-card__icon">
                                          FILE
                                        </span>
                                        <span className="chat-file-card__body">
                                          <strong>{file.originalName}</strong>
                                          <span>
                                            {file.mimeType} ·{' '}
                                            {formatFileSize(file.sizeBytes)}
                                          </span>
                                        </span>
                                      </a>
                                    ))}
                                  </div>
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
                        );
                      })
                    )}
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
                        {files.map((file, index) => {
                          const preview = pendingImagePreviewMap.get(
                            getPendingFileKey(file, index),
                          );

                          return (
                            <span
                              key={getPendingFileKey(file, index)}
                              className={`chat-pending-file${
                                preview ? ' chat-pending-file--image' : ''
                              }`}
                            >
                              {preview ? (
                                <img src={preview.url} alt={preview.name} />
                              ) : (
                                <span className="chat-pending-file__icon">
                                  FILE
                                </span>
                              )}
                              <span className="chat-pending-file__body">
                                <strong>{file.name}</strong>
                                <span>{formatFileSize(file.size)}</span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Убрать ${file.name}`}
                                onClick={() => removePendingFile(index)}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
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
                <select
                  multiple
                  value={newRoomParticipantIds}
                  onChange={(event) =>
                    setNewRoomParticipantIds(
                      Array.from(event.currentTarget.selectedOptions).map(
                        (option) => option.value,
                      ),
                    )
                  }
                >
                  {selectableParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.fullName} · {participant.login}
                    </option>
                  ))}
                </select>
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
      </div>
    </>
  );
}
