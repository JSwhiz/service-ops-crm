import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { ChatRoomParticipantResponseDto, ChatRoomResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Delta only: preserves unknown-source fail-closed policy and exact hidden-room refusal.
test('chat participant overrides remaining delta: manual leadership-room membership only', async t => {
  // New standalone isolated schema, no seven accepted subtests or their dependent state.
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'chat-overrides-membership-delta-'));
  const rawReplies: Array<{ route: string; method: string; actor: string; request: unknown; status: number; body: string }> = [];
  const executedSources = [
    'src/common/access/notification-access.ts', 'src/common/access/notification-source-visibility.ts',
    'src/common/access/notification-chat-visibility.ts', 'src/modules/chats/chats.service.ts',
    'src/modules/chats/chat-realtime.service.ts', 'src/modules/chats/utils/chat-membership.util.ts',
    'src/modules/files/files.service.ts', 'test/chat-participant-leadership-member-delta.integration.test.ts',
  ].map(path => {
    const data = readFileSync(resolve(path)); const target = join(evidenceDirectory, 'source', path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data);
    return { path, sha256: createHash('sha256').update(data).digest('hex') };
  });
  writeFileSync(join(evidenceDirectory, 'executed-source.json'), JSON.stringify(executedSources, null, 2));
  t.after(() => {
    const raw = JSON.stringify(rawReplies, null, 2); const path = join(evidenceDirectory, 'raw-replies.json'); writeFileSync(path, raw);
    t.diagnostic(JSON.stringify({ rawReplies: path, sha256: createHash('sha256').update(raw).digest('hex'), sourceManifest: join(evidenceDirectory, 'executed-source.json') }));
  });
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseURL = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseURL.hostname));
  assert.match(databaseURL.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const [founder, manager, hr] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    db.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    db.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
  ]);
  const [adminCookie, managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: hr.login, password: 'hr123' }),
  ]);
  const request = async (route: string, method = 'GET', body?: unknown, cookie = adminCookie): Promise<Response> => {
    const response = await fetch(`${baseUrl}/api/v1${route}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    rawReplies.push({ route, method, actor: cookie === adminCookie ? founder.id : cookie === managerCookie ? manager.id : hr.id,
      request: body ?? null, status: response.status, body: await response.clone().text() });
    return response;
  };
  const ok = async <T>(route: string, method = 'GET', body?: unknown, cookie = adminCookie): Promise<T> => {
    const response = await request(route, method, body, cookie);
    assert.equal(response.ok, true, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  const baselineRoles = await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } });

  await t.test('manual non-leadership member of leadership-only room gains only explicit room membership', async () => {
    const leadership = await ok<ChatRoomResponseDto>('/chats/rooms/code/leadership');
    const hiddenLeadership = async (): Promise<void> => {
      const hidden = await request('/chats/rooms/code/leadership', 'GET', undefined, hrCookie);
      assert.equal(hidden.status, 404);
      const error = await hidden.json() as { statusCode: number; error: { message: string; statusCode: number } };
      assert.equal(error.statusCode, 404);
      assert.equal(error.error.statusCode, 404);
      assert.equal(error.error.message, 'Chat room not found');
      const messages = await request(`/chats/rooms/${leadership.id}/messages`, 'GET', undefined, hrCookie);
      assert.equal(messages.status, 403);
      assert.equal((await messages.json() as { error: { message: string } }).error.message, 'Chat room access denied');
    };
    await hiddenLeadership();
    await ok(`/chats/rooms/${leadership.id}/participants`, 'POST', { userIds: [hr.id] });
    const admitted = await ok<ChatRoomResponseDto>('/chats/rooms/code/leadership', 'GET', undefined, hrCookie);
    assert.equal(admitted.id, leadership.id);
    assert.equal(admitted.capabilities.canManageMembers, false);
    assert.equal((await ok<ChatRoomParticipantResponseDto[]>(`/chats/rooms/${leadership.id}/participants`)).find(value => value.user.id === hr.id)?.membershipSource, 'manual');
    assert.deepEqual(await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } }), baselineRoles);
    await ok(`/chats/rooms/${leadership.id}/participants/${hr.id}`, 'DELETE');
    await hiddenLeadership();
    await ok(`/chats/rooms/${leadership.id}/participants/${hr.id}/automatic`, 'POST');
    await hiddenLeadership();
  });

});
