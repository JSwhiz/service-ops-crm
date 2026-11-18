import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatsService } from '../src/modules/chats/chats.service';
import type { FileResponseDto } from '../src/modules/files/dto/file-response.dto';
import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';

// Execute the actual shared mapper with a fully populated batch context. No
// HTTP, membership authorization, database, storage, Redis, or browser proof.
const now = new Date('2026-11-08T00:00:00Z');
const roomId = 'room-a';
const messageId = 'message-a';
const service = new ChatsService({} as never, {} as never, {} as never, {} as never, {} as never);
const mapper = service as unknown as {
  mapMessage(user: AccessSubject, message: unknown, context: unknown): Promise<{ attachments: FileResponseDto[]; text: string }>;
  mapChatFileAttachment(attachment: unknown): FileResponseDto;
};
const file = (id: string, uploader: string): FileResponseDto => ({
  id, uploadedByUserId: uploader, bucket: 'controlled', objectKey: `controlled/${id}`,
  originalName: `${id}-private.txt`, mimeType: 'text/plain', sizeBytes: 1,
  createdAt: now.toISOString(), url: `/api/v1/files/${id}/content`, attachments: [],
});
const files = [file('own-file', 'reader'), file('foreign-file', 'other')];
const message = { id: messageId, chatRoomId: roomId, deletedAt: null, deletedByUserId: null,
  messageType: 'user', text: 'Readable message', metadata: null, createdAt: now, updatedAt: now,
  editedAt: null, deletedByKind: null, replyToMessageId: null, forwardedFromMessageId: null,
  authorUserId: 'other', author: { id: 'other', login: 'other', fullName: 'Synthetic author' } };
const context = (assigned: boolean) => ({
  attachmentsByMessageId: new Map([[messageId, files]]),
  reactionsByMessageId: new Map([[messageId, []]]), deletedUsersById: new Map(),
  canManageByRoomId: new Map([[roomId, false]]), referencesByMessageId: new Map(),
  accessByRoomId: new Map([[roomId, { resourceType: 'chat_room', resourceId: roomId,
    ownerUserId: 'other', assignedUserIds: assigned ? ['reader'] : [] }]]),
});
const actor = (rules: AccessRule[] = []): AccessSubject => ({
  id: 'reader', isActive: true, roleCodes: ['manager'], accessRules: rules,
});
const rule = (actionCode: string, effect: AccessRule['effect'], scope: AccessRule['scope'], selectedIds: string[] = []): AccessRule =>
  ({ actionCode, effect, scope, selectedIds });

test('chat mapper retains readable file names and never mutates cached attachment arrays', async () => {
  const before = structuredClone(files);
  const dto = await mapper.mapMessage(actor(), message, context(true));
  assert.deepEqual(dto.attachments.map(entry => entry.id), ['own-file', 'foreign-file']);
  assert.equal(dto.text, message.text);
  assert.deepEqual(files, before);
});

for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
  test(`chat file DTO uses actual ${scope} deny and live default restoration`, async () => {
    const ids = scope === 'selected' ? ['foreign-file'] : [];
    const expected = scope === 'own' ? ['foreign-file'] : scope === 'selected' ? ['own-file'] : [];
    const denied = await mapper.mapMessage(actor([rule('files.read', 'deny', scope, ids)]), message, context(true));
    assert.deepEqual(denied.attachments.map(entry => entry.id), expected);
    const granted = await mapper.mapMessage(actor([rule('files.read', 'allow', scope, ids)]), message, context(true));
    assert.equal(granted.attachments.length, 2, 'Allow is additive over the already readable message baseline');
    assert.equal((await mapper.mapMessage(actor(), message, context(true))).attachments.length, 2);
    if (scope === 'assigned') {
      assert.equal((await mapper.mapMessage(actor([rule('files.read', 'deny', scope)]), message, context(false))).attachments.length, 2,
        'Assignment belongs to the real room, not to every readable message');
    }
  });
}

test('file root and room/message parent denies dominate file leaf allows', async () => {
  for (const code of ['files.access', 'chat.access', 'chat.read', 'chat.messages.read']) {
    const rules = [rule('files.read', 'allow', 'all'), rule(code, 'deny', 'all')];
    assert.deepEqual((await mapper.mapMessage(actor(rules), message, context(true))).attachments, [], code);
  }
});

test('a chat file DTO exposes only this message attachment, never unrelated polymorphic links', () => {
  const current = { id: 'link-a', entityType: 'chat_message', entityId: messageId, fieldCode: null,
    uploadedByUserId: 'other', createdAt: now };
  const hidden = { ...current, id: 'link-b', entityType: 'object', entityId: 'hidden-object' };
  const attachment = { ...current, file: { ...files[1], createdAt: now, attachments: [current, hidden] } };
  const dto = mapper.mapChatFileAttachment(attachment);
  assert.deepEqual(dto.attachments.map(entry => entry.id), ['link-a']);
  assert.equal(JSON.stringify(dto).includes('hidden-object'), false);
  assert.equal(attachment.file.attachments.length, 2, 'Filtering the response must not detach the stored file');
});
