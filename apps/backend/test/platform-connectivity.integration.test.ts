import assert from 'node:assert/strict';
import test from 'node:test';

import { RedisService } from '../src/modules/redis/redis.service';
import { StorageService } from '../src/modules/storage/storage.service';

import { createTestApp } from './helpers/create-test-app';

test('redis and storage platform services are reachable', async (t) => {
  const { app } = await createTestApp();

  t.after(async () => {
    await app.close();
  });

  const redisService = app.get(RedisService);
  const storageService = app.get(StorageService);

  assert.equal(await redisService.ping(), 'PONG');
  assert.deepEqual(await storageService.ping(), {
    bucket: process.env.MINIO_BUCKET ?? 'service-ops-files',
  });
});
