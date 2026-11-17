'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { addChatParticipants, listChatManagementRooms, listChatRoomParticipants, removeChatParticipant, restoreAutomaticChatParticipant } from '@/entities/chat/api/chat-client';
import type { ChatManagementRoom, ChatRoomParticipant } from '@/entities/chat/model/chat.types';
import { listChatParticipantCandidates } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button, EmptyState, LoadingState } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { getUserDisplayName } from '@/shared/lib/display-name';
import styles from './chat-membership-management.module.css';

/** Administrative roster only: never selects a conversation or fetches messages. */
export function ChatMembershipManagement({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { user } = useAuth();
  const revision = useAccessRevision();
  const session = getAccessSessionGeneration();
  const generation = getAccessGeneration();
  const [rooms, setRooms] = useState<ChatManagementRoom[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [roomId, setRoomId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [roster, setRoster] = useState<ChatRoomParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirm, confirmDialog] = useConfirm();
  const mounted = useRef(false);
  const mutationLock = useRef(false);
  const authScope = JSON.stringify([user?.id, revision]);
  const latestAuthScope = useRef(authScope);
  latestAuthScope.current = authScope;
  const scope = JSON.stringify([user?.id, revision, roomId]);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const authCurrent = useCallback((): boolean => mounted.current && latestAuthScope.current === authScope && session === getAccessSessionGeneration() && isAccessGenerationCurrent(generation), [authScope, session, generation]);
  const current = useCallback((): boolean => authCurrent() && latestScope.current === scope, [authCurrent, scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void Promise.all([listChatManagementRooms(), listChatParticipantCandidates()]).then(([available, candidates]) => {
      if (!active) return;
      if (!authCurrent()) { setRooms([]); setUsers([]); setError('Доступ обновился. Обновите список чатов.'); return; }
      setRooms(available.items); setUsers(candidates);
    }).catch(() => { if (active) setError(authCurrent() ? 'Не удалось загрузить список чатов. Проверьте доступ и обновите данные.' : 'Доступ обновился. Обновите список чатов.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authCurrent, reload]);

  useEffect(() => {
    let active = true;
    setRoster([]); setTargetUserId(''); setError(null);
    if (!roomId) { setRosterLoading(false); return; }
    setRosterLoading(true);
    void listChatRoomParticipants(roomId).then(rows => {
      if (!active) return;
      if (current()) setRoster(rows);
      else setError('Доступ обновился. Обновите список чатов.');
    })
      .catch(() => { if (active) setError('Состав недоступен. Обновите список чатов.'); })
      .finally(() => { if (active) setRosterLoading(false); });
    return () => { active = false; };
  }, [roomId, current, reload]);

  const change = async (action: () => Promise<unknown>, confirmation?: { title: string; consequence: string; confirmLabel: string }): Promise<void> => {
    if (!current() || !roomId || mutationLock.current || loading || rosterLoading) return;
    mutationLock.current = true; setPending(true); setError(null); setNotice(null);
    let committed = false;
    try {
      if (confirmation && !await confirm(confirmation)) return;
      if (!current()) return;
      await action();
      committed = true; // ACK is an intentional success for an unjoined administrator.
      if (!current()) return;
      setNotice('Состав чата изменён.');
      setTargetUserId('');
      const available = await listChatManagementRooms({ roomId });
      if (!current()) return;
      setRooms(previous => [...previous.filter(room => room.id !== roomId), ...available.items]);
      if (!available.items.some(room => room.id === roomId)) { setRoomId(''); setRoster([]); return; }
      const updated = await listChatRoomParticipants(roomId);
      if (current()) { setRoster(updated); setTargetUserId(''); }
    } catch (caught) {
      if (current() && committed) { setNotice('Состав чата изменён. Обновить список сейчас не удалось.'); setRoster([]); setRoomId(''); }
      else if (current()) setError(caught instanceof ApiError && [403, 404].includes(caught.statusCode) ? 'Доступ к составу изменился. Обновите список чатов.' : 'Не удалось изменить состав. Повторите действие после проверки данных.');
    } finally {
      mutationLock.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const activeIds = new Set(roster.filter(person => person.membershipSource !== 'excluded').map(person => person.user.id));
  return <Dialog open title="Управление составом чатов" busy={pending} onOpenChange={open => { if (!open) onClose(); }}>
    {confirmDialog}
    <div className="ui-stack">
      <p className="ui-text-muted">Управление составом не открывает сообщения и вложения. Личные диалоги остаются двухсторонними.</p>
      {error ? <Alert tone="danger">{error}<Button disabled={pending || loading} onClick={() => setReload(value => value + 1)}>Обновить список</Button></Alert> : null}
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {loading ? <LoadingState label="Загрузка доступных чатов" /> : <SearchableSelect label="Чат" value={roomId} disabled={pending} options={rooms.map(room => ({ value: room.id, label: room.title, description: room.roomType === 'system_default' ? 'Системный чат' : 'Группа' }))} asyncSearch={async q => { if (!authCurrent()) return []; const page = await listChatManagementRooms({ q }); return authCurrent() ? page.items.map(room => ({ value: room.id, label: room.title, description: room.roomType === 'system_default' ? 'Системный чат' : 'Группа' })) : []; }} onChange={id => { setRoomId(id); setNotice(null); }} placeholder="Выберите чат" />}
      {!loading && !rooms.length ? <EmptyState title="Доступных чатов нет" description="Для управления нужны действующие права руководящего круга и доступ к разделу." /> : null}
      {rosterLoading ? <LoadingState label="Загрузка участников" /> : roomId ? <div className={styles.roster}>
        {roster.map(person => <div className={styles.row} key={person.id}>
          <div><strong>{getUserDisplayName(person.user)}</strong><div className="ui-text-muted">{person.membershipSource === 'excluded' ? 'Исключён вручную' : person.membershipSource === 'automatic' ? 'По правилу комнаты' : 'Добавлен вручную'}</div></div>
          <div className="ui-inline">
            {person.canRestoreAutomatic ? <Button size="sm" disabled={pending} onClick={() => void change(() => restoreAutomaticChatParticipant(roomId, person.user.id), { title: 'Вернуть автоматическое участие?', consequence: 'Ручное правило отменится. Доступ будет зависеть от текущей роли и назначений.', confirmLabel: 'Вернуть автоматическое' })}>Вернуть автоматическое</Button> : null}
            {person.canRemove ? <Button size="sm" disabled={pending} onClick={() => void change(() => removeChatParticipant(roomId, person.user.id), { title: 'Исключить участника?', consequence: 'Участник потеряет доступ. Изменение роли или назначения не отменит ручное исключение.', confirmLabel: 'Исключить' })}>Исключить</Button> : null}
          </div>
        </div>)}
        <SearchableSelect label="Добавить пользователя" value={targetUserId} disabled={pending} options={users.filter(person => person.isActive && !activeIds.has(person.id)).map(person => ({ value: person.id, label: getUserDisplayName(person), description: person.login }))} onChange={setTargetUserId} placeholder="Найти пользователя" />
        <Button variant="primary" disabled={pending || !targetUserId} pending={pending} onClick={() => void change(() => addChatParticipants(roomId, { userIds: [targetUserId] }))}>Добавить участника</Button>
      </div> : null}
    </div>
  </Dialog>;
}
