import { createECDH } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

// Creates a candidate secret fragment only. Never edits a live configuration,
// overwrites an existing key pair or sends the result to another machine.
const [originArgument, outputArgument, ...extra] = process.argv.slice(2);
let output;
let created = false;
try {
  if (!originArgument || !outputArgument || extra.length) {
    throw new Error('Usage: node scripts/prepare-web-push-env.mjs https://crm.example.com /private/path/push.env');
  }
  const origin = new URL(originArgument);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port ||
      origin.pathname !== '/' || origin.search || origin.hash ||
      origin.hostname === 'localhost' || origin.hostname.endsWith('.localhost') ||
      origin.hostname.endsWith('.local') || /^[\d.]+$/.test(origin.hostname) || origin.hostname.includes(':')) {
    throw new Error('Use the confirmed public HTTPS origin without a path, credentials or port.');
  }
  output = resolve(outputArgument);
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  const contents = [
    'WEB_PUSH_ENABLED=true',
    `WEB_PUSH_VAPID_PUBLIC_KEY=${pair.getPublicKey().toString('base64url')}`,
    `WEB_PUSH_VAPID_PRIVATE_KEY=${pair.getPrivateKey().toString('base64url')}`,
    `WEB_PUSH_VAPID_SUBJECT=${origin.origin}/settings/notifications`,
    '',
  ].join('\n');
  const file = await open(output, 'wx', 0o600);
  created = true;
  try { await file.writeFile(contents); } finally { await file.close(); }
  console.log(`Private Web Push configuration prepared: ${output}`);
  console.log('Keep any already deployed valid key pair; this file is not a key-rotation instruction.');
} catch (error) {
  if (created && output) await unlink(output).catch(() => {});
  console.error(error instanceof Error ? error.message : 'Could not prepare Web Push configuration.');
  process.exitCode = 1;
}
