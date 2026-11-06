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
import { PrismaService } from '../prisma/prisma.service';
import { decideAccess } from '../users-access/utils/access-policy.util';
import { resourceAccessTarget } from '../../common/access/resource-access-context';
import { notificationAccessWhere } from '../../common/access/notification-access';
import { hasOperationalChatRole, isChatLeadership, isObjectsChatDenied } from './utils/chat-access.util';

import { CHAT_REDIS_CHANNEL } from './constants/chat.constants';

export interface ChatRealtimeEvent {
  type:
    | 'chat.message_created'
    | 'chat.message_updated'
    | 'chat.room_created'
    | 'chat.room_updated'
    | 'chat.room_read'
    | 'chat.room_hidden'
    | 'chat.room_unhidden'
    | 'chat.room_left'
    | 'chat.room_closed';
  roomId: string;
  recipientUserIds: string[];
  payload: Record<string, unknown>;
}

export interface NotificationRealtimeEvent {
  type: 'notification.created';
  recipientUserIds: string[];
  payload: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    entityType: string | null;
    entityId: string | null;
    targetUrl: string | null;
    readAt: null;
    createdAt: string;
  };
}

export type RealtimeEvent = ChatRealtimeEvent | NotificationRealtimeEvent;

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
  private deliveryQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redisService.getClient().duplicate();
    await this.subscriber.connect();
    await this.subscriber.subscribe(CHAT_REDIS_CHANNEL, (message) => {
      // Async permission checks must preserve Redis event order.
      this.deliveryQueue = this.deliveryQueue.then(() => this.handleRedisEvent(message)).catch((error) => {
        this.logger.warn(`Realtime delivery skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
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

  async publish(event: RealtimeEvent): Promise<void> {
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

  private async handleRedisEvent(message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      const recipients = new Set(event.recipientUserIds);

      for (const client of this.clients) {
        if (recipients.has(client.userId) && await this.canDeliver(client.userId, event)) {
          this.send(client, event);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Invalid chat realtime event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async canDeliver(userId: string, event: RealtimeEvent): Promise<boolean> {
    const record = await this.usersService.findById(userId);
    if (!record?.isActive) return false;
    // Never trust the JWT or a recipient list produced before a revocation.
    const subject = this.usersService.sanitizeUser(record);
    if (event.type === 'notification.created') {
      const stillVisible = await this.prisma.notification.findFirst({ where: {
        AND: [await notificationAccessWhere(this.prisma, userId, 'notifications.realtime'), { id: event.payload.id }],
      }, select: { id: true } });
      if (!stillVisible) return false;
      const target = event.payload.entityType && event.payload.entityId
        ? await resourceAccessTarget(this.prisma, event.payload.entityType, event.payload.entityId) : null;
      if (target && !decideAccess(subject, target.actionCode, true, target.context)) return false;
      return decideAccess(subject, 'notifications.read', true, {
        resourceType: 'notification', resourceId: event.payload.id, ownerUserId: userId,
        parents: target ? [target] : [],
      }) && decideAccess(subject, 'notifications.realtime', true, {
        resourceType: 'notification', resourceId: event.payload.id, ownerUserId: userId,
        parents: target ? [target] : [],
      });
    }
    const room = await this.prisma.chatRoom.findUnique({ where: { id: event.roomId }, select: {
      id: true, deletedAt: true, createdByUserId: true, visibilityType: true,
      participants: { where: { leftAt: null }, select: { userId: true } },
    } });
    if (!room) return false;
    const assignedUserIds = room.participants.map(participant => participant.userId);
    let eligible = false;
    switch (room.visibilityType) {
      case 'explicit_members': eligible = assignedUserIds.includes(userId); break;
      case 'leadership_only': eligible = isChatLeadership(subject.roleCodes); break;
      case 'objects_scope': eligible = !isObjectsChatDenied(subject.roleCodes) && (hasOperationalChatRole(subject.roleCodes) || !!await this.prisma.objectAssignment.findFirst({ where: { userId, isActive: true }, select: { id: true } })); break;
      case 'one_time_orders_scope': eligible = hasOperationalChatRole(subject.roleCodes) || !!await this.prisma.oneTimeOrderAssignment.findFirst({ where: { userId, isActive: true, assignmentRoleCode: 'one_time_manager' }, select: { id: true } }); break;
    }
    // A grant does not fabricate explicit membership or reopen a closed room.
    const context = { resourceType: 'chat_room', resourceId: room.id,
      ownerUserId: room.createdByUserId ?? undefined, assignedUserIds,
      invariantAllowed: eligible && (!room.deletedAt || event.type === 'chat.room_closed'),
      parents: room.visibilityType === 'objects_scope' ? [{ actionCode: 'objects.access', context: {} }]
        : room.visibilityType === 'one_time_orders_scope' ? [{ actionCode: 'one_time_orders.access', context: {} }] : [],
    };
    return decideAccess(subject, 'chat.read', eligible, context) &&
      decideAccess(subject, 'chat.messages.read', eligible, context) && decideAccess(subject, 'chat.realtime', eligible, context);
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
