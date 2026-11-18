import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import type { FileViewResponseDto } from '../src/modules/files/dto/file-view-response.dto';
import { FilePreviewService } from '../src/modules/files/file-preview.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import type { RedisService } from '../src/modules/redis/redis.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessScope } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Job = { fileId: string; derivativeType: 'image_thumbnail' };
type Stored = { body: Buffer; contentType: string; contentLength: number };
type FixtureFile = { id: string; objectKey: string; originalName: string };
const leaves = ['files.access', 'files.read', 'files.preview', 'files.download', 'files.preview.retry'];
const scopes: AccessScope[] = ['own', 'assigned', 'selected', 'all'];

// Real HTTP/auth/FilesService/Prisma/preview state machine and Sharp conversion.
// Only storage and the preview Redis adapter are in-memory. The actual worker
// processJob is driven explicitly, not a fake ready-row insert or a running
// Redis worker. Upload, MinIO durability, queue delivery and office conversion
// are not certified by this test. Other AppModule dependencies use main's harness.
test('file derivative authorization survives pending jobs, scope denies and live regrants', { timeout: 240_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
  assert.equal(db.port, '55432');
  assert.match(db.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const redis = new URL(process.env.REDIS_URL!);
  assert.equal(redis.protocol, 'redis:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname), 'AppModule dependencies must use loopback Redis');
  assert.match(process.env.FILE_PREVIEW_QUEUE_NAME ?? '', /:integration:\d+:\d+$/);
  for (const code of leaves) assert.deepEqual(ACCESS_ACTION_CATALOG.find((entry) => entry.code === code)?.allowedScopes, scopes);

  const prisma = new PrismaClient();
  const marker = `derivative-acl-${randomUUID()}`;
  const bucket = `${marker}-controlled-storage`;
  const stored = new Map<string, Stored>();
  const ownedFileIds = new Set<string>();
  const derivativeKeys = new Map<string, string>();
  const locks = new Set<string>();
  const jobs: Job[] = [];
  const storageCalls: string[] = [];
  const queueCalls: string[] = [];
  let failNextRead = false;
  let pauseNextRead: (() => Promise<void>) | undefined;
  const assertOwnedKey = (key: string) => assert.ok(derivativeKeys.has(key) || [...ownedFileIds].some((id) => key === `${marker}/${id}.png`), 'No non-fixture storage access');
  const storage = {
    getBucketName: () => bucket,
    uploadObject: async (params: Parameters<StorageService['uploadObject']>[0]) => {
      const parts = params.objectKey.split('/');
      assert.equal(parts.length, 4); assert.equal(parts[0], 'derivatives');
      assert.ok(ownedFileIds.has(parts[1]), 'Derivative belongs to an owned fixture file');
      assert.match(parts[2], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(parts[3], 'thumbnail.webp');
      derivativeKeys.set(params.objectKey, parts[1]);
      assert.equal(params.body.length, params.contentLength);
      storageCalls.push(`write:${params.objectKey}`);
      stored.set(params.objectKey, { body: Buffer.from(params.body), contentType: params.contentType, contentLength: params.contentLength });
      return { bucket, objectKey: params.objectKey };
    },
    downloadObject: async (key: string) => {
      assertOwnedKey(key);
      storageCalls.push(`read:${key}`);
      if (failNextRead) { failNextRead = false; throw new Error('Controlled derivative read failure'); }
      const value = stored.get(key);
      assert.ok(value, 'Only actual controlled storage bytes may be served');
      const pause = pauseNextRead;
      pauseNextRead = undefined;
      await pause?.();
      return { ...value, body: Buffer.from(value.body) };
    },
    deleteObject: async (key: string) => {
      assert.ok(derivativeKeys.has(key), 'Cleanup may delete only a registered owned generation key');
      storageCalls.push(`delete:${key}`); stored.delete(key);
    },
    buildObjectUrl: () => { throw new Error('A file response must not build a public/signed storage URL'); },
  } satisfies Pick<StorageService, 'getBucketName' | 'uploadObject' | 'downloadObject' | 'deleteObject' | 'buildObjectUrl'>;
  const queueClient = {
    del: async (key: string) => { queueCalls.push(`del:${key}`); return Number(locks.delete(key)); },
    eval: async (script: string, options: { keys: string[]; arguments: string[] }) => {
      // This adapter supports exactly the production atomic enqueue script,
      // not arbitrary Lua. Its owned queue is always absent or an array/list.
      assert.equal(script.replace(/\s+/g, ' ').trim(), `
        local queueType = redis.call('TYPE', KEYS[2]).ok
        if queueType ~= 'none' and queueType ~= 'list' then
          return redis.error_reply('File preview queue is not a list')
        end
        if redis.call('SET', KEYS[1], '1', 'NX', 'EX', 600) then
          redis.call('RPUSH', KEYS[2], ARGV[1])
          return 1
        end
        return 0
      `.replace(/\s+/g, ' ').trim());
      assert.equal(options.keys.length, 2); assert.equal(options.arguments.length, 1);
      const [lockKey, name] = options.keys;
      assert.equal(name, process.env.FILE_PREVIEW_QUEUE_NAME);
      const job = JSON.parse(options.arguments[0]) as Job;
      assert.ok(ownedFileIds.has(job.fileId)); assert.equal(job.derivativeType, 'image_thumbnail');
      assert.equal(lockKey, `service-ops:file-preview:queued:${job.fileId}:${job.derivativeType}`);
      queueCalls.push(`eval:${job.fileId}`);
      // No await between reservation and append: concurrent callers observe
      // the same winner, matching SET NX + RPUSH in one Redis operation.
      if (locks.has(lockKey)) return 0;
      locks.add(lockKey); jobs.push(job); return 1;
    },
  };
  // Narrow controlled adapter for only the methods the real preview service
  // uses. Do not override RedisService globally (auth/outbox still use real Redis).
  const previewRedis = { getClient: () => queueClient } as unknown as RedisService;
  const ruleIds = new Set<string>();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); }
    finally {
      try { await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } }); }
      finally { stored.clear(); derivativeKeys.clear(); jobs.length = 0; locks.clear(); await prisma.$disconnect(); }
    }
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService).useValue(storage)
    .overrideProvider(FilePreviewService).useFactory({
      inject: [PrismaService, ConfigService],
      factory: (database: PrismaService, config: ConfigService) => {
        const preview = new FilePreviewService(database, previewRedis, storage as unknown as StorageService, config);
        // Disable only automatic startup recovery/worker; real ensure/retry and
        // processJob remain untouched, so the barrier is deterministic.
        preview.onModuleInit = async () => {};
        return preview;
      },
    }).compile();
  const app = moduleRef.createNestApplication();
  closeApp = () => app.close();
  await configureApp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const preview = app.get(FilePreviewService);
  const runJob = async (fileId: string) => {
    const job = jobs.shift();
    assert.ok(job); assert.equal(job.fileId, fileId);
    // Explicit private worker seam, kept test-local; no runtime API is added.
    const processJob = Reflect.get(preview, 'processJob') as (job: Job) => Promise<void>;
    assert.equal(typeof processJob, 'function');
    await processJob.call(preview, job);
    const outcome = await prisma.fileDerivative.findFirst({ where: { fileId }, select: { status: true, errorMessage: true } });
    if (outcome?.status === 'failed') t.diagnostic(JSON.stringify({ phase: 'actual-worker-failure', fileId, errorMessage: outcome.errorMessage }));
  };
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: managerRole.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const rule = async (actionCode: string, effect: 'allow' | 'deny', scope: AccessScope = 'all', selectedIds: string[] = []) => {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode);
    assert.equal(definition?.manageable, true); assert.ok(definition?.allowedScopes.includes(scope));
    assert.equal(selectedIds.length > 0, scope === 'selected');
    const saved = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
    ruleIds.add(saved.id);
  };
  const clear = async (actionCode: string) => {
    const rows = await prisma.userAccessRule.findMany({ where: { userId: actor.id, actionCode } });
    for (const row of rows) { assert.ok(ruleIds.has(row.id)); await prisma.userAccessRule.delete({ where: { id: row.id } }); ruleIds.delete(row.id); }
  };
  const objects: Array<{ id: string }> = [];
  for (const label of ['assigned-A', 'read-only-B', 'hidden-C']) objects.push(await prisma.object.create({ data: {
    name: `${marker}-${label}`, address: 'Isolated synthetic file source', status: 'active', createdByUserId: founder.id,
    ...(label === 'assigned-A' ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } }));
  const [a, b, c] = objects;
  await rule('objects.read', 'allow', 'selected', [b.id]);
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#21618c' } }).png().toBuffer();
  const seedFile = async (objectId: string, uploader = founder.id): Promise<FixtureFile> => {
    const id: string = randomUUID();
    ownedFileIds.add(id);
    const objectKey = `${marker}/${id}.png`;
    const file = await prisma.file.create({ data: {
      id, bucket, objectKey, originalName: `${id}.png`, mimeType: 'image/png', sizeBytes: png.length, uploadedByUserId: uploader,
      attachments: { create: { entityType: 'object', entityId: objectId, uploadedByUserId: uploader } },
    } });
    stored.set(objectKey, { body: Buffer.from(png), contentType: 'image/png', contentLength: png.length });
    return file;
  };
  const ownA = await seedFile(a.id, actor.id), foreignA = await seedFile(a.id), foreignB = await seedFile(b.id);
  const hiddenC = await seedFile(c.id);
  const visible = [ownA, foreignA, foreignB];
  const request = (file: FixtureFile, suffix: string, method = 'GET') => fetch(`${baseUrl}/api/v1/files/${file.id}${suffix}`, {
    method, redirect: 'error', headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    const text = await response.text(); assert.equal(response.status, expected, text); return JSON.parse(text) as T;
  };
  const safeView = (file: FixtureFile, view: FileViewResponseDto) => {
    assert.deepEqual(Object.keys(view).sort(), ['id', 'originalName', 'mimeType', 'sizeBytes', 'previewType', 'previewStatus', 'thumbnailUrl', 'inlineContentUrl', 'downloadUrl', 'errorMessage', 'capabilities'].sort());
    assert.equal(view.id, file.id);
    for (const value of [view.thumbnailUrl, view.inlineContentUrl, view.downloadUrl]) if (value !== null) assert.ok(value.startsWith(`/api/v1/files/${file.id}/`));
    const serialized = JSON.stringify(view);
    for (const secret of [bucket, file.objectKey, `derivatives/${file.id}/`, 'X-Amz-', 'https://', 'http://']) assert.equal(serialized.includes(secret), false);
  };
  const view = async (file: FixtureFile, expected = 200) => {
    const dto = await json<FileViewResponseDto>(await request(file, '/view'), expected); safeView(file, dto); return dto;
  };
  const capture = async () => ({
    files: await prisma.file.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    derivatives: await prisma.fileDerivative.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    storage: [...stored].sort(([x], [y]) => x.localeCompare(y)).map(([key, value]) => [key, value.contentType, value.body.toString('hex')]),
    jobs: jobs.map((job) => ({ ...job })), locks: [...locks].sort(),
  });
  const forbidden = async (file: FixtureFile, suffix: string, method = 'GET') => {
    const before = await capture(), reads = storageCalls.length, queued = queueCalls.length;
    const response = await request(file, suffix, method);
    const text = await response.text(); assert.equal(response.status, 403, text);
    for (const secret of [bucket, file.objectKey, file.originalName, `derivatives/${file.id}/`, 'X-Amz-', 'http://', 'https://']) assert.equal(text.includes(secret), false);
    assert.equal(response.headers.get('location'), null);
    assert.equal(storageCalls.length, reads, 'Deny precedes original/derivative storage I/O');
    assert.equal(queueCalls.length, queued, 'Deny precedes any queue operation, not merely job creation');
    assert.deepEqual(await capture(), before, 'Denied access must preserve rows, audit, source facts, binary bytes and pending jobs');
  };
  const blockAll = async (file: FixtureFile) => {
    for (const suffix of ['', '/view', '/thumbnail', '/preview/content', '/content?download=1']) await forbidden(file, suffix);
    await forbidden(file, '/preview/retry', 'POST');
  };
  const bytes = async (file: FixtureFile, suffix: string) => {
    const response = await request(file, suffix);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), suffix === '/thumbnail' ? 'image/webp' : 'image/png');
    assert.match(response.headers.get('cache-control') ?? '', /^private, no-store$/);
    assert.equal(response.headers.get('location'), null);
    const body = Buffer.from(await response.arrayBuffer());
    const derivative = suffix === '/thumbnail'
      ? await prisma.fileDerivative.findUniqueOrThrow({ where: { fileId_derivativeType: { fileId: file.id, derivativeType: 'image_thumbnail' } } })
      : null;
    const key = derivative?.objectKey ?? file.objectKey;
    if (derivative) {
      assert.ok(derivative.objectKey && derivativeKeys.has(derivative.objectKey));
      assert.equal(derivativeKeys.get(derivative.objectKey), file.id, 'Served generation belongs to this exact file');
    }
    assert.deepEqual(body, stored.get(key)!.body);
  };
  const ready = async (file: FixtureFile) => {
    const pending = await view(file); assert.equal(pending.previewStatus, 'pending'); assert.equal(pending.thumbnailUrl, null);
    assert.equal(jobs.length, 1); await runJob(file.id);
    const derivative = await prisma.fileDerivative.findFirstOrThrow({ where: { fileId: file.id } });
    assert.equal(derivative.status, 'ready'); assert.equal(derivative.attemptCount, 1);
    assert.equal(derivative.width, 3); assert.equal(derivative.height, 2);
    assert.ok(derivative.objectKey && derivativeKeys.has(derivative.objectKey), 'Ready row references an actually uploaded owned generation');
    assert.equal(derivativeKeys.get(derivative.objectKey), file.id, 'Ready generation belongs to this exact file');
    assert.notEqual(derivative.objectKey, file.objectKey, 'Derivative never overwrites original bytes');
    assert.equal((await sharp(stored.get(derivative.objectKey!)!.body).metadata()).format, 'webp');
    assert.equal((await view(file)).previewStatus, 'ready'); await bytes(file, '/thumbnail');
  };

  await t.test('download revoked while storage is pending returns no original bytes', async () => {
    let entered!: () => void;
    let release!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    const storageReady = new Promise<void>((resolve) => { release = resolve; });
    pauseNextRead = async () => { entered(); await storageReady; };
    const pending = request(ownA, '/content?download=1');
    try {
      await Promise.race([reading, pending.then((response) => {
        throw new Error(`Download returned ${response.status} before reaching storage`);
      })]);
      await rule('files.download', 'deny', 'selected', [ownA.id]);
      release();
      const response = await pending;
      assert.equal(response.status, 403, await response.text());
      assert.equal(response.headers.get('content-disposition'), null);
    } finally {
      release();
      await clear('files.download');
    }
    await bytes(ownA, '/content?download=1');
  });

  await t.test('concurrent first views share one preview row and one job', async () => {
    const file = await seedFile(a.id, actor.id);
    const views = await Promise.all(Array.from({ length: 16 }, () => view(file)));
    assert.ok(views.every((result) => result.previewStatus === 'pending'));
    assert.equal(await prisma.fileDerivative.count({ where: { fileId: file.id } }), 1);
    assert.equal(jobs.length, 1);
    const lockKey = `service-ops:file-preview:queued:${file.id}:image_thumbnail`;
    assert.equal(locks.has(lockKey), true);
    await runJob(file.id);
    assert.equal(locks.has(lockKey), false, 'Actual worker releases the queued reservation');
    assert.equal((await view(file)).previewStatus, 'ready');
  });

  await t.test('real image jobs produce private derivative bytes, not synthetic ready metadata', async () => {
    for (const file of visible) { await ready(file); await bytes(file, '/preview/content'); await bytes(file, '/content?download=1'); }
    assert.equal(jobs.length, 0);
  });

  for (const scope of scopes) await t.test(`${scope}: derivative leaves stay independent from uploader/source assignment and control files`, async () => {
    const ids = scope === 'selected' ? [foreignA.id] : [];
    const matches = (file: FixtureFile) => scope === 'all' || (scope === 'own' ? file.id === ownA.id : scope === 'assigned' ? [ownA.id, foreignA.id].includes(file.id) : file.id === foreignA.id);
    for (const code of leaves) {
      await rule(code, 'allow', scope, ids); // Additive over the real source-readable baseline, not invented authority.
      for (const file of visible) assert.equal((await view(file)).capabilities.canPreview, true);
      await rule(code, 'deny', scope, ids);
      for (const file of visible) {
        if (matches(file) && ['files.access', 'files.read'].includes(code)) { await blockAll(file); continue; }
        const dto = await view(file);
        assert.deepEqual(dto.capabilities, {
          canPreview: !(matches(file) && code === 'files.preview'),
          canDownload: !(matches(file) && code === 'files.download'),
          canRetryPreview: !(matches(file) && code === 'files.preview.retry'),
        });
        if (matches(file) && code === 'files.preview') {
          assert.equal(dto.thumbnailUrl, null); assert.equal(dto.inlineContentUrl, null); assert.equal(dto.previewStatus, 'failed');
          assert.equal(dto.errorMessage, 'Предпросмотр ограничен настройками доступа.');
          await forbidden(file, '/thumbnail'); await forbidden(file, '/preview/content'); await bytes(file, '/content?download=1');
        } else { await bytes(file, '/thumbnail'); await bytes(file, '/preview/content'); }
        if (matches(file) && code === 'files.download') await forbidden(file, '/content?download=1');
        else await bytes(file, '/content?download=1');
        if (matches(file) && code === 'files.preview.retry') await forbidden(file, '/preview/retry', 'POST');
        else await json(await request(file, '/preview/retry', 'POST'), 201);
      }
      await clear(code); // Revoke returns to parent-authorized baseline in the same cookie.
      for (const file of visible) { assert.equal((await view(file)).previewStatus, 'ready'); await bytes(file, '/thumbnail'); }
    }
    assert.equal(jobs.length, 0, 'Ready retries must not queue duplicate conversion');
  });

  await t.test('file allows never bypass hidden source or explicit parent read/materials/access deny', async () => {
    for (const code of leaves) await rule(code, 'allow');
    await blockAll(hiddenC);
    assert.equal(await prisma.fileDerivative.count({ where: { fileId: hiddenC.id } }), 0);
    for (const code of ['objects.read', 'objects.materials.read', 'objects.access']) {
      await rule(code, 'deny', 'selected', [a.id]);
      await blockAll(ownA); await blockAll(foreignA);
      // One rule per user/action: a read deny replaces B's selected read allow.
      // Do not pretend that B remains readable without its independent grant.
      if (code === 'objects.read') await blockAll(foreignB);
      else await bytes(foreignB, '/thumbnail');
      await clear(code);
      if (code === 'objects.read') await rule('objects.read', 'allow', 'selected', [b.id]);
      await bytes(foreignB, '/thumbnail');
    }
    // Restore the original positive read-only B context after the parent-read probe.
    await rule('objects.read', 'allow', 'selected', [b.id]);
    for (const code of leaves) await clear(code);
  });

  await t.test('revoke while queued and completion while denied cannot expose derivative; regrant uses the same job/result', async () => {
    const file = await seedFile(a.id, actor.id);
    assert.equal((await view(file)).previewStatus, 'pending'); assert.equal(jobs.length, 1);
    await rule('files.access', 'deny', 'selected', [file.id]);
    await blockAll(file);
    await clear('files.access');
    assert.equal((await view(file)).previewStatus, 'pending');
    assert.equal(jobs.length, 1, 'Pending regrant must reuse the existing queued job');
    await rule('files.access', 'deny', 'selected', [file.id]);
    await runJob(file.id); // Actual image worker may finish independently of recipient ACL.
    assert.equal((await prisma.fileDerivative.findFirstOrThrow({ where: { fileId: file.id } })).status, 'ready');
    await blockAll(file);
    await clear('files.access');
    const before = await capture();
    assert.equal((await view(file)).previewStatus, 'ready'); await bytes(file, '/thumbnail');
    assert.deepEqual(await capture(), before, 'Regrant serves the existing result, not a second derivative/job');
  });

  await t.test('failed actual job: denied retry has zero effects; authorized retry resets and completes one real job', async () => {
    const file = await seedFile(a.id, actor.id);
    await view(file); failNextRead = true; await runJob(file.id);
    const failed = await prisma.fileDerivative.findFirstOrThrow({ where: { fileId: file.id } });
    assert.equal(failed.status, 'failed'); assert.equal(failed.attemptCount, 1);
    assert.equal(failed.errorMessage, 'Controlled derivative read failure');
    for (const code of ['files.preview.retry', 'files.read', 'files.access', 'objects.read']) {
      await rule(code, 'deny', 'selected', [code.startsWith('objects.') ? a.id : file.id]);
      await forbidden(file, '/preview/retry', 'POST'); await clear(code);
    }
    await rule('objects.read', 'allow', 'selected', [b.id]);
    await rule('files.preview', 'deny', 'selected', [file.id]);
    const redacted = await view(file);
    assert.equal(redacted.errorMessage, 'Предпросмотр ограничен настройками доступа.');
    assert.equal(redacted.thumbnailUrl, null); assert.equal(redacted.inlineContentUrl, null);
    await bytes(file, '/content?download=1');
    // Retry is an independent leaf: it may enqueue while preview itself is denied.
    const retried = await json<FileViewResponseDto>(await request(file, '/preview/retry', 'POST'), 201);
    safeView(file, retried); assert.equal(retried.capabilities.canPreview, false); assert.equal(jobs.length, 1);
    const pending = await prisma.fileDerivative.findUniqueOrThrow({ where: { id: failed.id } });
    assert.equal(pending.status, 'pending'); assert.equal(pending.attemptCount, 0); assert.equal(pending.errorMessage, null);
    await forbidden(file, '/thumbnail');
    await clear('files.preview');
    assert.equal((await view(file)).previewStatus, 'pending'); assert.equal(jobs.length, 1);
    await runJob(file.id); assert.equal((await view(file)).previewStatus, 'ready'); await bytes(file, '/thumbnail');
    const finished = await prisma.fileDerivative.findUniqueOrThrow({ where: { id: failed.id } });
    assert.equal(finished.attemptCount, 1); assert.equal(finished.processingStartedAt, null); assert.ok(finished.lastAttemptAt);
    assert.equal(await prisma.fileDerivative.count({ where: { fileId: file.id } }), 1);
    const before = await capture();
    await json(await request(file, '/preview/retry', 'POST'), 201);
    assert.deepEqual(await capture(), before, 'Ready retry neither resets state nor creates another job');
  });
  // Main owns isolated-schema teardown. No real MinIO, Redis queue delivery,
  // LibreOffice, browser, realtime or production/storage durability claim.
});
