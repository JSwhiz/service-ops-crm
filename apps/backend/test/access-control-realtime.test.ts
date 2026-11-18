import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatRealtimeService, type ChatRealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';

// Exercise the actual fan-out path with an already-connected client, without
// creating sockets, signing JWTs, starting Redis or invoking module lifecycle.
test('already-connected realtime client uses fresh access and membership on each event', async () => {
  let subject: AccessSubject = { id: 'reader', isActive: true, roleCodes: ['manager'], accessRules: [] };
  const room = {
    id: 'room', visibilityType: 'explicit_members', deletedAt: null as Date | null,
    createdByUserId: 'owner', participants: [{ userId: 'reader', joinedAt: new Date(0) }],
  };
  let loads = 0;
  const service = new ChatRealtimeService({} as never, {} as never, {
    findById: async () => { loads += 1; return subject; },
    sanitizeUser: (record: AccessSubject) => record,
  } as never, {
    chatRoom: { findUnique: async () => room },
    chatMessage: { findFirst: async ({ where }: { where: { id: string; chatRoomId: string } }) => {
      assert.deepEqual(where, { id: 'message', chatRoomId: room.id });
      return { messageType: 'user', metadata: null, createdAt: new Date(1000) };
    } },
    chatRoomParticipant: { findUnique: async ({ where }: { where: { chatRoomId_userId: { chatRoomId: string; userId: string } } }) => {
      assert.deepEqual(where.chatRoomId_userId, { chatRoomId: room.id, userId: 'reader' });
      const participant = room.participants.find(row => row.userId === where.chatRoomId_userId.userId);
      return participant ? { ...participant, leftAt: null, membershipOverride: null } : null;
    } },
  } as never);
  const frames: Buffer[] = [];
  const internal = service as unknown as {
    clients: Set<{ userId: string; socket: { destroyed: boolean; writable: boolean; write(frame: Buffer): void } }>;
    handleRedisEvent(message: string): Promise<void>;
  };
  internal.clients.add({ userId: 'reader', socket: { destroyed: false, writable: true, write: (frame) => { frames.push(frame); } } });
  const event: ChatRealtimeEvent = { type: 'chat.message_created', roomId: 'room', recipientUserIds: ['reader'], payload: { messageId: 'message' } };
  const deliver = () => internal.handleRedisEvent(JSON.stringify(event));
  const rules = (code: string, effect: 'allow' | 'deny' = 'deny'): AccessRule[] => [{ actionCode: code, effect, scope: 'all', selectedIds: [] }];
  await deliver();
  assert.equal(frames.length, 1, 'Positive control must reach the connected socket');
  for (const code of ['chat.access', 'chat.read', 'chat.messages.read', 'chat.realtime']) {
    subject = { ...subject, accessRules: rules(code) };
    await deliver();
    assert.equal(frames.length, 1, code);
  }
  subject = { ...subject, accessRules: rules('chat.realtime', 'allow') };
  room.participants = [];
  await deliver();
  assert.equal(frames.length, 1, 'All grant must not invent membership');
  room.participants = [{ userId: 'reader', joinedAt: new Date(0) }];
  room.deletedAt = new Date();
  await deliver();
  assert.equal(frames.length, 1, 'Grant must not reopen a closed room');
  room.deletedAt = null;
  subject = { ...subject, isActive: false };
  await deliver();
  assert.equal(frames.length, 1);
  assert.equal(loads, 8, 'Do not reuse the subject from the original connection or queued recipient list');
});

test('objects room parent deny and operation_manager exclusion survive stale queued recipient ids', async () => {
  let subject: AccessSubject = { id: 'reader', isActive: true, roleCodes: ['manager'], accessRules: [] };
  const service = new ChatRealtimeService({} as never, {} as never, {
    findById: async () => subject, sanitizeUser: (record: AccessSubject) => record,
  } as never, { chatRoom: { findUnique: async () => ({
    id: 'objects-room', visibilityType: 'objects_scope', deletedAt: null, createdByUserId: 'owner', participants: [],
  }) },
    chatMessage: { findFirst: async ({ where }: { where: { id: string; chatRoomId: string } }) => {
      assert.deepEqual(where, { id: 'objects-message', chatRoomId: 'objects-room' });
      return { messageType: 'user', metadata: null, createdAt: new Date(1000) };
    } },
    // An automatically eligible user need not have lazily joined the room yet.
    chatRoomParticipant: { findUnique: async () => null },
  } as never);
  const frames: Buffer[] = [];
  const internal = service as unknown as {
    clients: Set<{ userId: string; socket: { destroyed: boolean; writable: boolean; write(frame: Buffer): void } }>;
    handleRedisEvent(message: string): Promise<void>;
  };
  internal.clients.add({ userId: 'reader', socket: { destroyed: false, writable: true, write: (frame) => { frames.push(frame); } } });
  const message = JSON.stringify({ type: 'chat.message_created', roomId: 'objects-room', recipientUserIds: ['reader'], payload: { messageId: 'objects-message' } });
  await internal.handleRedisEvent(message);
  assert.equal(frames.length, 1);
  subject = { ...subject, accessRules: [{ actionCode: 'objects.access', effect: 'deny', scope: 'all', selectedIds: [] }] };
  await internal.handleRedisEvent(message);
  assert.equal(frames.length, 1);
  subject = { ...subject, roleCodes: ['operation_manager'], accessRules: [] };
  await internal.handleRedisEvent(message);
  assert.equal(frames.length, 1);
});
