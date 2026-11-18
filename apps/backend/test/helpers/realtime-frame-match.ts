import assert from 'node:assert/strict';

type Frame = { type: string; roomId?: string; payload: Record<string, unknown> };

// Negative delivery assertions must not mistake altered metadata for absence.
// Positive assertions separately require the exact complete payload/envelope.
export function hasRealtimeEventIdentity(frame: Frame, event: Frame): boolean {
  if (event.type === 'notification.created') {
    assert.ok(typeof event.payload.id === 'string' && event.payload.id.length > 0, 'Notification fixture needs a stable ID');
    return frame.type === event.type && frame.payload.id === event.payload.id;
  }
  if (event.type.startsWith('chat.message_')) {
    assert.ok(typeof event.payload.messageId === 'string' && event.payload.messageId.length > 0, 'Message fixture needs a stable ID');
    return frame.type === event.type && frame.payload.messageId === event.payload.messageId;
  }
  assert.ok(event.type.startsWith('chat.') && typeof event.roomId === 'string' && event.roomId.length > 0, 'Room fixture needs a stable ID');
  return frame.type === event.type && (frame.roomId === event.roomId || frame.payload.roomId === event.roomId);
}
