import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ObjectDailyReportPublicationService } from '../src/modules/object-operations/object-daily-report-publication.service';
import { moscowDateKey } from '../src/modules/objects/utils/object-season.util';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { FilesService } from '../src/modules/files/files.service';
import { ChatRealtimeService } from '../src/modules/chats/chat-realtime.service';
import { createCoreTestObject } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';

async function fixture(t: test.TestContext) {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Run with the isolated integration database');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const auth = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const report = await prisma.objectDailyReport.create({ data: { objectId, reportDate: new Date(`${moscowDateKey()}T00:00:00`), content: 'Daily report', updatedByUserId: manager.id } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHkAAAAASUVORK5CYII=', 'base64');
  const stage = async (reportId = report.id, requestId = randomUUID(), bytes = png, name = 'daily.png', mimeType = 'image/png') => {
    const form = new FormData(); form.set('requestId', requestId);
    form.set('file', new Blob([bytes], { type: mimeType }), name);
    return fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports/${reportId}/attachments`, { method: 'POST', headers: { Cookie: auth }, body: form });
  };
  return { prisma, app, baseUrl, auth, objectId, manager, report, request, stage, png };
}

test('draft correction stages files, detaches only the report link, and replays idempotently', async (t) => {
  const { prisma, objectId, manager, report, request, stage, baseUrl, auth, png } = await fixture(t);
  const stageRequestId = randomUUID();
  const stagedResponse = await stage(report.id, stageRequestId); assert.equal(stagedResponse.status, 201, await stagedResponse.clone().text());
  const staged = await stagedResponse.json() as { file: { id: string } };
  assert.equal(await prisma.fileAttachment.count({ where: { fileId: staged.file.id } }), 0, 'staging is not a report attachment');
  const first = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', {
    expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id],
  });
  assert.equal(first.status, 200, await first.clone().text());
  const result = await first.json() as { revision: number; attachments: Array<{ attachmentId: string; id: string }>; publication: { status: string } };
  assert.equal(result.revision, 2); assert.equal(result.attachments.length, 1); assert.equal(result.publication.status, 'not_required');
  const historyResponse = await request(`/objects/${objectId}/daily-reports`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json() as Array<{ id: string; publicationState: string; capabilities: { editAttachments: boolean }; attachments: Array<{ attachmentId: string; id: string }> }>;
  const loaded = history.find((entry) => entry.id === report.id)!;
  assert.equal(loaded.publicationState, 'draft'); assert.equal(loaded.capabilities.editAttachments, true);
  assert.equal(loaded.attachments[0]?.attachmentId, result.attachments[0]?.attachmentId);
  const stageReplay = await stage(report.id, stageRequestId); assert.equal(stageReplay.status, 201);
  assert.equal(((await stageReplay.json()) as { file: { id: string } }).file.id, staged.file.id, 'consumed stage request receipt remains replayable');
  const consumedReuse = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', {
    expectedRevision: 2, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id],
  });
  assert.equal(consumedReuse.status, 409, 'consumed staging cannot be applied twice');
  const shared = await prisma.fileAttachment.create({ data: { fileId: staged.file.id, entityType: 'object_comment', entityId: (await prisma.objectComment.create({ data: { objectId, content: 'shared', createdByUserId: manager.id } })).id, uploadedByUserId: manager.id } });
  const requestId = randomUUID();
  const detached = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 2, requestId, removeAttachmentIds: [result.attachments[0]!.attachmentId], addFileIds: [] });
  assert.equal(detached.status, 200);
  const replay = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 2, requestId, removeAttachmentIds: [result.attachments[0]!.attachmentId], addFileIds: [] });
  assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), await detached.json());
  assert.ok(await prisma.file.findUnique({ where: { id: staged.file.id } }), 'binary file record remains');
  assert.ok(await prisma.fileAttachment.findUnique({ where: { id: shared.id } }), 'shared link remains');
  assert.equal(await prisma.fileAttachment.count({ where: { fileId: staged.file.id, entityType: 'object_daily_report', entityId: report.id } }), 0);
  const sharedContent = await fetch(`${baseUrl}/api/v1/files/${staged.file.id}/content`, { headers: { Cookie: auth } });
  assert.equal(sharedContent.status, 200, await sharedContent.clone().text());
  assert.deepEqual(Buffer.from(await sharedContent.arrayBuffer()), png);
});

test('submitted correction is audited and published from an immutable attachment snapshot with retry deduplication', async (t) => {
  const { prisma, app, objectId, manager, report, request, stage } = await fixture(t);
  const originalObjectName = (await prisma.object.findUniqueOrThrow({ where: { id: objectId } })).name;
  const originalActorName = manager.fullName;
  const publications = app.get(ObjectDailyReportPublicationService); publications.onModuleDestroy();
  const stagedResponse = await stage(); assert.equal(stagedResponse.status, 201);
  const staged = await stagedResponse.json() as { file: { id: string } };
  const added = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id] });
  assert.equal(added.status, 200);
  await request(`/objects/${objectId}/daily-report/today/submit`, 'POST', { expectedRevision: 2 });
  const before = await prisma.fileAttachment.findFirstOrThrow({ where: { fileId: staged.file.id, entityType: 'object_daily_report', entityId: report.id } });
  const secondStageResponse = await stage(); assert.equal(secondStageResponse.status, 201);
  const secondStage = await secondStageResponse.json() as { file: { id: string } };
  const missingReason = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 2, requestId: randomUUID(), removeAttachmentIds: [before.id], addFileIds: [secondStage.file.id] });
  assert.equal(missingReason.status, 409);
  const appPrisma = app.get(PrismaService);
  const chatRoom = await appPrisma.chatRoom.findUniqueOrThrow({ where: { code: 'objects' } });
  let failAfterInsert = true;
  const originalCreate = appPrisma.chatMessage.create.bind(appPrisma.chatMessage);
  appPrisma.chatMessage.create = (async (args: Parameters<typeof appPrisma.chatMessage.create>[0]) => {
    const inserted = await originalCreate(args);
    if (failAfterInsert && args.data.systemEventKey) {
      failAfterInsert = false;
      throw new Error('simulated process failure immediately after message insert');
    }
    return inserted;
  }) as unknown as typeof appPrisma.chatMessage.create;
  const realtime = app.get(ChatRealtimeService);
  const originalPublish = realtime.publish.bind(realtime);
  const publishedEvents: string[] = [];
  realtime.publish = (async (event) => { publishedEvents.push(event.type); await originalPublish(event); }) as typeof realtime.publish;
  const payload = { expectedRevision: 2, requestId: randomUUID(), removeAttachmentIds: [before.id], addFileIds: [secondStage.file.id], reason: 'Неверный кадр' };
  const corrected = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', payload);
  assert.equal(corrected.status, 200, await corrected.clone().text());
  const response = await corrected.json() as { revision: number; submittedRevision: number; publication: { status: string }; attachments: Array<{ attachmentId: string }> };
  assert.equal(response.revision, 3); assert.equal(response.submittedRevision, 3); assert.equal(response.publication.status, 'queued');
  const publication = await prisma.objectDailyReportPublication.findUniqueOrThrow({ where: { reportId_revision: { reportId: report.id, revision: 3 } } });
  assert.equal(publication.correctionReason, 'Неверный кадр');
  assert.deepEqual(publication.attachmentSnapshot, [{ fileId: secondStage.file.id, originalName: 'daily.png' }]);
  assert.deepEqual(publication.attachmentDiff, { removed: [{ attachmentId: before.id, fileId: staged.file.id, originalName: 'daily.png' }], added: [{ id: response.attachments[0]!.attachmentId, fileId: secondStage.file.id, originalName: 'daily.png' }] });
  const eventKey = `object-daily-report:${report.id}:3`;
  assert.equal(await prisma.chatMessage.count({ where: { systemEventKey: eventKey } }), 1, 'message insert remains committed across simulated process failure');
  assert.equal(await prisma.auditEvent.count({ where: { entityType: 'chat_room', entityId: chatRoom.id, action: 'chat.system_message.created', metadata: { path: ['systemEventKey'], equals: eventKey } } }), 0, 'post-insert failure happens before audit completion');
  assert.equal(publishedEvents.length, 0, 'post-insert failure happens before realtime publication');
  const originalPublicationDate = await prisma.objectDailyReportPublication.findUniqueOrThrow({ where: { reportId_revision: { reportId: report.id, revision: 3 } } });
  assert.equal(originalPublicationDate.publishedAt, null, 'outbox remains retryable');
  const newerAt = new Date(Date.now() + 1000);
  const newerMessage = await appPrisma.chatMessage.create({ data: {
    chatRoomId: chatRoom.id, authorUserId: manager.id, messageType: 'text', text: 'Newer chat message', createdAt: newerAt,
  } });
  await appPrisma.chatRoom.update({ where: { id: chatRoom.id }, data: { lastMessageAt: newerMessage.createdAt, lastMessagePreview: newerMessage.text } });
  const renamedObject = 'Object renamed after delivery attempt';
  const renamedActor = 'Actor renamed after delivery attempt';
  await prisma.object.update({ where: { id: objectId }, data: { name: renamedObject } });
  await prisma.user.update({ where: { id: manager.id }, data: { fullName: renamedActor } });
  await prisma.objectDailyReportPublication.create({ data: {
    reportId: report.id, revision: 4, actorUserId: manager.id, content: 'Legacy publication', attachmentSnapshot: [],
  } });
  const legacyKey = `object-daily-report:${report.id}:4`;
  const legacyText = `Legacy frozen delivery · ${originalObjectName} · ${originalActorName}`;
  const legacyMetadata = { objectId, reportId: report.id, reportDate: moscowDateKey(report.reportDate), targetUrl: `/objects/${objectId}?reportDate=${moscowDateKey(report.reportDate)}&reportId=${report.id}#reports` };
  await appPrisma.chatMessage.create({ data: { systemEventKey: legacyKey, chatRoomId: chatRoom.id, messageType: 'system', text: legacyText, metadata: legacyMetadata } });
  await prisma.objectDailyReportPublication.create({ data: {
    reportId: report.id, revision: 5, actorUserId: manager.id, content: 'Following queued publication', attachmentSnapshot: [],
  } });
  appPrisma.chatMessage.create = originalCreate;
  await publications.flush(); await publications.flush();
  const message = await prisma.chatMessage.findFirstOrThrow({ where: { systemEventKey: eventKey } });
  assert.match(message.text ?? '', /Исправление фото ежедневного отчёта/); assert.match(message.text ?? '', /Неверный кадр/);
  assert.match(message.text ?? '', new RegExp(originalObjectName));
  assert.match(message.text ?? '', new RegExp(originalActorName));
  assert.doesNotMatch(message.text ?? '', new RegExp(renamedObject));
  assert.doesNotMatch(message.text ?? '', new RegExp(renamedActor));
  assert.deepEqual((message.metadata as { attachmentSnapshot: unknown }).attachmentSnapshot, publication.attachmentSnapshot);
  const metadata = message.metadata as { objectId: string; reportId: string; reportDate: string; targetUrl: string };
  assert.equal(metadata.objectId, objectId); assert.equal(metadata.reportId, report.id); assert.match(metadata.reportDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(metadata.targetUrl, `/objects/${objectId}?reportDate=${metadata.reportDate}&reportId=${report.id}#reports`);
  assert.equal(await prisma.chatMessage.count({ where: { systemEventKey: eventKey } }), 1);
  const roomAfter = await prisma.chatRoom.findUniqueOrThrow({ where: { id: chatRoom.id } });
  assert.equal(roomAfter.lastMessagePreview, newerMessage.text, 'retry preserves the newer room preview');
  assert.equal(roomAfter.lastMessageAt?.toISOString(), newerMessage.createdAt.toISOString(), 'retry preserves newer room ordering timestamp');
  assert.equal(await prisma.auditEvent.count({ where: { entityType: 'chat_room', entityId: chatRoom.id, action: 'chat.system_message.created', metadata: { path: ['systemEventKey'], equals: eventKey } } }), 1, 'retry records exactly one matching audit event');
  assert.deepEqual(publishedEvents, ['chat.message_created', 'chat.room_updated', 'chat.message_created', 'chat.room_updated', 'chat.message_created', 'chat.room_updated'], 'retry, legacy backfill, and following queue item each complete realtime exactly once');
  const legacyPublication = await prisma.objectDailyReportPublication.findUniqueOrThrow({ where: { reportId_revision: { reportId: report.id, revision: 4 } } });
  assert.equal((legacyPublication.deliveryPayload as { text: string }).text, legacyText, 'legacy inserted message is the source for immutable delivery backfill');
  assert.ok(legacyPublication.publishedAt, 'legacy publication with an existing event-key message completes delivery');
  const legacyMessageAfterRetry = await prisma.chatMessage.findUniqueOrThrow({ where: { systemEventKey: legacyKey } });
  assert.equal(legacyMessageAfterRetry.text, legacyText);
  const followingPublication = await prisma.objectDailyReportPublication.findUniqueOrThrow({ where: { reportId_revision: { reportId: report.id, revision: 5 } } });
  assert.ok(followingPublication.publishedAt, 'later queue item is not starved by the retried publication');
  const followingMessage = await prisma.chatMessage.findUniqueOrThrow({ where: { systemEventKey: `object-daily-report:${report.id}:5` } });
  assert.match(followingMessage.text ?? '', new RegExp(renamedObject));
  assert.match(followingMessage.text ?? '', new RegExp(renamedActor));
  const audit = await prisma.objectAuditLog.findFirstOrThrow({ where: { objectId, actionCode: 'daily_report.attachments_corrected' }, orderBy: { createdAt: 'desc' } });
  assert.equal((audit.payload as { reason: string }).reason, 'Неверный кадр');
});

