import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('approval search covers the full authorized result set before pagination', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const [founderCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  const marker = `approval-search-${Date.now()}`;
  const matchingRequest = await prisma.approvalRequest.create({
    data: {
      approvalType: 'object_change_confirmation',
      sourceEntityType: 'object',
      sourceEntityId: `${marker}-source`,
      status: 'pending',
      createdByUserId: founder.id,
      payloadSnapshot: {
        summaryTitle: `${marker} object title`,
        summarySubtitle: 'уникальный адрес для поиска',
        comment: 'служебная заметка для проверки поиска',
      },
    },
  });

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const search = async (cookie: string, term: string) => {
    const response = await fetch(
      `${baseUrl}/api/v1/approvals?search=${encodeURIComponent(term)}&page=1&limit=1`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      items: Array<{ id: string }>;
      total: number;
      totalPages: number;
    }>;
  };

  const byPayloadText = await search(founderCookie, 'УНИКАЛЬНЫЙ адрес');
  assert.equal(byPayloadText.total, 1);
  assert.equal(byPayloadText.totalPages, 1);
  assert.equal(byPayloadText.items[0]?.id, matchingRequest.id);

  const unauthorizedMatch = await search(managerCookie, marker);
  assert.equal(unauthorizedMatch.total, 0);
  assert.equal(unauthorizedMatch.items.length, 0);
});
