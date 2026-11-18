import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { GlobalSearchItemDto, GlobalSearchResponseDto } from '../src/modules/search/dto/global-search-response.dto';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('side-channel HTTP: old session object deny covers search/recent, files and notification counts', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const marker = `acl-channels-${randomUUID()}`;
  const secret = `ForbiddenObject-${randomUUID()}`;
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const reader = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const objects = await Promise.all([secret, `${marker}-visible`].map((name) => prisma.object.create({ data: {
    name, address: 'Isolated channel fixture', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: reader.id, assignmentRoleCode: 'manager', isActive: true } },
  } })));
  const task = await prisma.task.create({ data: {
    title: `${marker}-task`, priority: 'normal', status: 'new', scopeType: 'object',
    objectId: objects[0].id, createdByUserId: reader.id,
  } });
  const request = (path: string, body?: unknown, auth = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const denyObject = () => prisma.userAccessRule.create({ data: {
    userId: reader.id, actionCode: 'objects.access', effect: 'deny', scope: 'selected', selectedIds: [objects[0].id],
  } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: reader.id } });

  await t.test('search and recent never disclose a forbidden object through a visible task', async () => {
    await reset();
    const before = await request('/search/recent', { refs: [{ type: 'object', id: objects[0].id }, { type: 'task', id: task.id }] });
    assert.equal(before.status, 200);
    assert.ok(JSON.stringify(await before.json()).includes(secret), 'Positive control: object was visible before revoke');
    await denyObject();
    const direct = await request(`/search?q=${encodeURIComponent(secret)}`);
    assert.equal(direct.status, 200);
    const directBody = await direct.json() as GlobalSearchResponseDto;
    const directEvidence = `Search returned domain items; full response=${JSON.stringify(directBody)}`;
    // query is public input echoed by the API; authorization concerns domain items.
    assert.equal(directBody.query, secret);
    assert.equal(directBody.items.some((item) => item.type === 'object' && item.id === objects[0].id), false, directEvidence);
    assert.equal(directBody.items.some((item) => item.type === 'task' && item.id === task.id), false, directEvidence);
    assert.equal(JSON.stringify(directBody.items).includes(secret), false, directEvidence);
    const recent = await request('/search/recent', { refs: [
      { type: 'object', id: objects[0].id }, { type: 'object', id: objects[1].id }, { type: 'task', id: task.id },
    ] });
    assert.equal(recent.status, 200);
    const body = await recent.json() as GlobalSearchItemDto[];
    const recentEvidence = `Recent domain results=${JSON.stringify(body)}`;
    assert.ok(body.some((row) => row.id === objects[1].id), 'Unrelated allowed object must remain visible');
    assert.equal(body.some((row) => row.type === 'object' && row.id === objects[0].id), false, recentEvidence);
    assert.equal(body.some((row) => row.type === 'task' && row.id === task.id), false, recentEvidence);
    assert.equal(JSON.stringify(body).includes(secret), false, recentEvidence);
  });

  await t.test('stored notification list and unread count both exclude direct and indirect forbidden parents', async () => {
    await reset();
    await prisma.notification.createMany({ data: [
      { recipientUserId: reader.id, type: 'acl-test', title: secret, entityType: 'object', entityId: objects[0].id },
      { recipientUserId: reader.id, type: 'acl-test', title: secret, entityType: 'task', entityId: task.id },
      { recipientUserId: reader.id, type: 'acl-test', title: 'Allowed control', entityType: 'object', entityId: objects[1].id },
    ] });
    const before = await request('/notifications/unread-count');
    assert.equal(before.status, 200);
    assert.equal(((await before.json()) as { count: number }).count, 3);
    await denyObject();
    const list = await request('/notifications?page=1&limit=1');
    assert.equal(list.status, 200);
    const body = await list.json() as { total: number; items: Array<{ entityId: string }> };
    assert.equal(body.total, 1, 'Filtering must happen before pagination and count, including linked tasks');
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].entityId, objects[1].id);
    const count = await request('/notifications/unread-count');
    assert.equal(count.status, 200);
    assert.equal(((await count.json()) as { count: number }).count, 1);
  });

  await t.test('original/thumbnail/preview/retry enforce action denies and real object parent deny', async () => {
    await reset();
    const form = new FormData();
    form.set('entityType', 'object'); form.set('entityId', objects[0].id);
    form.set('file', new Blob([`Private original ${secret}`], { type: 'text/plain' }), 'acl-proof.txt');
    const uploaded = await fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: founderCookie }, body: form });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const file = await uploaded.json() as { id: string };
    const original = await request(`/files/${file.id}/content?download=1`);
    assert.equal(original.status, 200, await original.clone().text());
    assert.equal(await original.text(), `Private original ${secret}`);
    await prisma.userAccessRule.createMany({ data: ['files.preview', 'files.preview.retry'].map((actionCode) => ({
      userId: reader.id, actionCode, effect: 'deny', scope: 'all',
    })) });
    const view = await request(`/files/${file.id}/view`);
    assert.equal(view.status, 200);
    const metadata = await view.json() as {
      capabilities: { canPreview: boolean; canDownload: boolean; canRetryPreview: boolean };
      inlineContentUrl: string | null; thumbnailUrl: string | null;
    };
    assert.deepEqual(metadata.capabilities, { canPreview: false, canDownload: true, canRetryPreview: false });
    assert.equal(metadata.inlineContentUrl, null); assert.equal(metadata.thumbnailUrl, null);
    for (const suffix of ['/thumbnail', '/preview/content']) assert.equal((await request(`/files/${file.id}${suffix}`)).status, 403);
    assert.equal((await request(`/files/${file.id}/preview/retry`, {})).status, 403);
    await prisma.userAccessRule.create({ data: { userId: reader.id, actionCode: 'files.download', effect: 'deny', scope: 'all' } });
    assert.equal((await request(`/files/${file.id}/content?download=1`)).status, 403);
    await reset();
    await denyObject();
    for (const suffix of ['', '/view', '/content', '/content?download=1', '/thumbnail', '/preview/content']) {
      const response = await request(`/files/${file.id}${suffix}`);
      assert.equal(response.status, 403, `${suffix}: ${await response.clone().text()}`);
    }
    assert.equal((await request(`/files/${file.id}/preview/retry`, {})).status, 403);
  });

  await t.test('removing a source assignment hides stored notifications and unread count without an explicit deny', async () => {
    const revokedReader = await prisma.user.create({ data: {
      login: `${marker}-assignment`, fullName: 'Notification assignment fixture', passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } },
    } });
    const oldCookie = await loginAndGetCookieHeader({ baseUrl, login: revokedReader.login, password: 'manager123' });
    const sources = await Promise.all(['revoked', 'retained'].map((suffix) => prisma.object.create({ data: {
      name: `${marker}-notification-${suffix}`, address: 'Source assignment fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: { userId: revokedReader.id, assignmentRoleCode: 'manager', isActive: true } },
    } })));
    const notifications = await Promise.all(sources.map((source) => prisma.notification.create({ data: {
      recipientUserId: revokedReader.id, type: 'acl-assignment-test', title: source.name,
      entityType: 'object', entityId: source.id, targetUrl: `/objects/${source.id}`,
    } })));
    const get = (path: string) => request(path, undefined, oldCookie);
    const beforeSource = await get(`/objects/${sources[0].id}`);
    assert.equal(beforeSource.status, 200, await beforeSource.clone().text());
    const beforeList = await get('/notifications?page=1&limit=10');
    assert.equal(beforeList.status, 200);
    const before = await beforeList.json() as { total: number; items: Array<{ id: string }> };
    assert.equal(before.total, 2);
    assert.deepEqual(new Set(before.items.map((item) => item.id)), new Set(notifications.map((item) => item.id)));
    const beforeCount = await get('/notifications/unread-count');
    assert.equal(((await beforeCount.json()) as { count: number }).count, 2);
    const assignment = await prisma.objectAssignment.findFirstOrThrow({ where: {
      objectId: sources[0].id, userId: revokedReader.id, isActive: true,
    } });
    await prisma.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
    assert.equal(await prisma.userAccessRule.count({ where: { userId: revokedReader.id } }), 0,
      'Revocation must come from baseline source visibility, not a new explicit deny');
    const deniedSource = await get(`/objects/${sources[0].id}`);
    assert.ok([403, 404].includes(deniedSource.status), await deniedSource.clone().text());
    const list = await get('/notifications?page=1&limit=1');
    assert.equal(list.status, 200);
    const body = await list.json() as { total: number; items: Array<{ id: string; entityId: string }> };
    assert.deepEqual({ total: body.total, ids: body.items.map((item) => item.id) }, {
      total: 1, ids: [notifications[1].id],
    }, `Stored notifications after source assignment revoke=${JSON.stringify(body)}`);
    const count = await get('/notifications/unread-count');
    assert.equal(count.status, 200);
    assert.equal(((await count.json()) as { count: number }).count, 1);
    const blockedRead = await request(`/notifications/${notifications[0].id}/read`, {}, oldCookie);
    assert.equal(blockedRead.status, 404);
    const saved = await prisma.notification.findUniqueOrThrow({ where: { id: notifications[0].id } });
    assert.equal(saved.readAt, null);
    assert.equal(saved.dismissedAt, null);
    await prisma.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: true } });
    const restored = await get('/notifications/unread-count');
    assert.equal(((await restored.json()) as { count: number }).count, 2,
      'Restoring source visibility must reveal the retained records, not recreate notifications');
  });
});
