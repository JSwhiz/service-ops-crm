import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { IncomingMessage, Server as HttpServer } from 'node:http';
import { Socket } from 'node:net';
import type { RedisClientType } from 'redis';

import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users-access/users.service';

import { CHAT_REDIS_CHANNEL } from './constants/chat.constants';

export interface ChatRealtimeEvent {
  type:
    | 'chat.message_created'
    | 'chat.message_updated'
    | 'chat.room_created'
    | 'chat.room_updated'
    | 'chat.room_read'
    | 'chat.room_hidden'
    | 'chat.room_left'
    | 'chat.room_closed';
  roomId: string;
  recipientUserIds: string[];
  payload: Record<string, unknown>;
}

interface RealtimeClient {
  userId: string;
  socket: Socket;
}

@Injectable()
export class ChatRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private readonly clients = new Set<RealtimeClient>();
  private subscriber: ReturnType<RedisClientType['duplicate']> | null = null;
  private isAttached = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redisService.getClient().duplicate();
    await this.subscriber.connect();
    await this.subscriber.subscribe(CHAT_REDIS_CHANNEL, (message) => {
      this.handleRedisEvent(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const client of this.clients) {
      client.socket.end();
    }
    this.clients.clear();

    if (this.subscriber?.isOpen) {
      await this.subscriber.quit();
    }
  }

  attachToServer(server: HttpServer): void {
    if (this.isAttached) {
      return;
    }

    this.isAttached = true;

    server.on('upgrade', (request, socket) => {
      const url = new URL(request.url ?? '', 'http://localhost');

      if (url.pathname !== '/api/v1/chats/realtime') {
        return;
      }

      void this.handleUpgrade(request, socket as Socket);
    });
  }

  async publish(event: ChatRealtimeEvent): Promise<void> {
    await this.redisService
      .getClient()
      .publish(CHAT_REDIS_CHANNEL, JSON.stringify(event));
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Socket,
  ): Promise<void> {
    try {
      const user = await this.authenticateRequest(request);
      const key = request.headers['sec-websocket-key'];

      if (!key || Array.isArray(key)) {
        socket.destroy();
        return;
      }

      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );

      const client: RealtimeClient = {
        userId: user.id,
        socket,
      };
      this.clients.add(client);
      this.send(client, {
        type: 'chat.connected',
        payload: {
          userId: user.id,
        },
      });

      socket.on('data', (chunk) => {
        const firstByte = chunk[0];

        if (firstByte !== undefined && (firstByte & 0x0f) === 8) {
          socket.end();
        }
      });
      socket.on('close', () => this.clients.delete(client));
      socket.on('error', () => this.clients.delete(client));
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        this.logger.warn(
          `Chat realtime upgrade failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      socket.destroy();
    }
  }

  private async authenticateRequest(request: IncomingMessage): Promise<{
    id: string;
  }> {
    const url = new URL(request.url ?? '', 'http://localhost');
    const authHeader = request.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : null;
    const token =
      url.searchParams.get('token') ??
      bearerToken ??
      this.getCookieValue(request.headers.cookie, ACCESS_TOKEN_COOKIE);

    if (!token) {
      throw new UnauthorizedException('Missing realtime auth token');
    }

    const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Realtime user is not available');
    }

    return {
      id: user.id,
    };
  }

  private handleRedisEvent(message: string): void {
    try {
      const event = JSON.parse(message) as ChatRealtimeEvent;
      const recipients = new Set(event.recipientUserIds);

      for (const client of this.clients) {
        if (recipients.has(client.userId)) {
          this.send(client, event);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Invalid chat realtime event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private send(client: RealtimeClient, payload: unknown): void {
    if (client.socket.destroyed || !client.socket.writable) {
      this.clients.delete(client);
      return;
    }

    client.socket.write(this.encodeFrame(JSON.stringify(payload)));
  }

  private encodeFrame(message: string): Buffer {
    const body = Buffer.from(message);

    if (body.length < 126) {
      return Buffer.concat([Buffer.from([0x81, body.length]), body]);
    }

    if (body.length < 65536) {
      const header = Buffer.allocUnsafe(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
      return Buffer.concat([header, body]);
    }

    const header = Buffer.allocUnsafe(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
    return Buffer.concat([header, body]);
  }

  private getCookieValue(
    cookieHeader: string | undefined,
    name: string,
  ): string | null {
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';');

    for (const cookie of cookies) {
      const [rawKey, ...rawValueParts] = cookie.trim().split('=');

      if (rawKey === name) {
        return decodeURIComponent(rawValueParts.join('='));
      }
    }

    return null;
  }
}