test('foreign scope, cross-report staged files, stale revisions and concurrent idempotent retries are rejected or replayed safely', async (t) => {
  const { prisma, baseUrl, objectId, manager, report, request, stage } = await fixture(t);
  const secondReport = await prisma.objectDailyReport.create({ data: { objectId, reportDate: new Date('2020-01-01'), content: 'Other report', updatedByUserId: manager.id } });
  const stagedResponse = await stage(secondReport.id); assert.equal(stagedResponse.status, 201);
  const staged = await stagedResponse.json() as { file: { id: string } };
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const foreignActor = await fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports/${report.id}/attachments`, {
    method: 'PATCH', headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id] }),
  });
  assert.equal(foreignActor.status, 409, 'staged file belongs only to its staging actor');
  const crossReport = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id] });
  assert.equal(crossReport.status, 409);
  const noAuth = await fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports/${report.id}/attachments`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [] }) });
  assert.equal(noAuth.status, 401);
  const payload = { expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id] };
  const forged = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { ...payload, requestId: randomUUID(), addFileIds: [randomUUID()] });
  assert.equal(forged.status, 409);
  const duplicate = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { ...payload, requestId: randomUUID(), addFileIds: [staged.file.id, staged.file.id] });
  assert.equal(duplicate.status, 409);
  const foreignScope = await request(`/objects/${randomUUID()}/daily-reports/${report.id}/attachments`, 'PATCH', payload);
  assert.ok([403, 404].includes(foreignScope.status));
  const otherStagedResponse = await stage(report.id); assert.equal(otherStagedResponse.status, 201);
  const ownStaged = await otherStagedResponse.json() as { file: { id: string } };
  const accepted = { ...payload, addFileIds: [ownStaged.file.id] };
  const racing = await Promise.all([1, 2].map(() => request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', accepted)));
  assert.deepEqual(racing.map((response) => response.status), [200, 200]);
  const changedReplay = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { ...accepted, addFileIds: [] });
  assert.equal(changedReplay.status, 409);
  const competingStageResponse = await stage(report.id); assert.equal(competingStageResponse.status, 201);
  const competingStage = await competingStageResponse.json() as { file: { id: string } };
  const competing = await Promise.all([randomUUID(), randomUUID()].map((requestId) => request(
    `/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH',
    { expectedRevision: 2, requestId, removeAttachmentIds: [], addFileIds: [competingStage.file.id] },
  )));
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  const stale = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', { expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [] });
  assert.equal(stale.status, 409);
});

test('HR report-only grant can read report history and its files, but not object files or edit reports', async (t) => {
  const { prisma, baseUrl, objectId, manager, report, stage } = await fixture(t);
  const fileStage = await stage(); assert.equal(fileStage.status, 201);
  const staged = await fileStage.json() as { file: { id: string } };
  const attach = await fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports/${report.id}/attachments`, {
    method: 'PATCH', headers: { Cookie: await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [staged.file.id] }),
  });
  assert.equal(attach.status, 200, await attach.clone().text());
  const objectFile = await prisma.file.create({ data: { bucket: 'test', objectKey: `not-downloaded/${randomUUID()}`, originalName: 'object-only.jpg', mimeType: 'image/jpeg', sizeBytes: 1, uploadedByUserId: manager.id } });
  await prisma.fileAttachment.create({ data: { fileId: objectFile.id, entityType: 'object', entityId: objectId, uploadedByUserId: manager.id } });
  const hrAuth = await loginAndGetCookieHeader({ baseUrl, login: 'lazutina', password: 'lazutina123' });
  const history = await fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports`, { headers: { Cookie: hrAuth } });
  assert.equal(history.status, 200, await history.clone().text());
  const reports = await history.json() as Array<{ id: string; capabilities: { editAttachments: boolean }; attachments: Array<{ attachmentId: string; id: string }> }>;
  const reportDto = reports.find((entry) => entry.id === report.id)!;
  assert.equal(reportDto.capabilities.editAttachments, false); assert.ok(reportDto.attachments[0]?.attachmentId);
  const reportFileRead = await fetch(`${baseUrl}/api/v1/files/${staged.file.id}/content`, { headers: { Cookie: hrAuth } });
  assert.equal(reportFileRead.status, 200, await reportFileRead.clone().text());
  const objectFileRead = await fetch(`${baseUrl}/api/v1/files/${objectFile.id}/content`, { headers: { Cookie: hrAuth } });
  assert.equal(objectFileRead.status, 403);
  const editDenied = await fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-reports/${report.id}/attachments`, {
    method: 'PATCH', headers: { Cookie: hrAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, requestId: randomUUID(), removeAttachmentIds: [reportDto.attachments[0]!.attachmentId], addFileIds: [], reason: 'not allowed' }),
  });
  assert.equal(editDenied.status, 403);
});

