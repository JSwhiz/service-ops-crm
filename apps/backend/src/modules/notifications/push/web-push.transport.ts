import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as webPush from 'web-push';
import type { WebPushConfig } from './web-push.config';

export const WEB_PUSH_TRANSPORT = Symbol('WEB_PUSH_TRANSPORT');
export interface PushAddress { endpoint: string; p256dh: string; auth: string }
export interface PushTransport {
  send(address: PushAddress, deliveryId: string, config: WebPushConfig): Promise<void>;
}

@Injectable()
export class WebPushTransport implements PushTransport {
  protected request = webPush.sendNotification;
  async send(address: PushAddress, deliveryId: string, config: WebPushConfig): Promise<void> {
    // Never include domain data, recipient name, title, amounts, reason or target URL.
    await this.request({ endpoint: address.endpoint, keys: { p256dh: address.p256dh, auth: address.auth } }, JSON.stringify({ deliveryId }), {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      contentEncoding: 'aes128gcm', TTL: 60, urgency: 'normal', timeout: 8_000,
      topic: createHash('sha256').update(deliveryId).digest('base64url').slice(0, 32),
    });
  }
}
