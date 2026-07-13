import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { StorageService } from '../src/modules/storage/storage.service';

import { loginAndGetCookieHeader } from './helpers/auth';
import { cleanupCoreTestObject, createCoreTestObject } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';

test('file previews are private, inline-safe and derivative-backed', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const storage = app.get(StorageService);
  const { objectId } = await createCoreTestObject(prisma);
  const createdFileIds: string[] = [];
  const [founderCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'hr1',
      password: 'hr123',
    }),
  ]);

  t.after(async () => {
    if (createdFileIds.length > 0) {
      await prisma.fileAttachment.deleteMany({
        where: { fileId: { in: createdFileIds } },
      });
      await prisma.file.deleteMany({
        where: { id: { in: createdFileIds } },
      });
    }

    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const upload = async (
    name: string,
    mimeType: string,
    content: string | Buffer,
  ): Promise<{ id: string; mimeType: string }> => {
    const form = new FormData();
    form.set('entityType', 'object');
    form.set('entityId', objectId);
    form.set(
      'file',
      new Blob(
        [typeof content === 'string' ? content : new Uint8Array(content)],
        { type: mimeType },
      ),
      name,
    );
    const response = await fetch(`${baseUrl}/api/v1/files/upload`, {
      method: 'POST',
      headers: { Cookie: founderCookie },
      body: form,
    });
    assert.equal(response.status, 201);
    const file = (await response.json()) as { id: string; mimeType: string };
    createdFileIds.push(file.id);
    return file;
  };

  const waitForStatus = async (
    fileId: string,
    statuses: string[],
  ): Promise<{
    previewStatus: string;
    previewType: string;
    thumbnailUrl: string | null;
    inlineContentUrl: string | null;
    errorMessage: string | null;
  }> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}/view`, {
        headers: { Cookie: founderCookie },
      });
      assert.equal(response.status, 200);
      const view = (await response.json()) as {
        previewStatus: string;
        previewType: string;
        thumbnailUrl: string | null;
        inlineContentUrl: string | null;
        errorMessage: string | null;
      };

      if (statuses.includes(view.previewStatus)) {
        return view;
      }

      await delay(100);
    }

    assert.fail(`Preview status did not reach ${statuses.join(' or ')}`);
  };

  const jpeg = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 40, g: 110, b: 170 },
    },
  })
    .jpeg()
    .toBuffer();
  const image = await upload('preview.jpg', 'image/jpeg', jpeg);
  assert.equal(image.mimeType, 'image/jpeg');
  const imageView = await waitForStatus(image.id, ['ready']);
  assert.equal(imageView.previewType, 'image');
  assert.ok(imageView.thumbnailUrl);
  assert.ok(imageView.inlineContentUrl);

  const thumbnailResponse = await fetch(
    `${baseUrl}${imageView.thumbnailUrl}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(thumbnailResponse.status, 200);
  assert.equal(thumbnailResponse.headers.get('content-type'), 'image/webp');
  assert.equal(
    thumbnailResponse.headers.get('content-disposition')?.startsWith('inline'),
    true,
  );
  assert.equal(
    thumbnailResponse.headers.get('x-content-type-options'),
    'nosniff',
  );

  const forbiddenViewResponse = await fetch(
    `${baseUrl}/api/v1/files/${image.id}/view`,
    { headers: { Cookie: hrCookie } },
  );
  assert.equal(forbiddenViewResponse.status, 403);
  const forbiddenThumbnailResponse = await fetch(
    `${baseUrl}/api/v1/files/${image.id}/thumbnail`,
    { headers: { Cookie: hrCookie } },
  );
  assert.equal(forbiddenThumbnailResponse.status, 403);

  const pdf = await upload(
    'preview.pdf',
    'application/pdf',
    Buffer.from('%PDF-1.4\n%%EOF\n'),
  );
  const pdfView = await waitForStatus(pdf.id, ['ready']);
  assert.equal(pdfView.previewType, 'pdf');
  const pdfPreviewResponse = await fetch(
    `${baseUrl}${pdfView.inlineContentUrl}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(pdfPreviewResponse.status, 200);
  assert.equal(pdfPreviewResponse.headers.get('content-type'), 'application/pdf');
  assert.equal(
    pdfPreviewResponse.headers.get('content-disposition')?.startsWith('inline'),
    true,
  );
  const pdfDownloadResponse = await fetch(
    `${baseUrl}/api/v1/files/${pdf.id}/content?download=1`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(pdfDownloadResponse.status, 200);
  assert.equal(
    pdfDownloadResponse.headers
      .get('content-disposition')
      ?.startsWith('attachment'),
    true,
  );

  const office = await upload(
    'preview.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.from('PK\u0003\u0004invalid-docx'),
  );
  const failedOfficeView = await waitForStatus(office.id, ['failed']);
  assert.equal(failedOfficeView.previewType, 'pdf');
  assert.ok(failedOfficeView.errorMessage);
  assert.equal(
    await prisma.fileDerivative.count({ where: { fileId: office.id } }),
    1,
  );
  const retryOfficeResponse = await fetch(
    `${baseUrl}/api/v1/files/${office.id}/preview/retry`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(retryOfficeResponse.status, 201);
  await waitForStatus(office.id, ['failed']);
  assert.equal(
    await prisma.fileDerivative.count({ where: { fileId: office.id } }),
    1,
  );

  const derivativeObjectKey = `derivatives/${office.id}/test-preview.pdf`;
  const derivativePdf = Buffer.from('%PDF-1.4\ntest derivative\n%%EOF\n');
  await storage.uploadObject({
    objectKey: derivativeObjectKey,
    body: derivativePdf,
    contentType: 'application/pdf',
    contentLength: derivativePdf.length,
  });
  await prisma.fileDerivative.update({
    where: {
      fileId_derivativeType: {
        fileId: office.id,
        derivativeType: 'preview_pdf',
      },
    },
    data: {
      status: 'ready',
      objectKey: derivativeObjectKey,
      mimeType: 'application/pdf',
      sizeBytes: derivativePdf.length,
      errorMessage: null,
    },
  });
  const readyOfficeView = await waitForStatus(office.id, ['ready']);
  const officePreviewResponse = await fetch(
    `${baseUrl}${readyOfficeView.inlineContentUrl}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(officePreviewResponse.status, 200);
  assert.equal(
    officePreviewResponse.headers.get('content-type'),
    'application/pdf',
  );

  const svg = await upload(
    'unsafe.svg',
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  );
  assert.equal(svg.mimeType, 'image/svg+xml');
  const svgView = await waitForStatus(svg.id, ['failed']);
  assert.equal(svgView.previewType, 'unsupported');
  assert.equal(svgView.inlineContentUrl, null);
  const svgPreviewResponse = await fetch(
    `${baseUrl}/api/v1/files/${svg.id}/preview/content`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(svgPreviewResponse.status, 415);
});
