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

function isAtBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
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
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const latestMessageId = messages.at(-1)?.id ?? null;

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

    const updatedRoom = await markChatRoomRead(activeRoomId, {
      lastReadMessageId: latestMessageId,
    });
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
    const container = messageListRef.current;

    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    void markActiveRoomReadIfBottom().catch(() => undefined);
  }, [activeRoomId, messages.length]);

  useEffect(() => {
    const socket = new WebSocket(buildChatRealtimeUrl());

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as RealtimePayload;

        if (!payload.type?.startsWith('chat.')) {
          return;
        }

        void loadRooms().catch(() => undefined);

        if (payload.roomId && payload.roomId === activeRoomId) {
          void loadMessages(payload.roomId).catch(() => undefined);
        }
      } catch {
        // Ignore malformed realtime events.
      }
    };

    return () => {
      socket.close();
    };
  }, [activeRoomId]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!activeRoomId || isSending) {
      return;
    }

    setIsSending(true);
    setError(null);

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

  return (
    <>
      <PageTitle title="Чаты" />

      <div className="page-stack">
        {error ? (
          <div className="page-card" style={{ color: '#b91c1c' }}>
            {error}
          </div>
        ) : null}

        <div className="chat-layout">
          <aside className="chat-room-panel page-card">
            <div className="section-header">
              <div>
                <div className="section-title">Комнаты</div>
                <div className="section-subtitle">
                  Рабочие чаты отдельно от комментариев.
                </div>
              </div>
            </div>

            {canManageChats ? (
              <form className="chat-admin-form" onSubmit={handleCreateRoom}>
                <label>
                  <span>Новый чат</span>
                  <input
                    value={newRoomTitle}
                    onChange={(event) => setNewRoomTitle(event.target.value)}
                    placeholder="Название"
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
                <button type="submit">Создать</button>
              </form>
            ) : null}

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
                    onClick={() => setActiveRoomId(room.id)}
                  >
                    <span className="chat-room-item__main">
                      <strong>{room.title}</strong>
                      <span>
                        {room.lastMessagePreview ?? 'Сообщений пока нет'}
                      </span>
                    </span>
                    <span className="chat-room-item__meta">
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
                  <div>
                    <div className="section-title">{activeRoom.title}</div>
                    <div className="section-subtitle">
                      {activeRoom.roomType === 'custom'
                        ? 'Custom room'
                        : 'System room'}{' '}
                      · участников: {activeRoom.participantCount}
                    </div>
                  </div>
                  <span className="status-pill">
                    {activeRoom.unreadCount > 0
                      ? `Новых: ${activeRoom.unreadCount}`
                      : 'Прочитано'}
                  </span>
                </header>

                {activeRoom.capabilities.canManage ? (
                  <div className="chat-management-strip">
                    <form onSubmit={handleRenameRoom}>
                      <input
                        value={renameTitle}
                        onChange={(event) => setRenameTitle(event.target.value)}
                        aria-label="Название чата"
                      />
                      <button type="submit">Переименовать</button>
                    </form>

                    {activeRoom.visibilityType === 'explicit_members' ? (
                      <form onSubmit={handleAddParticipants}>
                        <select
                          multiple
                          value={addParticipantIds}
                          onChange={(event) =>
                            setAddParticipantIds(
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
                        <button type="submit">Добавить</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}

                <div
                  ref={messageListRef}
                  className="chat-message-list"
                  onScroll={() => {
                    void markActiveRoomReadIfBottom().catch(() => undefined);
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
                              {message.attachments.length > 0 ? (
                                <div className="chat-attachments">
                                  {message.attachments.map((file) => (
                                    <a
                                      key={file.id}
                                      href={resolveFileUrl(file.url, file.id)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="chat-attachment"
                                    >
                                      {file.mimeType.startsWith('image/') ? (
                                        <img
                                          src={resolveFileUrl(file.url, file.id)}
                                          alt={file.originalName}
                                        />
                                      ) : (
                                        <span>{file.originalName}</span>
                                      )}
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

                {activeRoom.capabilities.canWrite ? (
                  <form className="chat-composer" onSubmit={handleSend}>
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder="Сообщение"
                      rows={3}
                    />
                    <div className="chat-composer__actions">
                      <label className="file-picker-button">
                        <span>Вложения</span>
                        <input
                          type="file"
                          multiple
                          onChange={(event) =>
                            setFiles(Array.from(event.currentTarget.files ?? []))
                          }
                        />
                      </label>
                      <span className="page-muted">
                        {files.length > 0
                          ? `Выбрано файлов: ${files.length}`
                          : 'Текст, фото или файл'}
                      </span>
                      <button type="submit" disabled={isSending}>
                        Отправить
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="page-muted">Нет права писать в этот чат.</div>
                )}
              </>
            ) : (
              <div className="chat-empty">Выберите чат слева.</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
