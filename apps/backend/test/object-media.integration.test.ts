import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { cleanupCoreTestObject, createCoreTestObject } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('object comment, daily report and arrival photo expose MinIO-backed attachments via backend proxy', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const { objectId } = await createCoreTestObject(prisma);

  let commentId: string | null = null;
  let reportId: string | null = null;
  let arrivalId: string | null = null;

  t.after(async () => {
    const attachmentEntityFilters = [
      ...(commentId
        ? [
            {
              entityType: 'object_comment',
              entityId: commentId,
            },
          ]
        : []),
      ...(reportId
        ? [
            {
              entityType: 'object_daily_report',
              entityId: reportId,
            },
          ]
        : []),
      ...(arrivalId
        ? [
            {
              entityType: 'object_arrival_photo',
              entityId: arrivalId,
            },
          ]
        : []),
    ] as Array<{ entityType: string; entityId: string }>;

    if (attachmentEntityFilters.length > 0) {
      const fileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            OR: attachmentEntityFilters,
          },
          select: {
            fileId: true,
          },
        })
      ).map((item) => item.fileId);

      await prisma.fileAttachment.deleteMany({
        where: {
          OR: attachmentEntityFilters,
        },
      });

      if (fileIds.length > 0) {
        await prisma.file.deleteMany({
          where: {
            id: {
              in: fileIds,
            },
          },
        });
      }
    }

    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const commentResponse = await fetch(`${baseUrl}/api/v1/objects/${objectId}/comments`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: 'Комментарий по объекту с вложением',
    }),
  });

  assert.equal(commentResponse.status, 201);

  const createdComment = (await commentResponse.json()) as { id: string };
  commentId = createdComment.id;

  const commentAttachmentForm = new FormData();
  commentAttachmentForm.set('entityType', 'object_comment');
  commentAttachmentForm.set('entityId', createdComment.id);
  commentAttachmentForm.set(
    'file',
    new Blob(['object-comment'], { type: 'image/jpeg' }),
    'object-comment.jpg',
  );

  const commentUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
    },
    body: commentAttachmentForm,
  });

  assert.equal(commentUploadResponse.status, 201);

  const reportResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/daily-report/today`,
    {
      method: 'PUT',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Отчет по объекту с фото',
      }),
    },
  );

  assert.equal(reportResponse.status, 200);

  const createdReport = (await reportResponse.json()) as { id: string };
  reportId = createdReport.id;

  const reportAttachmentForm = new FormData();
  reportAttachmentForm.set('entityType', 'object_daily_report');
  reportAttachmentForm.set('entityId', createdReport.id);
  reportAttachmentForm.set(
    'file',
    new Blob(['object-report'], { type: 'image/jpeg' }),
    'object-report.jpg',
  );

  const reportUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
    },
    body: reportAttachmentForm,
  });

  assert.equal(reportUploadResponse.status, 201);

  const arrivalResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/arrival-photo`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photoType: 'before',
        comment: 'Фото до начала работ',
      }),
    },
  );

  assert.equal(arrivalResponse.status, 201);

  const createdArrival = (await arrivalResponse.json()) as { id: string };
  arrivalId = createdArrival.id;

  const arrivalAttachmentForm = new FormData();
  arrivalAttachmentForm.set('entityType', 'object_arrival_photo');
  arrivalAttachmentForm.set('entityId', createdArrival.id);
  arrivalAttachmentForm.set(
    'file',
    new Blob(['object-arrival'], { type: 'image/jpeg' }),
    'object-arrival.jpg',
  );

  const arrivalUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
    },
    body: arrivalAttachmentForm,
  });

  assert.equal(arrivalUploadResponse.status, 201);

  const [commentsListResponse, reportGetResponse, arrivalGetResponse] =
    await Promise.all([
      fetch(`${baseUrl}/api/v1/objects/${objectId}/comments`, {
        headers: {
          Cookie: founderCookie,
        },
      }),
      fetch(`${baseUrl}/api/v1/objects/${objectId}/daily-report/today`, {
        headers: {
          Cookie: founderCookie,
        },
      }),
      fetch(`${baseUrl}/api/v1/objects/${objectId}/arrival-photo/today`, {
        headers: {
          Cookie: founderCookie,
        },
      }),
    ]);

  assert.equal(commentsListResponse.status, 200);
  assert.equal(reportGetResponse.status, 200);
  assert.equal(arrivalGetResponse.status, 200);

  const comments = (await commentsListResponse.json()) as Array<{
    id: string;
    attachments: Array<{ id: string }>;
  }>;
  const report = (await reportGetResponse.json()) as {
    id: string;
    attachments: Array<{ id: string }>;
  } | null;
  const arrival = (await arrivalGetResponse.json()) as {
    id: string;
    photoUrl: string | null;
    attachments: Array<{ id: string }>;
  } | null;

  const loadedComment = comments.find((item) => item.id === commentId);

  assert.ok(loadedComment);
  assert.equal(loadedComment.attachments.length, 1);
  assert.ok(report);
  assert.equal(report.id, reportId);
  assert.equal(report.attachments.length, 1);
  assert.ok(arrival);
  assert.equal(arrival.id, arrivalId);
  assert.equal(arrival.photoUrl, null);
  assert.equal(arrival.attachments.length, 1);
});
