import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { canAccessDefaultChatByRole } from '../src/modules/chats/utils/chat-access.util';
import { UserAbsencesService } from '../src/modules/user-absences/user-absences.service';

test('ordinary calendar readers see colleagues without their private comments and never acquire foreign write access', async () => {
  let query: Prisma.Sql | undefined;
  const now = new Date('2026-10-26T10:00:00Z');
  const rows = ['reader', 'colleague'].map((userId) => ({
    id: `absence-${userId}`, userId, login: userId, fullName: userId,
    absenceType: 'day_off', startDate: '2026-10-26', endDate: '2026-10-27',
    comment: `Private ${userId}`, createdByUserId: userId, createdAt: now, updatedAt: now,
  }));
  const service = new UserAbsencesService({ $queryRaw: async (value: Prisma.Sql) => { query = value; return rows; } } as never, {} as never);
  const reader = { id: 'reader', login: 'reader', fullName: 'Reader', roleCode: 'manager', isActive: true, permissionCodes: [] };
  const list = await service.list(reader, {});
  assert.equal(list.capabilities.canViewAll, true);
  assert.equal(list.capabilities.canManageAll, false);
  assert.equal(list.capabilities.canViewPrivateReasons, false);
  assert.equal(list.items.find((item) => item.userId === 'reader')?.comment, 'Private reader');
  assert.equal(list.items.find((item) => item.userId === 'colleague')?.comment, null);
  assert.ok(!query!.values.includes(reader.id));
  await service.list(reader, { userId: 'colleague' });
  assert.ok(query!.values.includes('colleague'));
  await assert.rejects(service.create(reader, { userId: 'colleague', absenceType: 'day_off', startDate: '2026-10-26', endDate: '2026-10-27' }), ForbiddenException);
  await assert.rejects(service.list({ ...reader, isActive: false }, {}), ForbiddenException);
  const granted = await service.list({ ...reader, permissionCodes: ['user_absences.manage', 'user_absences.view_private_reasons'] }, {});
  assert.equal(granted.capabilities.canManageAll, true);
  assert.equal(granted.items.find((item) => item.userId === 'colleague')?.comment, 'Private colleague');
});

test('objects chat excludes operation_manager without changing leadership or one-time-order chat rules', () => {
  assert.equal(canAccessDefaultChatByRole(['operation_manager'], 'objects'), false);
  assert.equal(canAccessDefaultChatByRole(['operation_manager', 'manager'], 'objects'), false);
  assert.equal(canAccessDefaultChatByRole(['operation_manager'], 'one_time_orders'), true);
  assert.equal(canAccessDefaultChatByRole(['operation_manager'], 'leadership'), false);
  assert.equal(canAccessDefaultChatByRole(['manager'], 'objects'), true);
  assert.equal(canAccessDefaultChatByRole(['hr'], 'leadership'), false);
  assert.equal(canAccessDefaultChatByRole(['deputy_director'], 'leadership'), false);
  for (const role of ['founder', 'deputy_founder', 'director', 'corporate_director']) {
    assert.equal(canAccessDefaultChatByRole([role], 'leadership'), true);
    assert.equal(canAccessDefaultChatByRole([role, 'operation_manager'], 'objects'), true);
  }
});
