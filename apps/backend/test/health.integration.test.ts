import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestApp } from './helpers/create-test-app';

test('health endpoint returns ok payload', async (t) => {
  const { app, baseUrl } = await createTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${baseUrl}/api/v1/health`);
  const payload = (await response.json()) as {
    status: string;
    service: string;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'backend');
});
