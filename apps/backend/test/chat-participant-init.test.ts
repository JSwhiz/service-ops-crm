import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { ChatsService } from '../src/modules/chats/chats.service';

const actor = { id: 'actor', login: 'actor', fullName: 'Actor', roleCode: 'manager', roleCodes: ['manager'], isActive: true };
const room = { id: 'room', visibilityType: 'one_time_orders_scope' };
const row = { id: 'winner', chatRoomId: room.id, userId: actor.id, roleInRoom: 'admin', joinedAt: new Date('2020-01-01'), lastReadAt: new Date('2021-02-03'), hiddenAt: new Date('2022-03-04'), leftAt: new Date('2023-04-05') };
const pair = { chatRoomId_userId: { chatRoomId: room.id, userId: actor.id } };
const prismaError = (code: string, target?: unknown) => new Prisma.PrismaClientKnownRequestError('controlled', { code, clientVersion: '6.19.2', meta: { target } });
function fixture(find: () => Promise<unknown>, create: (args: unknown) => Promise<unknown>, reread: (args: unknown) => Promise<unknown>) {
  const service = new ChatsService(...[{ chatRoomParticipant: { findUnique: find, create, findUniqueOrThrow: reread } }, {}, {}, {}, {}] as unknown as ConstructorParameters<typeof ChatsService>);
  return (visibilityType = room.visibilityType) => (service as unknown as { ensureParticipantForAccessibleRoom(user: typeof actor, targetRoom: typeof room): Promise<unknown> }).ensureParticipantForAccessibleRoom(actor, { ...room, visibilityType });
}
test('exact pair collision returns winning record unchanged, including role and lifecycle/read state', async () => {
  for (const target of [['chatRoomId', 'userId'], ['userId', 'chatRoomId']]) {
    let creates = 0, rereads = 0;
    const run = fixture(async () => null, async () => { creates++; throw prismaError('P2002', target); }, async args => { rereads++; assert.deepEqual(args, { where: pair }); return row; });
    assert.equal(await run(), row); assert.equal(creates, 1); assert.equal(rereads, 1);
  }
});
test('all unrelated errors, P2002 targets, and non-Prisma lookalikes propagate unchanged', async () => {
  const errors = [prismaError('P2002', ['id']), prismaError('P2002', ['chatRoomId']), prismaError('P2002', ['chatRoomId', 'userId', 'id']), prismaError('P2002', 'chat_room_participants_chatRoomId_userId_key'), prismaError('P2002'), prismaError('P2003', ['chatRoomId', 'userId']), new Error('database unavailable'), { code: 'P2002', meta: { target: ['chatRoomId', 'userId'] } }];
  for (const error of errors) {
    let rereads = 0;
    const run = fixture(async () => null, async () => { throw error; }, async () => { rereads++; return row; });
    await assert.rejects(run(), e => e === error); assert.equal(rereads, 0);
  }
});
test('disappearing winning pair propagates reread failure without another create', async () => {
  const missing = prismaError('P2025'); let creates = 0;
  const run = fixture(async () => null, async () => { creates++; throw prismaError('P2002', ['chatRoomId', 'userId']); }, async () => { throw missing; });
  await assert.rejects(run(), e => e === missing); assert.equal(creates, 1);
});
test('explicit rooms cannot initialize absent membership or revive left membership', async () => {
  let creates = 0, rereads = 0;
  const absent = fixture(async () => null, async () => { creates++; return row; }, async () => { rereads++; return row; });
  await assert.rejects(absent('explicit_members'), /Chat participant not found/);
  const left = fixture(async () => row, async () => { creates++; return row; }, async () => { rereads++; return row; });
  await assert.rejects(left('explicit_members'), /has left/); assert.equal(creates, 0); assert.equal(rereads, 0);
});
test('existing membership is returned unchanged without any write or recovery read', async () => {
  const run = fixture(async () => row, async () => { throw Error('unexpected create'); }, async () => { throw Error('unexpected recovery'); });
  assert.equal(await run(), row);
});
test('two missing reads create once; collision reuses exact winner without resetting it', async () => {
  let arrivals = 0, release!: () => void, saved: unknown = null, creates = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const run = fixture(async () => { if (++arrivals === 2) release(); await barrier; return null; }, async args => {
    creates++;
    assert.deepEqual(args, { data: { chatRoomId: room.id, userId: actor.id, roleInRoom: 'member', joinedAt: new Date(0) } });
    if (saved) throw prismaError('P2002', ['chatRoomId', 'userId']); saved = row; return row;
  }, async args => { assert.deepEqual(args, { where: pair }); return saved; });
  assert.deepEqual(await Promise.all([run(), run()]), [row, row]); assert.equal(creates, 2); assert.equal(saved, row);
});