test('frozen and archived objects reject changes; a rejected stage leaves the report unchanged', async (t) => {
  const { prisma, app, objectId, report, manager, request, stage } = await fixture(t);
  const files = app.get(FilesService);
  const original = files.assertDailyReportWritable.bind(files);
  const staged = await stage(); assert.equal(staged.status, 201);
  const fileId = ((await staged.json()) as { file: { id: string } }).file.id;
  for (const status of ['frozen', 'archived']) {
    await prisma.object.update({ where: { id: objectId }, data: { status } });
    assert.equal((await stage()).status, 409);
    const blocked = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', {
      expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [fileId],
    });
    assert.ok([403, 409].includes(blocked.status));
  }
  await prisma.object.update({ where: { id: objectId }, data: { status: 'active' } });
  files.assertDailyReportWritable = async () => { throw new Error('simulated authorization revocation'); };
  await assert.rejects(() => files.stageDailyReportAttachment(
    { id: manager.id, roleCode: 'manager' },
    objectId, report.id, randomUUID(), { buffer: Buffer.from('bytes'), size: 5, mimetype: 'application/octet-stream', originalname: 'cancelled.bin' },
  ));
  files.assertDailyReportWritable = original;
  assert.equal((await prisma.objectDailyReport.findUniqueOrThrow({ where: { id: report.id } })).revision, 1);
});

