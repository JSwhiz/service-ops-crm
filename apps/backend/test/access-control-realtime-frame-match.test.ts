import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRealtimeEventIdentity } from './helpers/realtime-frame-match';

const notification = { type: 'notification.created', payload: { id: 'notice-A', title: 'Private title', body: 'Private body' } };
const message = { type: 'chat.message_updated', roomId: 'room-A', payload: { messageId: 'message-A' } };
const room = { type: 'chat.room_updated', roomId: 'room-A', payload: { roomId: 'room-A' } };

test('negative notification assertion detects altered and additional metadata under the same ID', () => {
  for (const payload of [{ id: 'notice-A' }, { ...notification.payload, title: 'Changed' }, { ...notification.payload, extra: 'Forbidden metadata' }]) {
    assert.equal(hasRealtimeEventIdentity({ type: notification.type, payload }, notification), true);
  }
});
test('notification control B remains distinct even when title/body are equal', () => {
  assert.equal(hasRealtimeEventIdentity({ ...notification, payload: { ...notification.payload, id: 'notice-B' } }, notification), false);
});
test('negative message assertion detects added file metadata and altered room envelope under the same message ID', () => {
  assert.equal(hasRealtimeEventIdentity({ ...message, roomId: 'changed-room', payload: { ...message.payload, attachments: [{ originalName: 'private.txt' }] } }, message), true);
  assert.equal(hasRealtimeEventIdentity({ type: message.type, payload: message.payload }, message), true);
});
test('message control B remains distinct', () => {
  assert.equal(hasRealtimeEventIdentity({ ...message, payload: { messageId: 'message-B' } }, message), false);
});
test('room assertion detects the stable room in envelope or payload despite other changes', () => {
  assert.equal(hasRealtimeEventIdentity({ ...room, payload: { altered: true } }, room), true);
  assert.equal(hasRealtimeEventIdentity({ type: room.type, payload: { roomId: 'room-A', added: true } }, room), true);
});
test('room B processing fence cannot satisfy forbidden room A identity', () => {
  assert.equal(hasRealtimeEventIdentity({ ...room, roomId: 'room-B', payload: { roomId: 'room-B' } }, room), false);
});
test('event kind is part of each identity', () => {
  for (const event of [notification, message, room]) assert.equal(hasRealtimeEventIdentity({ ...event, type: 'different.event' }, event), false);
});
test('an incomplete fixture cannot silently make negative assertions always false', () => {
  for (const event of [
    { type: 'notification.created', payload: {} },
    { type: 'chat.message_updated', roomId: 'room-A', payload: {} },
    { type: 'chat.room_updated', payload: {} },
  ]) assert.throws(() => hasRealtimeEventIdentity(event, event));
});
