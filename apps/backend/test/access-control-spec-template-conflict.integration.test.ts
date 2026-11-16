import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('duplicate template name returns a conflict without saving any changes', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const db = new PrismaClient();
  t.after(() => db.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const endpoint = `${baseUrl}/api/v1/one-time-orders/specification-templates`;
  const template = await db.oneTimeOrderSpecificationTemplate.create({ data: { name: 'Шаблон для редактирования' } });
  const occupied = await db.oneTimeOrderSpecificationTemplate.create({ data: { name: 'Занятое имя шаблона' } });
  const item = await db.oneTimeOrderSpecificationCatalogItem.create({ data: { title: 'Контрольный пункт' } });
  const state = () => Promise.all([
    db.oneTimeOrderSpecificationTemplate.findMany({ orderBy: { id: 'asc' }, include: { items: true } }),
    db.auditEvent.findMany({ where: { entityType: 'one_time_order_specification_catalog' }, orderBy: { id: 'asc' } }),
  ]);
  const before = await state();
  const options = (method: string, payload: object) => ({
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const attempts = [
    [`${endpoint}/${template.id}`, options('PATCH', {
      expectedVersion: template.version,
      name: `  ${occupied.name}  `,
      items: [{ catalogItemId: item.id, sortOrder: 0 }],
    })],
    [endpoint, options('POST', { name: occupied.name, items: [] })],
  ] as const;
  for (const [url, init] of attempts) {
    const response = await fetch(url, init);
    const error = await response.json() as { code: string; message: string };
    assert.equal(response.status, 409, JSON.stringify(error));
    assert.equal(error.code, 'SPECIFICATION_TEMPLATE_NAME_CONFLICT');
    assert.match(error.message, /названием уже существует/);
    assert.deepEqual(await state(), before);
  }
});