test('generic file upload cannot bypass report staging', async (t) => {
  const { baseUrl, auth, report } = await fixture(t);
  const form = new FormData(); form.set('entityType', 'object_daily_report'); form.set('entityId', report.id);
  form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'bypass.png');
  const response = await fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: auth }, body: form });
  assert.equal(response.status, 400);
});

test('staging replay fingerprints bytes and filename, while keeping existing file MIME handling', async (t) => {
  const { objectId, report, stage, request } = await fixture(t);
  const requestId = randomUUID();
  const first = await stage(report.id, requestId); assert.equal(first.status, 201);
  const firstValue = await first.json() as { file: { id: string } };
  const replay = await stage(report.id, requestId); assert.equal(replay.status, 201);
  assert.equal(((await replay.json()) as { file: { id: string } }).file.id, firstValue.file.id);
  assert.equal((await stage(report.id, requestId, undefined, 'renamed.png')).status, 409);
  assert.equal((await stage(report.id, requestId, Buffer.from('different bytes'))).status, 409);
  const pdf = await stage(report.id, randomUUID(), Buffer.from('%PDF-1.4\n'), 'report.pdf', 'application/pdf');
  assert.equal(pdf.status, 201, await pdf.clone().text());
  const stagedPdf = await pdf.json() as { file: { id: string; mimeType: string } };
  assert.equal(stagedPdf.file.mimeType, 'application/pdf');
  const attachedPdf = await request(`/objects/${objectId}/daily-reports/${report.id}/attachments`, 'PATCH', {
    expectedRevision: 1, requestId: randomUUID(), removeAttachmentIds: [], addFileIds: [stagedPdf.file.id],
  });
  assert.equal(attachedPdf.status, 200, await attachedPdf.clone().text());
});

test('staging rechecks live object-write ACL after acquiring report locks', async (t) => {
  const { app, prisma, report, stage, objectId, manager } = await fixture(t);
  const files = app.get(FilesService);
  const original = files.assertDailyReportWritable.bind(files);
  let revokeAfterInitialCheck = true;
  files.assertDailyReportWritable = async (actor, reportId) => {
    await original(actor, reportId);
    if (revokeAfterInitialCheck) {
      revokeAfterInitialCheck = false;
      await prisma.objectAssignment.updateMany({ where: { objectId, userId: manager.id }, data: { isActive: false } });
    }
  };
  const response = await stage();
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(await prisma.objectDailyReportAttachmentStage.count({ where: { reportId: report.id } }), 0);
});
