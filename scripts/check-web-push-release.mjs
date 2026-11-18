import { createRequire } from 'node:module';

// Run in the built backend container with its real env. Never prints keys.
try {
  const require = createRequire(import.meta.url);
  const { readWebPushConfig } = require('../apps/backend/dist/modules/notifications/push/web-push.config.js');
  const config = readWebPushConfig({ get: (key) => process.env[key] });
  if (!config) throw new Error('Web Push must be enabled with a valid matching VAPID pair and subject.');
  const origin = new URL(process.env.APP_BASE_URL || '');
  if (process.env.NODE_ENV !== 'production' || process.env.AUTH_COOKIE_SECURE !== 'true' ||
      origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash ||
      origin.username || origin.password || origin.port || origin.hostname === 'localhost') {
    throw new Error('Expected production mode, secure auth cookies and the confirmed HTTPS APP_BASE_URL origin.');
  }
  console.log('Web Push release configuration: valid and enabled. No network delivery was attempted.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Web Push release configuration failed.');
  process.exitCode = 1;
}
