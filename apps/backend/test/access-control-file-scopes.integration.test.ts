import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

import type { MeResponseDto } from '../src/modules/auth/dto/me-response.dto';
import type { FileViewResponseDto } from '../src/modules/files/dto/file-view-response.dto';
import { StorageService } from '../src/modules/storage/storage.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessChange, AccessScope } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Uploaded = { id: string; originalName: string; mimeType: string; sizeBytes: number; viewUrl: string; downloadUrl: string };
type FileAction = 'access' | 'read' | 'download' | 'preview' | 'preview.retry';
const scopedActions: FileAction[] = ['access', 'read', 'download', 'preview', 'preview.retry'];
const scopes: AccessScope[] = ['own', 'assigned', 'selected', 'all'];

// Scope/source composition only: file leaves use legacyAllowed=true. Personal
// allow is observed, NOT represented as widening an invented forbidden role.
// Founder uses real preview/save/default; no direct userAccessRule mutations.
// Tiny text retry is an authorized no-op, NOT derivative/worker/race coverage.
test('file scopes use real admin preview/save and uploader/source facts in the original recipient cookie', { timeout: 360_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
  assert.equal(db.port, '55432');
  const schema = db.searchParams.get('schema') ?? '';
  assert.match(schema, /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  const storagePort = Number(process.env.MINIO_PORT);
  assert.ok(Number.isInteger(storagePort) && storagePort > 0 && storagePort <= 65535);
  assert.ok(process.env.MINIO_BUCKET && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);
  assert.match(process.env.FILE_PREVIEW_QUEUE_NAME ?? '', /:integration:\d+:\d+$/);
  for (const leaf of scopedActions) {
    const action = ACCESS_ACTION_CATALOG.find(({ code }) => code === `files.${leaf}`);
    assert.equal(action?.manageable, true);
    assert.deepEqual(action?.allowedScopes, scopes);
  }
  assert.deepEqual(ACCESS_ACTION_CATALOG.find(({ code }) => code === 'files.upload')?.allowedScopes, ['all']);

  const prefix = `integration/${schema}/file-scopes-${randomUUID()}/`;
  const expectedBytes = new Map<string, Buffer>();
  const ownedKeys = new Map<string, string>();
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreStorage: (() => void) | undefined = undefined;
  let cleanupClient: S3Client | undefined = undefined;
  t.after(async () => {
    try { restoreStorage?.(); await closeApp?.(); }
    finally {
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
      } finally { cleanupClient?.destroy(); await prisma.$disconnect(); }
      assert.equal(failures.length, 0, 'Clean only exact namespaced keys, including uncertain upload failures; never list/delete a bucket');
    }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  cleanupClient = new S3Client({ region: 'us-east-1', forcePathStyle: true,
    endpoint: `http://${process.env.MINIO_ENDPOINT === '::1' ? '[::1]' : process.env.MINIO_ENDPOINT}:${storagePort}`,
    credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY!, secretAccessKey: process.env.MINIO_SECRET_KEY! } });
  const storage = app.get(StorageService);
  assert.equal(storage.getBucketName(), process.env.MINIO_BUCKET);
  const originalUpload = storage.uploadObject;
  const originalDownload = storage.downloadObject;
  let reads = 0;
  storage.uploadObject = async (params) => {
    const id = params.objectKey.slice(-40, -4);
    assert.ok(expectedBytes.has(id), 'Namespace only this test\'s real tiny uploads');
    assert.equal(params.contentType, 'text/plain');
    assert.deepEqual(params.body, expectedBytes.get(id));
    const key = `${prefix}${id}.txt`;
    ownedKeys.set(id, key);
    return originalUpload.call(storage, { ...params, objectKey: key });
  };
  storage.downloadObject = async (key) => {
    assert.ok([...ownedKeys.values()].includes(key));
    reads += 1;
    return originalDownload.call(storage, key);
  };
  restoreStorage = () => { storage.uploadObject = originalUpload; storage.downloadObject = originalDownload; };

  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const identities = () => prisma.user.findMany({ where: { id: { in: [actor.id, founder.id] } },
    select: { id: true, login: true, isActive: true, roles: { orderBy: { roleId: 'asc' }, select: { roleId: true, role: { select: { code: true } } } },
      permissions: { orderBy: { permissionId: 'asc' }, select: { permissionId: true } } }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  assert.deepEqual(originalIdentities.find(({ id }) => id === actor.id)!.roles.map(({ role }) => role.code), ['manager']);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  // Never replace these cookies after a grant/default/revoke.
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, redirect: 'error', headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const objects: Array<{ id: string }> = [];
  for (const label of ['assigned-A', 'read-granted-B', 'hidden-C']) objects.push(await prisma.object.create({ data: {
    name: `${prefix}${label}`, address: 'Synthetic isolated scope fixture', status: 'active', createdByUserId: founder.id,
    ...(label === 'assigned-A' ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } }));
  const [a, b, c] = objects;
  const upload = (objectId: string, session = cookie, id: string = randomUUID()) => {
    const bytes = Buffer.from(`Isolated file scope ${id}\n`);
    expectedBytes.set(id, bytes);
    const form = new FormData();
    form.set('entityType', 'object'); form.set('entityId', objectId); form.set('uploadId', id);
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'text/plain' }), `${id}.txt`);
    return fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', redirect: 'error', headers: { Cookie: session }, body: form, signal: AbortSignal.timeout(25_000) });
  };
  const capture = async () => ({
    files: await prisma.file.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    derivatives: await prisma.fileDerivative.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    identities: await identities(), storageKeys: [...ownedKeys.values()].sort(),
  });
  const accessState = async () => ({
    version: (await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { accessVersion: true } })).accessVersion,
    rules: await prisma.userAccessRule.findMany({ where: { userId: actor.id }, select: { actionCode: true, effect: true, scope: true, selectedIds: true }, orderBy: { actionCode: 'asc' } }),
    audit: await prisma.userAccessAudit.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    previews: await prisma.userAccessPreview.findMany({ where: { userId: actor.id }, select: { id: true, actorUserId: true, userId: true, expectedVersion: true, usedAt: true }, orderBy: { id: 'asc' } }),
  });
  const change = (actionCode: string, effect: AccessChange['effect'], scope: AccessScope = 'all', selectedIds: string[] = []): AccessChange => {
    const definition = ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode);
    assert.equal(definition?.manageable, true, actionCode);
    assert.ok(definition?.allowedScopes.includes(scope), `${actionCode}/${scope}`);
    assert.equal(selectedIds.length > 0, scope === 'selected');
    return { actionCode, effect, scope, ...(scope === 'selected' ? { selectedIds: [...selectedIds].sort() } : {}) };
  };
  const admin = async (changes: AccessChange[]) => {
    assert.equal(new Set(changes.map(({ actionCode }) => actionCode)).size, changes.length);
    const before = await capture(), accessBefore = await accessState();
    const normalized = [...changes].sort((x, y) => x.actionCode.localeCompare(y.actionCode)).map((entry) => ({ ...entry, selectedIds: entry.selectedIds ?? [] }));
    const payload = { expectedVersion: accessBefore.version, reason: `${prefix} explicit scope acceptance`, changes };
    const endpoint = `/users-access/admin/users/${actor.id}`;
    const preview = await json<{ previewToken: string; previewHash: string; changes: AccessChange[] }>(await request(`${endpoint}/preview`, 'POST', payload, founderCookie), 201);
    assert.deepEqual(preview.changes, normalized);
    assert.deepEqual(await capture(), before, 'Preview cannot alter any business row, ownership, assignment, storage or event');
    const saved = await json<{ accessVersion: number }>(await request(`${endpoint}/save`, 'POST', { ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash }, founderCookie), 201);
    assert.equal(saved.accessVersion, accessBefore.version + 1);
    assert.deepEqual(await capture(), before, 'Admin mutation has only its explicit ACL effects; no business/ownership/assignment fabrication');
    const after = await accessState();
    assert.equal(after.version, saved.accessVersion);
    const expected = new Map(accessBefore.rules.map((entry) => [entry.actionCode, entry]));
    for (const entry of normalized) {
      if (entry.effect === 'default') expected.delete(entry.actionCode);
      else expected.set(entry.actionCode, { ...entry });
    }
    assert.deepEqual(after.rules, [...expected.values()].sort((x, y) => x.actionCode.localeCompare(y.actionCode)));
    const audits = after.audit.filter((entry) => !accessBefore.audit.some(({ id }) => id === entry.id));
    assert.equal(audits.length, 1, 'Exactly one real administrative audit, not an ignored audit prefix');
    assert.deepEqual(after.audit.filter((entry) => accessBefore.audit.some(({ id }) => id === entry.id)), accessBefore.audit, 'Previous admin audits remain immutable');
    assert.equal(audits[0].actorUserId, founder.id); assert.equal(audits[0].userId, actor.id);
    assert.equal(audits[0].versionBefore, accessBefore.version); assert.equal(audits[0].versionAfter, saved.accessVersion);
    assert.equal(audits[0].reason, payload.reason); assert.deepEqual(audits[0].changes, normalized);
    assert.deepEqual(audits[0].before, accessBefore.rules); assert.deepEqual(audits[0].after, after.rules);
    assert.equal(audits[0].previewHash, preview.previewHash);
    const previews = after.previews.filter((entry) => !accessBefore.previews.some(({ id }) => id === entry.id));
    assert.deepEqual(after.previews.filter((entry) => accessBefore.previews.some(({ id }) => id === entry.id)), accessBefore.previews);
    assert.equal(previews.length, 1); assert.equal(previews[0].actorUserId, founder.id);
    assert.equal(previews[0].userId, actor.id); assert.equal(previews[0].expectedVersion, accessBefore.version);
    assert.ok(previews[0].usedAt, 'The exact founder preview is consumed');
  };
  // Read B without assignment; writing A is an independent leaf, not inferred
  // from source assignment or any file grant. C receives no source grant.
  await admin([change('objects.read', 'allow', 'selected', [b.id]), change('objects.materials.manage', 'allow', 'selected', [a.id])]);
  const ownA = await json<Uploaded>(await upload(a.id), 201);
  const founderA = await json<Uploaded>(await upload(a.id, founderCookie), 201);
  const founderB = await json<Uploaded>(await upload(b.id, founderCookie), 201);
  const hiddenC = await json<Uploaded>(await upload(c.id, founderCookie), 201);
  const visible = [ownA, founderA, founderB];
  const initialFacts = await capture();
  assert.equal(initialFacts.files.find(({ id }) => id === ownA.id)!.uploadedByUserId, actor.id);
  for (const file of [founderA, founderB, hiddenC]) assert.equal(initialFacts.files.find(({ id }) => id === file.id)!.uploadedByUserId, founder.id);
  assert.deepEqual(initialFacts.assignments.map(({ objectId, userId }) => ({ objectId, userId })), [{ objectId: a.id, userId: actor.id }]);
  assert.equal(initialFacts.objects.find(({ id }) => id === a.id)!.createdByUserId, founder.id, 'File uploader ownership is not target-object ownership');

  const exactStatus = async (response: Response, expected: number) => { assert.equal(response.status, expected, await response.clone().text()); };
  const deniedRead = async (path: string, method = 'GET') => {
    const previousReads = reads;
    await exactStatus(await request(`/files${path}`, method, method === 'POST' ? {} : undefined), 403);
    assert.equal(reads, previousReads, 'Denied file access never fetches MinIO bytes');
  };
  const bytes = async (file: Uploaded, suffix: string) => {
    const response = await request(`/files/${file.id}${suffix}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(await response.text(), expectedBytes.get(file.id)!.toString());
  };
  const checkFile = async (file: Uploaded, leaf: FileAction, denied: boolean) => {
    if (denied && (leaf === 'access' || leaf === 'read')) {
      for (const suffix of ['', '/view', '/content?download=1', '/preview/content', '/thumbnail']) await deniedRead(`/${file.id}${suffix}`);
      await deniedRead(`/${file.id}/preview/retry`, 'POST');
      return;
    }
    const metadata = await json<Uploaded>(await request(`/files/${file.id}`));
    assert.equal(metadata.id, file.id);
    assert.equal('bucket' in metadata || 'objectKey' in metadata || 'attachments' in metadata, false);
    const view = await json<FileViewResponseDto>(await request(`/files/${file.id}/view`));
    assert.deepEqual(view.capabilities, { canPreview: !(denied && leaf === 'preview'), canDownload: !(denied && leaf === 'download'), canRetryPreview: !(denied && leaf === 'preview.retry') });
    assert.equal(view.thumbnailUrl, null, 'Tiny text has no thumbnail derivative');
    if (denied && leaf === 'preview') {
      assert.equal(view.inlineContentUrl, null);
      await deniedRead(`/${file.id}/preview/content`);
      await bytes(file, '/content?download=1');
    } else if (denied && leaf === 'download') {
      await deniedRead(`/${file.id}/content`); await deniedRead(`/${file.id}/content?download=1`);
      await bytes(file, '/preview/content');
    } else if (leaf === 'preview.retry') {
      if (denied) await deniedRead(`/${file.id}/preview/retry`, 'POST');
      else await json<FileViewResponseDto>(await request(`/files/${file.id}/preview/retry`, 'POST', {}), 201);
      await bytes(file, '/content?download=1');
    } else await bytes(file, leaf === 'preview' ? '/preview/content' : '/content?download=1');
  };
  const matches = (scope: AccessScope, file: Uploaded) => scope === 'all' ||
    (scope === 'own' ? file.id === ownA.id : scope === 'assigned' ? [ownA.id, founderA.id].includes(file.id) : file.id === founderA.id);
  const verify = async (leaf: FileAction, scope?: AccessScope) => {
    // Take snapshots AFTER admin save so the intended ACL audit/version change
    // cannot hide unauthorized effects from the following business requests.
    const before = await capture(), accessBefore = await accessState();
    for (const file of visible) await checkFile(file, leaf, scope !== undefined && matches(scope, file));
    if (scope && ['access', 'read'].includes(leaf)) {
      for (const [objectId, sourceFiles] of [[a.id, [ownA, founderA]], [b.id, [founderB]]] as const) {
        const listed = await json<Uploaded[]>(await request(`/files/entity/object/${objectId}`));
        assert.deepEqual(listed.map(({ id }) => id).sort(), sourceFiles.filter((file) => !matches(scope, file)).map(({ id }) => id).sort());
      }
    }
    assert.deepEqual(await capture(), before, 'Read/text-retry scope probes have no file, derivative, audit, notification, ownership or assignment effects');
    assert.deepEqual(await accessState(), accessBefore, 'Business requests cannot mutate admin previews, rules, audits or access version');
  };

  for (const scope of scopes) await t.test(`${scope}: real founder allow/deny/default distinguishes uploader from assignment for all five scoped file actions`, async () => {
    const ids = scope === 'selected' ? [founderA.id] : [];
    await admin(scopedActions.map((leaf) => change(`files.${leaf}`, 'allow', scope, ids)));
    await verify('read'); // Allows are additive to the real source-authorized baseline.
    for (const leaf of scopedActions) {
      await admin([change(`files.${leaf}`, 'deny', scope, ids)]);
      await verify(leaf, scope);
      await admin([change(`files.${leaf}`, 'default', scope, ids)]);
      await verify(leaf);
    }
  });

  await t.test('global file/root/upload allows never open hidden source C or manufacture an assignment', async () => {
    await admin([...scopedActions.map((leaf) => change(`files.${leaf}`, 'allow')), change('files.upload', 'allow')]);
    const before = await capture(), accessBefore = await accessState();
    await checkFile(hiddenC, 'access', true);
    await deniedRead(`/entity/object/${c.id}`);
    await exactStatus(await upload(c.id), 403);
    await checkFile(founderB, 'read', false);
    assert.deepEqual(await capture(), before);
    assert.deepEqual(await accessState(), accessBefore);
  });

  await t.test('root own deny blocks generated upload/replay; selected existing-file deny does not globally block a separately authorized new upload', async () => {
    await admin([...scopedActions.map((leaf) => change(`files.${leaf}`, 'default')), change('files.upload', 'allow')]);
    const deniedUpload = async (objectId: string, id?: string) => {
      const before = await capture(), accessBefore = await accessState();
      await exactStatus(await upload(objectId, cookie, id), 403);
      assert.deepEqual(await capture(), before, 'Rejected new/replayed upload has no business, binary, audit or notification effect');
      assert.deepEqual(await accessState(), accessBefore);
    };
    await deniedUpload(b.id); // Readable B still lacks independent source-write authority.
    await admin([change('files.access', 'deny', 'own')]);
    assert.equal((await json<MeResponseDto>(await request('/auth/me'))).capabilities.canUploadFile, false);
    await deniedUpload(a.id);
    await deniedUpload(a.id, ownA.id);
    await verify('access', 'own');
    await admin([change('files.access', 'default')]);
    assert.equal((await json<MeResponseDto>(await request('/auth/me'))).capabilities.canUploadFile, true);
    await admin([change('files.access', 'deny', 'selected', [ownA.id])]);
    assert.equal((await json<MeResponseDto>(await request('/auth/me'))).capabilities.canUploadFile, true);
    const before = await capture(), uploadAccessBefore = await accessState();
    const created = await json<Uploaded>(await upload(a.id), 201);
    const after = await capture();
    assert.deepEqual(await accessState(), uploadAccessBefore, 'Successful upload does not alter ACL or administrative history');
    assert.notEqual(created.id, ownA.id);
    const file = after.files.find(({ id }) => id === created.id)!;
    assert.equal(file.uploadedByUserId, actor.id); assert.equal(file.objectKey, `${prefix}${created.id}.txt`);
    assert.equal(file.mimeType, 'text/plain'); assert.equal(file.sizeBytes, expectedBytes.get(created.id)!.length);
    assert.deepEqual(after.files.filter(({ id }) => id !== created.id), before.files);
    const addedAttachments = after.attachments.filter((entry) => !before.attachments.some(({ id }) => id === entry.id));
    assert.equal(addedAttachments.length, 1);
    assert.deepEqual(after.attachments.filter((entry) => before.attachments.some(({ id }) => id === entry.id)), before.attachments);
    assert.equal(addedAttachments[0].fileId, created.id); assert.equal(addedAttachments[0].entityType, 'object');
    assert.equal(addedAttachments[0].entityId, a.id); assert.equal(addedAttachments[0].uploadedByUserId, actor.id);
    const addedAudit = after.audit.filter((entry) => !before.audit.some(({ id }) => id === entry.id));
    assert.equal(addedAudit.length, 1, 'One exact file.attached event; no audit-prefix exclusions');
    assert.deepEqual(after.audit.filter((entry) => before.audit.some(({ id }) => id === entry.id)), before.audit);
    assert.equal(addedAudit[0].action, 'file.attached'); assert.equal(addedAudit[0].entityType, 'object');
    assert.equal(addedAudit[0].entityId, a.id); assert.equal(addedAudit[0].actorUserId, actor.id);
    assert.deepEqual(addedAudit[0].newValues, { fileId: created.id, originalName: `${created.id}.txt`, mimeType: 'text/plain' });
    for (const key of ['derivatives', 'objects', 'assignments', 'notifications', 'identities'] as const) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(after.storageKeys, [...before.storageKeys, file.objectKey].sort());
    await checkFile(ownA, 'access', true);
    await checkFile(created, 'read', false);
    await deniedUpload(b.id);
    await admin([change('files.upload', 'deny')]);
    assert.equal((await json<MeResponseDto>(await request('/auth/me'))).capabilities.canUploadFile, false);
    await deniedUpload(a.id); await deniedUpload(a.id, created.id);
    await admin([change('files.upload', 'default')]);
    const replayBefore = await capture(), accessBefore = await accessState();
    assert.equal((await json<Uploaded>(await upload(a.id, cookie, created.id), 201)).id, created.id);
    assert.deepEqual(await capture(), replayBefore, 'Default-authorized text replay adds no binary/row/attachment/audit');
    assert.deepEqual(await accessState(), accessBefore);
    await admin([change('files.access', 'default')]);
  });
  assert.deepEqual(await identities(), originalIdentities, 'No role or direct-permission mutation');
  assert.deepEqual((await capture()).assignments, initialFacts.assignments, 'No grants fabricate source assignments');
  assert.equal(await prisma.fileDerivative.count({ where: { fileId: { in: [...expectedBytes.keys()] } } }), 0);
  // Main drops this exact isolated DB schema. ACL versions/admin audits are not
  // erased to disguise their effects. No browser, worker, socket, race, detach,
  // other source-type or complete K1-K7 certification is claimed by this file.
});
