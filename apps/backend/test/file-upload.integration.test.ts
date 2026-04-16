import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('file upload stores metadata and serves content via backend proxy', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const object = await prisma.object.findFirst({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  assert.ok(object, 'seeded object should exist');

  const cookieHeader = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });

  const form = new FormData();
  form.set('entityType', 'object');
  form.set('entityId', object.id);
  form.set(
    'file',
    new Blob(['platform upload smoke'], { type: 'text/plain' }),
    'platform-upload.txt',
  );

  const uploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
    },
    body: form,
  });

  assert.equal(uploadResponse.status, 201);

  const uploaded = (await uploadResponse.json()) as {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    attachments: Array<{
      entityType: string;
      entityId: string;
      fieldCode: string | null;
    }>;
  };

  assert.equal(uploaded.originalName, 'platform-upload.txt');
  assert.equal(uploaded.mimeType, 'text/plain');
  assert.equal(uploaded.attachments.length, 1);
  assert.equal(uploaded.attachments[0]?.entityType, 'object');
  assert.equal(uploaded.attachments[0]?.entityId, object.id);
  assert.equal(uploaded.attachments[0]?.fieldCode, null);
  assert.match(uploaded.url, /^\/api\/v1\/files\/.+\/content$/);

  const listedResponse = await fetch(
    `${baseUrl}/api/v1/files/entity/object/${object.id}`,
    {
      headers: {
        Cookie: cookieHeader,
      },
    },
  );

  assert.equal(listedResponse.status, 200);

  const listed = (await listedResponse.json()) as Array<{ id: string }>;
  assert.ok(listed.some((item) => item.id === uploaded.id));

  const contentResponse = await fetch(new URL(uploaded.url, baseUrl), {
    headers: {
      Cookie: cookieHeader,
    },
  });

  assert.equal(contentResponse.status, 200);
  assert.equal(await contentResponse.text(), 'platform upload smoke');
});
