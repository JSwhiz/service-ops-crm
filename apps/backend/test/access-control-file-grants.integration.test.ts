import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

import type { FileViewResponseDto } from '../src/modules/files/dto/file-view-response.dto';
import { StorageService } from '../src/modules/storage/storage.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Target = { entityType: 'object' | 'task' | 'one_time_order'; entityId: string };
type Uploaded = { id: string; originalName: string; mimeType: string; sizeBytes: number; viewUrl: string; downloadUrl: string };

test('supported file grants enforce source boundaries with real tiny-text storage and live session changes', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  const schema = databaseUrl.searchParams.get('schema') ?? '';
  assert.match(schema, /^integration_\d+_\d+$/);
  // Refuse remote storage BEFORE app initialization (StorageService pings it).
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  const port = Number(process.env.MINIO_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  assert.ok(process.env.MINIO_BUCKET && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);
  assert.match(process.env.FILE_PREVIEW_QUEUE_NAME ?? '', /:integration:\d+:\d+$/);
  const prefix = `integration/${schema}/file-grants-${randomUUID()}/`;
  const expectedBytes = new Map<string, Buffer>();
  const ownedKeys = new Map<string, string>();
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreStorage: (() => void) | undefined = undefined;
  let cleanupClient: S3Client | undefined = undefined;
  t.after(async () => {
    try {
      restoreStorage?.();
      await closeApp?.();
    } finally {
      const failures: unknown[] = [];
      try {
        for (const [id, key] of ownedKeys) {
          try {
            assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            assert.ok(expectedBytes.has(id));
            assert.equal(key, `${prefix}${id}.txt`);
            assert.ok(cleanupClient);
            await cleanupClient.send(new DeleteObjectCommand({ Bucket: process.env.MINIO_BUCKET!, Key: key }));
          } catch (error) { failures.push(error); }
        }
      } finally {
        cleanupClient?.destroy();
        await prisma.$disconnect();
      }
      assert.equal(failures.length, 0, 'Every exact test-owned storage key must be cleaned; no listing or broad deletion is used');
    }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  cleanupClient = new S3Client({
    region: 'us-east-1', forcePathStyle: true,
    endpoint: `http://${process.env.MINIO_ENDPOINT === '::1' ? '[::1]' : process.env.MINIO_ENDPOINT}:${port}`,
    credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY!, secretAccessKey: process.env.MINIO_SECRET_KEY! },
  });
  const storage = app.get(StorageService);
  assert.equal(storage.getBucketName(), process.env.MINIO_BUCKET);
  const originalUpload = storage.uploadObject;
  const originalDownload = storage.downloadObject;
  let reads = 0;
  // Namespace adapter only: both calls below still use real loopback MinIO.
  // Original uploadId-based names identify every object, even on a DB failure.
  storage.uploadObject = async (params) => {
    const id = params.objectKey.slice(-40, -4);
    assert.ok(expectedBytes.has(id), 'Only this test uploads through the wrapper');
    assert.equal(params.contentType, 'text/plain');
    assert.deepEqual(params.body, expectedBytes.get(id));
    const key = `${prefix}${id}.txt`;
    ownedKeys.set(id, key); // Track before I/O, including uncertain failures.
    return originalUpload.call(storage, { ...params, objectKey: key });
  };
  storage.downloadObject = async (key) => {
    assert.ok([...ownedKeys.values()].includes(key), 'Never read an external/production storage object');
    reads += 1;
    return originalDownload.call(storage, key);
  };
  restoreStorage = () => { storage.uploadObject = originalUpload; storage.downloadObject = originalDownload; };
  const actorQuery = { where: { login: 'manager1' }, include: { roles: true, permissions: true } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const objects: Array<{ id: string }> = [];
  for (const label of ['A', 'B', 'hidden']) objects.push(await prisma.object.create({ data: {
    name: `${prefix}${label}`, address: 'Local file ACL fixture', status: 'active', createdByUserId: founder.id,
    ...(label === 'hidden' ? {} : { assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } } }),
  } }));
  const [a, b, hidden] = objects;
  const task = await prisma.task.create({ data: {
    title: `${prefix}hidden-task`, priority: 'normal', status: 'open', visibilityType: 'private',
    createdByUserId: founder.id, objectId: hidden.id,
  } });
  const order = await prisma.oneTimeOrder.create({ data: {
    title: `${prefix}hidden-order`, executionAddress: 'Local file fixture', status: 'new', contactName: 'Fixture', createdByUserId: founder.id,
  } });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1/files${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => { assert.equal(response.status, expected, await response.clone().text()); };
  const upload = (target: Target, auth = cookie, id: string = randomUUID()) => {
    const bytes = Buffer.from(`Tiny isolated text ${id}\n`);
    expectedBytes.set(id, bytes);
    const form = new FormData();
    form.set('entityType', target.entityType);
    form.set('entityId', target.entityId);
    form.set('uploadId', id);
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'text/plain' }), `${id}.txt`);
    return fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: auth }, body: form });
  };
  const targets: Target[] = [
    { entityType: 'object', entityId: a.id }, { entityType: 'object', entityId: b.id },
    { entityType: 'object', entityId: hidden.id }, { entityType: 'task', entityId: task.id },
    { entityType: 'one_time_order', entityId: order.id },
  ];
  const files: Uploaded[] = [];
  for (const target of targets) {
    const response = await upload(target, founderCookie);
    await status(response, 201);
    files.push(await response.json() as Uploaded);
  }
  const [fa, fb] = files;
  const capture = async () => {
    const [stored, attachments, derivatives, audit, objectRows, assignments, taskRow, orderRow] = await Promise.all([
      prisma.file.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileDerivative.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.objectAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id } }),
    ]);
    return { stored, attachments, derivatives, audit, objectRows, assignments, taskRow, orderRow, storageKeys: [...ownedKeys.values()].sort() };
  };
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, effect,
      scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [] } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403) => {
    const before = await capture(), readsBefore = reads;
    await status(await request(path, method, body), expected);
    assert.deepEqual(await capture(), before, 'Denied requests have no DB/audit/storage-write effects');
    assert.equal(reads, readsBefore, 'Authorization fails before MinIO content is fetched');
  };
  const deniedUpload = async (target: Target, id?: string) => {
    const before = await capture();
    await status(await upload(target, cookie, id), 403);
    assert.deepEqual(await capture(), before, 'Denied upload/replay creates no binary, metadata, attachment or audit');
  };
  const view = async (id: string) => {
    const before = await capture();
    const response = await request(`/${id}/view`);
    await status(response, 200);
    const result = await response.json() as FileViewResponseDto;
    assert.equal('bucket' in result || 'objectKey' in result || 'attachments' in result, false);
    assert.deepEqual(await capture(), before, 'Tiny text view does not create derivatives/jobs or mutate audit');
    return result;
  };
  const readable = async (file: Uploaded) => {
    const before = await capture();
    const metadata = await request(`/${file.id}`);
    await status(metadata, 200);
    const data = await metadata.json() as Uploaded;
    assert.equal(data.id, file.id);
    assert.equal(data.viewUrl, `/api/v1/files/${file.id}/view`);
    assert.equal(data.downloadUrl, `/api/v1/files/${file.id}/content?download=1`);
    assert.equal('bucket' in data || 'objectKey' in data || 'attachments' in data, false);
    const page = await view(file.id);
    assert.deepEqual(page.capabilities, { canPreview: true, canDownload: true, canRetryPreview: true });
    assert.equal(page.previewType, 'text');
    assert.equal(page.previewStatus, 'ready');
    assert.equal(page.thumbnailUrl, null);
    for (const suffix of ['/content', '/content?download=1', '/preview/content']) {
      const response = await request(`/${file.id}${suffix}`);
      await status(response, 200);
      assert.equal(await response.text(), expectedBytes.get(file.id)!.toString());
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('cache-control') ?? '', /^private/);
      if (suffix === '/preview/content') {
        assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
        assert.equal(response.headers.get('x-content-truncated'), '0');
      }
    }
    await status(await request(`/${file.id}/preview/retry`, 'POST', {}), 201);
    assert.deepEqual(await capture(), before, 'Text retry is an authorized no-op, not a queued conversion');
  };
  const blockAll = async (file: Uploaded) => {
    for (const suffix of ['', '/view', '/content', '/content?download=1', '/preview/content', '/thumbnail']) await rejected(`/${file.id}${suffix}`);
    await rejected(`/${file.id}/preview/retry`, 'POST', {});
  };

  for (const leaf of ['read', 'download', 'preview', 'preview.retry'] as const) {
    await t.test(`files.${leaf}: selected A deny/default/revoke and section gate keep B readable`, async (suite) => {
      suite.after(resetRules);
      await readable(fa);
      await readable(fb);
      const grant = await rule(`files.${leaf}`, 'allow', [fa.id]);
      await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
      if (leaf === 'read') {
        await blockAll(fa);
        const listed = await request(`/entity/object/${a.id}`);
        await status(listed, 200);
        assert.deepEqual(await listed.json(), []);
      } else {
        const page = await view(fa.id);
        const capability = leaf === 'download' ? 'canDownload' : leaf === 'preview' ? 'canPreview' : 'canRetryPreview';
        assert.equal(page.capabilities[capability], false);
        if (leaf === 'download') { await rejected(`/${fa.id}/content`); await rejected(`/${fa.id}/content?download=1`); }
        if (leaf === 'preview') {
          assert.equal(page.inlineContentUrl, null);
          assert.equal(page.thumbnailUrl, null);
          await rejected(`/${fa.id}/preview/content`);
          await rejected(`/${fa.id}/thumbnail`);
        }
        if (leaf === 'preview.retry') await rejected(`/${fa.id}/preview/retry`, 'POST', {});
      }
      await readable(fb);
      await removeRule(grant.id); // Default restores existing parent-authorized access.
      await readable(fa);
      await rule(`files.${leaf}`, 'allow', [fa.id]);
      const parent = await rule('files.access', 'deny', [fa.id]);
      await blockAll(fa);
      await readable(fb);
      await removeRule(parent.id);
      await readable(fa);
    });
  }

  await t.test('file leaf allows cannot open hidden object/task/order parents; source grants revoke in the original cookie', async (suite) => {
    suite.after(resetRules);
    for (const leaf of ['read', 'download', 'preview', 'preview.retry']) await rule(`files.${leaf}`, 'allow', files.slice(2).map(({ id }) => id));
    for (const [index, source] of [
      [2, { code: 'objects.read', id: hidden.id }], [3, { code: 'tasks.read', id: task.id }], [4, { code: 'one_time_orders.read', id: order.id }],
    ] as const) {
      await blockAll(files[index]);
      const grant = await rule(source.code, 'allow', [source.id]);
      await readable(files[index]);
      await removeRule(grant.id);
      await blockAll(files[index]);
    }
    await readable(fb);
  });

  await t.test('source read/materials/section denies override file allows; fixture assignment revocation is immediate', async (suite) => {
    suite.after(resetRules);
    for (const leaf of ['read', 'download', 'preview', 'preview.retry']) await rule(`files.${leaf}`, 'allow', [fa.id]);
    for (const code of ['objects.read', 'objects.materials.read', 'objects.access']) {
      const deny = await rule(code, 'deny', [a.id]);
      await blockAll(fa);
      await rejected(`/entity/object/${a.id}`);
      await readable(fb);
      await removeRule(deny.id);
    }
    const assignment = await prisma.objectAssignment.findFirstOrThrow({ where: { objectId: a.id, userId: actor.id } });
    await prisma.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
    try { await blockAll(fa); await readable(fb); }
    finally { await prisma.objectAssignment.update({ where: { id: assignment.id }, data: { isActive: true } }); }
    await readable(fa);
  });

  await t.test('global upload grant cannot grant source write; source A grant persists one tiny file/attachment/audit and replay is authorization-first', async (suite) => {
    suite.after(resetRules);
    const uploadGrant = await rule('files.upload', 'allow');
    await deniedUpload(targets[0]);
    await deniedUpload(targets[1]);
    await rule('objects.materials.manage', 'allow', [a.id]);
    const before = await capture();
    const response = await upload(targets[0]);
    await status(response, 201);
    const saved = await response.json() as Uploaded;
    const after = await capture();
    const row = after.stored.find(({ id }) => id === saved.id)!;
    assert.ok(row);
    assert.equal(row.uploadedByUserId, actor.id);
    assert.equal(row.objectKey, `${prefix}${saved.id}.txt`);
    assert.equal(row.mimeType, 'text/plain');
    assert.equal(row.sizeBytes, expectedBytes.get(saved.id)!.length);
    assert.deepEqual(after.stored.filter(({ id }) => id !== saved.id), before.stored);
    const attachment = after.attachments.filter(({ fileId }) => fileId === saved.id);
    assert.equal(attachment.length, 1);
    assert.equal(attachment[0].entityType, 'object');
    assert.equal(attachment[0].entityId, a.id);
    assert.equal(attachment[0].uploadedByUserId, actor.id);
    assert.deepEqual(after.attachments.filter(({ fileId }) => fileId !== saved.id), before.attachments);
    const audit = after.audit.filter((event) => !before.audit.some(({ id }) => id === event.id));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'file.attached');
    assert.equal(audit[0].entityId, a.id);
    assert.equal(audit[0].actorUserId, actor.id);
    assert.equal((audit[0].newValues as { fileId: string }).fileId, saved.id);
    assert.deepEqual(after.derivatives, before.derivatives);
    assert.deepEqual(after.objectRows, before.objectRows);
    assert.deepEqual(after.assignments, before.assignments);
    assert.deepEqual(after.taskRow, before.taskRow);
    assert.deepEqual(after.orderRow, before.orderRow);
    await readable(saved);
    await deniedUpload(targets[1]);
    await prisma.userAccessRule.update({ where: { id: uploadGrant.id }, data: { effect: 'deny' } });
    await deniedUpload(targets[0]);
    await deniedUpload(targets[0], saved.id);
    await removeRule(uploadGrant.id);
    const snapshot = await capture();
    await status(await upload(targets[0], cookie, saved.id), 201);
    assert.deepEqual(await capture(), snapshot, 'Default-authorized replay adds no binary, row, attachment or audit');
    const parent = await rule('files.access', 'deny');
    await deniedUpload(targets[0]);
    await deniedUpload(targets[0], saved.id);
    await removeRule(parent.id);
    const sourceDeny = await rule('objects.access', 'deny', [a.id]);
    await deniedUpload(targets[0], saved.id);
    await removeRule(sourceDeny.id);
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor);
  assert.equal(await prisma.fileDerivative.count({ where: { fileId: { in: [...expectedBytes.keys()] } } }), 0);
  // Real storage is used. Text retry intentionally creates no conversion job;
  // thumbnail generation, office conversion and unsupported detach are excluded.
});
