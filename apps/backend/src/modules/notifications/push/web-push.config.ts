import { createECDH, createPublicKey } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';

export interface WebPushConfig { publicKey: string; privateKey: string; subject: string }

export function readWebPushConfig(config: Pick<ConfigService, 'get'>): WebPushConfig | null {
  if (config.get<string>('WEB_PUSH_ENABLED') !== 'true') return null;
  const publicKey = config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '';
  const privateKey = config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '';
  const subject = config.get<string>('WEB_PUSH_VAPID_SUBJECT') ?? '';
  try {
    const bytes = Buffer.from(publicKey, 'base64url');
    if (bytes.length !== 65 || bytes[0] !== 4 || Buffer.from(privateKey, 'base64url').length !== 32) return null;
    const pair = createECDH('prime256v1');
    pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (!pair.getPublicKey().equals(bytes)) return null;
    createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url') }, format: 'jwk' });
    const url = new URL(subject);
    if (!['mailto:', 'https:'].includes(url.protocol) || !url.pathname) return null;
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

/** Restrict client-supplied capability URLs to supported public push services.
 * No user-provided host override, credentials, port, redirect or local endpoint. */
export function isSupportedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return value === url.href && url.protocol === 'https:' && !url.username && !url.password
      && !url.port && !url.hash && url.pathname !== '/'
      && (url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com')
        || url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com');
  } catch { return false; }
}

export function validateSubscriptionKeys(p256dh: string, auth: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) return false;
  const key = Buffer.from(p256dh, 'base64url');
  if (key.length !== 65 || key[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) return false;
  try {
    createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.subarray(1, 33).toString('base64url'), y: key.subarray(33).toString('base64url') }, format: 'jwk' });
    return true;
  } catch { return false; }
}
