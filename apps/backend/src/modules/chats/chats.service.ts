import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { FileResponseDto } from '../files/dto/file-response.dto';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';

import { AddChatParticipantsDto } from './dto/add-chat-participants.dto';
import {
  ChatMessageResponseDto,
  ChatRoomParticipantResponseDto,
  ChatRoomResponseDto,
} from './dto/chat-response.dto';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';
import { EditChatMessageDto } from './dto/edit-chat-message.dto';
import { MarkChatRoomReadDto } from './dto/mark-chat-room-read.dto';
import { RenameChatRoomDto } from './dto/rename-chat-room.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatRealtimeService } from './chat-realtime.service';
import {
  CHAT_MESSAGE_EDIT_WINDOW_MS,
  CHAT_MESSAGE_FILE_ENTITY_TYPE,
  DEFAULT_CHAT_ROOMS,
} from './constants/chat.constants';
import type {
  ChatParticipantRole,
  ChatRoomCode,
  ChatVisibilityType,
  CurrentAuthUser,
} from './types/chat.types';
import {
  CHAT_LEADERSHIP_ROLE_CODES,
  CHAT_OPERATIONAL_ROLE_CODES,
  canManageChats,
  hasOperationalChatRole,
  isChatLeadership,
} from './utils/chat-access.util';

interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type ChatRoomRecord = {
  id: string;
  code: string | null;
  title: string;
  roomType: string;
  visibilityType: string;
  createdByUserId: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
};

type ChatParticipantRecord = {
  id: string;
  chatRoomId: string;
  userId: string;
  roleInRoom: string;
  joinedAt: Date;
  lastReadAt: Date | null;
};

type ChatMessageRecord = {
  id: string;
  chatRoomId: string;
  authorUserId: string | null;
  messageType: string;
  text: string | null;
  metadata: Prisma.JsonValue | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    login: string;
    fullName: string;
  } | null;
};

@Injectable()
export class ChatsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
    private readonly auditService: AuditService,
    private readonly realtimeService: ChatRealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultRooms();
  }

  async listRooms(currentUser: CurrentAuthUser): Promise<ChatRoomResponseDto[]> {
    await this.ensureDefaultRooms();

    const rooms = await this.prisma.chatRoom.findMany({
      orderBy: [
        {
          lastMessageAt: 'desc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });

    const visibleRooms: ChatRoomResponseDto[] = [];

    for (const room of rooms) {
      if (!(await this.canAccessRoom(currentUser, room))) {
        continue;
      }

      const participant = await this.ensureParticipantForAccessibleRoom(
        currentUser,
        room,
      );

      visibleRooms.push(await this.mapRoom(currentUser, room, participant));
    }

    return visibleRooms;
  }

  async getRoomByCode(
    currentUser: CurrentAuthUser,
    code: ChatRoomCode,
  ): Promise<ChatRoomResponseDto> {
    await this.ensureDefaultRooms();

    const room = await this.prisma.chatRoom.findUnique({
      where: { code },
    });

    if (!room || !(await this.canAccessRoom(currentUser, room))) {
      throw new NotFoundException('Chat room not found');
    }

    const participant = await this.ensureParticipantForAccessibleRoom(
      currentUser,
      room,
    );

    return this.mapRoom(currentUser, room, participant);
  }

  async createRoom(
    currentUser: CurrentAuthUser,
    dto: CreateChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    this.assertCanManageChats(currentUser);

    const participantIds = this.dedupeUserIds([
      currentUser.id,
      ...(dto.participantUserIds ?? []),
    ]);
    await this.assertActiveUsersExist(participantIds);

    const room = await this.prisma.chatRoom.create({
      data: {
        title: dto.title.trim(),
        roomType: 'custom',
        visibilityType: 'explicit_members',
        createdByUserId: currentUser.id,
        participants: {
          create: participantIds.map((userId) => ({
            userId,
            roleInRoom: userId === currentUser.id ? 'admin' : 'member',
            joinedAt: new Date(),
          })),
        },
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.created',
      newValues: {
        title: room.title,
        participantUserIds: participantIds,
      },
    });

    await this.publishRoomUpdate(room);

    const participant = await this.ensureParticipantForAccessibleRoom(
      currentUser,
      room,
    );

    return this.mapRoom(currentUser, room, participant);
  }

  async renameRoom(
    currentUser: CurrentAuthUser,
    roomId: string,
    dto: RenameChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    const room = await this.getRoomRecord(roomId);
    await this.assertCanManageRoom(currentUser, room);

    const updated = await this.prisma.chatRoom.update({
      where: { id: room.id },
      data: { title: dto.title.trim() },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.renamed',
      oldValues: { title: room.title },
      newValues: { title: updated.title },
    });

    await this.publishRoomUpdate(updated);

    const participant = await this.ensureParticipantForAccessibleRoom(
      currentUser,
      updated,
    );

    return this.mapRoom(currentUser, updated, participant);
  }

  async addParticipants(
    currentUser: CurrentAuthUser,
    roomId: string,
    dto: AddChatParticipantsDto,
  ): Promise<ChatRoomResponseDto> {
    const room = await this.getRoomRecord(roomId);
    await this.assertCanManageRoom(currentUser, room);

    if (room.visibilityType !== 'explicit_members') {
      throw new BadRequestException(
        'Participants can be manually managed only for custom chats',
      );
    }

    const userIds = this.dedupeUserIds(dto.userIds);
    await this.assertActiveUsersExist(userIds);

    const joinedAt = new Date();
    await this.prisma.$transaction(
      userIds.map((userId) =>
        this.prisma.chatRoomParticipant.upsert({
          where: {
            chatRoomId_userId: {
              chatRoomId: room.id,
              userId,
            },
          },
          create: {
            chatRoomId: room.id,
            userId,
            roleInRoom: 'member',
            joinedAt,
          },
          update: {},
        }),
      ),
    );

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.participants_added',
      newValues: { userIds },
    });

    const updated = await this.getRoomRecord(room.id);
    await this.publishRoomUpdate(updated);

    const participant = await this.ensureParticipantForAccessibleRoom(
      currentUser,
      updated,
    );

    return this.mapRoom(currentUser, updated, participant);
  }

  async listParticipants(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<ChatRoomParticipantResponseDto[]> {
    const room = await this.getRoomRecord(roomId);
    await this.assertCanReadRoom(currentUser, room);

    const participants = await this.prisma.chatRoomParticipant.findMany({
      where: { chatRoomId: room.id },
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
      orderBy: [
        {
          roleInRoom: 'asc',
        },
        {
          joinedAt: 'asc',
        },
      ],
    });

    return participants.map((participant) => ({
      id: participant.id,
      roleInRoom: participant.roleInRoom,
      joinedAt: participant.joinedAt.toISOString(),
      lastReadAt: participant.lastReadAt?.toISOString() ?? null,
      user: {
        id: participant.user.id,
        login: participant.user.login,
        fullName: participant.user.fullName,
      },
    }));
  }

  async listMessages(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<ChatMessageResponseDto[]> {
    const room = await this.getRoomRecord(roomId);
    const participant = await this.assertCanReadRoom(currentUser, room);

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        chatRoomId: room.id,
        createdAt: {
          gte: participant.joinedAt,
        },
      },
      include: {
        author: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 300,
    });

    return Promise.all(
      messages.map((message) => this.mapMessage(currentUser, message)),
    );
  }

  async sendMessage(
    currentUser: CurrentAuthUser,
    roomId: string,
    dto: SendChatMessageDto,
    files: UploadedFilePayload[] = [],
  ): Promise<ChatMessageResponseDto> {
    const room = await this.getRoomRecord(roomId);
    await this.assertCanWriteRoom(currentUser, room);

    const text = dto.text?.trim() || null;

    if (!text && files.length === 0) {
      throw new BadRequestException('Message text or attachment is required');
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        chatRoomId: room.id,
        authorUserId: currentUser.id,
        messageType: 'user',
        text,
      },
      include: {
        author: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    for (const file of files) {
      await this.filesService.upload(
        currentUser,
        {
          entityType: CHAT_MESSAGE_FILE_ENTITY_TYPE,
          entityId: message.id,
        },
        file,
      );
    }

    await this.updateRoomLastMessage(room.id, this.buildMessagePreview(text, files));

    const mapped = await this.mapMessage(currentUser, message);
    await this.publishMessageEvent(room.id, 'chat.message_created', mapped);

    return mapped;
  }

  async editMessage(
    currentUser: CurrentAuthUser,
    messageId: string,
    dto: EditChatMessageDto,
  ): Promise<ChatMessageResponseDto> {
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId },
      include: {
        chatRoom: true,
        author: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Chat message not found');
    }

    await this.assertCanReadRoom(currentUser, message.chatRoom);

    if (message.messageType !== 'user' || message.authorUserId !== currentUser.id) {
      throw new ForbiddenException('Only message author can edit this message');
    }

    if (Date.now() - message.createdAt.getTime() > CHAT_MESSAGE_EDIT_WINDOW_MS) {
      throw new ForbiddenException('Message edit window has expired');
    }

    const updated = await this.prisma.chatMessage.update({
      where: { id: message.id },
      data: {
        text: dto.text.trim(),
        editedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    if (message.chatRoom.lastMessageAt?.getTime() === message.createdAt.getTime()) {
      await this.updateRoomLastMessage(
        message.chatRoomId,
        this.buildMessagePreview(updated.text, []),
      );
    }

    const mapped = await this.mapMessage(currentUser, updated);
    await this.publishMessageEvent(
      message.chatRoomId,
      'chat.message_updated',
      mapped,
    );

    return mapped;
  }

  async markRead(
    currentUser: CurrentAuthUser,
    roomId: string,
    dto: MarkChatRoomReadDto,
  ): Promise<ChatRoomResponseDto> {
    const room = await this.getRoomRecord(roomId);
    const participant = await this.assertCanReadRoom(currentUser, room);

    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: dto.lastReadMessageId,
        chatRoomId: room.id,
        createdAt: {
          gte: participant.joinedAt,
        },
      },
      select: {
        createdAt: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Chat message not found');
    }

    const lastReadAt =
      participant.lastReadAt && participant.lastReadAt > message.createdAt
        ? participant.lastReadAt
        : message.createdAt;

    const updatedParticipant = await this.prisma.chatRoomParticipant.update({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: currentUser.id,
        },
      },
      data: {
        lastReadAt,
      },
    });

    await this.realtimeService.publish({
      type: 'chat.room_read',
      roomId: room.id,
      recipientUserIds: [currentUser.id],
      payload: {
        roomId: room.id,
        lastReadAt: lastReadAt.toISOString(),
      },
    });

    return this.mapRoom(currentUser, room, updatedParticipant);
  }

  async createSystemMessage(
    roomCode: ChatRoomCode,
    text: string,
    metadata?: Record<string, unknown>,
    actorUserId?: string | null,
  ): Promise<void> {
    await this.ensureDefaultRooms();

    const room = await this.prisma.chatRoom.findUnique({
      where: { code: roomCode },
    });

    if (!room) {
      return;
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        chatRoomId: room.id,
        authorUserId: null,
        messageType: 'system',
        text,
        metadata: metadata ? (metadata as Prisma.InputJsonObject) : undefined,
      },
      include: {
        author: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    await this.updateRoomLastMessage(room.id, text);

    const auditNewValues: Prisma.InputJsonObject = {
      code: roomCode,
      text,
      metadata: metadata ? (metadata as Prisma.InputJsonObject) : null,
    };

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: actorUserId ?? null,
      action: 'chat.system_message.created',
      newValues: auditNewValues,
    });

    const recipientUserIds = await this.loadRecipientUserIds(room);
    const mapped = await this.mapMessageForBroadcast(message);

    await this.realtimeService.publish({
      type: 'chat.message_created',
      roomId: room.id,
      recipientUserIds,
      payload: mapped as unknown as Record<string, unknown>,
    });
  }

  async canAccessChatMessage(
    currentUser: CurrentAuthUser,
    messageId: string,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId },
      include: {
        chatRoom: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Chat attachment target message not found');
    }

    if (!(await this.canAccessRoom(currentUser, message.chatRoom))) {
      return false;
    }

    if (mode === 'read') {
      const participant = await this.ensureParticipantForAccessibleRoom(
        currentUser,
        message.chatRoom,
      );

      return message.createdAt >= participant.joinedAt;
    }

    return message.authorUserId === currentUser.id || canManageChats(this.getRoleCodes(currentUser));
  }

  private async ensureDefaultRooms(): Promise<void> {
    for (const room of DEFAULT_CHAT_ROOMS) {
      await this.prisma.chatRoom.upsert({
        where: { code: room.code },
        create: {
          code: room.code,
          title: room.title,
          roomType: 'system_default',
          visibilityType: room.visibilityType,
        },
        update: {
          visibilityType: room.visibilityType,
          roomType: 'system_default',
        },
      });
    }
  }

  private async getRoomRecord(roomId: string): Promise<ChatRoomRecord> {
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('Chat room not found');
    }

    return room;
  }

  private async assertCanReadRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<ChatParticipantRecord> {
    if (!(await this.canAccessRoom(currentUser, room))) {
      throw new ForbiddenException('Chat room access denied');
    }

    return this.ensureParticipantForAccessibleRoom(currentUser, room);
  }

  private async assertCanWriteRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<void> {
    if (!(await this.canWriteRoom(currentUser, room))) {
      throw new ForbiddenException('Chat message write denied');
    }
  }

  private assertCanManageChats(currentUser: CurrentAuthUser): void {
    if (!canManageChats(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Chat admin access denied');
    }
  }

  private async assertCanManageRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<void> {
    if (!(await this.canManageRoom(currentUser, room))) {
      throw new ForbiddenException('Chat admin access denied');
    }
  }

  private async canAccessRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    switch (room.visibilityType as ChatVisibilityType) {
      case 'leadership_only':
        return isChatLeadership(roleCodes);
      case 'objects_scope':
        return (
          hasOperationalChatRole(roleCodes) ||
          (await this.hasActiveObjectAssignment(currentUser.id))
        );
      case 'one_time_orders_scope':
        return (
          hasOperationalChatRole(roleCodes) ||
          (await this.hasActiveOneTimeOrderManagerAssignment(currentUser.id))
        );
      case 'explicit_members':
        return this.hasParticipant(room.id, currentUser.id);
    }
  }

  private async canWriteRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<boolean> {
    return this.canAccessRoom(currentUser, room);
  }

  private async canManageRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (canManageChats(roleCodes)) {
      return true;
    }

    if (room.visibilityType !== 'explicit_members') {
      return false;
    }

    const participant = await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: currentUser.id,
        },
      },
      select: {
        roleInRoom: true,
      },
    });

    return participant?.roleInRoom === 'admin';
  }

  private async ensureParticipantForAccessibleRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<ChatParticipantRecord> {
    const existing = await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: currentUser.id,
        },
      },
    });

    if (existing) {
      return existing;
    }

    if (room.visibilityType === 'explicit_members') {
      throw new ForbiddenException('Chat participant not found');
    }

    const roleInRoom: ChatParticipantRole =
      canManageChats(this.getRoleCodes(currentUser)) ? 'admin' : 'member';

    return this.prisma.chatRoomParticipant.create({
      data: {
        chatRoomId: room.id,
        userId: currentUser.id,
        roleInRoom,
        joinedAt: new Date(0),
      },
    });
  }

  private async mapRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
    participant: ChatParticipantRecord,
  ): Promise<ChatRoomResponseDto> {
    const participantCount = await this.prisma.chatRoomParticipant.count({
      where: { chatRoomId: room.id },
    });
    const unreadThreshold = participant.lastReadAt ?? participant.joinedAt;
    const unreadCount = await this.prisma.chatMessage.count({
      where: {
        chatRoomId: room.id,
        createdAt: {
          gt: unreadThreshold,
        },
        OR: [
          {
            authorUserId: {
              not: currentUser.id,
            },
          },
          {
            authorUserId: null,
          },
        ],
      },
    });

    return {
      id: room.id,
      code: room.code,
      title: room.title,
      roomType: room.roomType,
      visibilityType: room.visibilityType,
      lastMessageAt: room.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: room.lastMessagePreview,
      unreadCount,
      participantCount,
      capabilities: {
        canWrite: await this.canWriteRoom(currentUser, room),
        canManage: await this.canManageRoom(currentUser, room),
      },
    };
  }

  private async mapMessage(
    currentUser: CurrentAuthUser,
    message: ChatMessageRecord,
  ): Promise<ChatMessageResponseDto> {
    const attachments = await this.loadMessageAttachments(message.id);

    return {
      id: message.id,
      chatRoomId: message.chatRoomId,
      messageType: message.messageType,
      text: message.text,
      metadata: this.mapJsonObject(message.metadata),
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      author: message.author
        ? {
            id: message.author.id,
            login: message.author.login,
            fullName: message.author.fullName,
          }
        : null,
      attachments,
      capabilities: {
        canEdit:
          message.messageType === 'user' &&
          message.authorUserId === currentUser.id &&
          Date.now() - message.createdAt.getTime() <=
            CHAT_MESSAGE_EDIT_WINDOW_MS,
      },
    };
  }

  private async mapMessageForBroadcast(
    message: ChatMessageRecord,
  ): Promise<ChatMessageResponseDto> {
    return this.mapMessage(
      {
        id: '',
        login: '',
        fullName: '',
        roleCode: 'unknown',
        roleCodes: [],
        permissionCodes: [],
        isActive: true,
      },
      message,
    );
  }

  private async loadMessageAttachments(
    messageId: string,
  ): Promise<FileResponseDto[]> {
    const attachments = await this.prisma.fileAttachment.findMany({
      where: {
        entityType: CHAT_MESSAGE_FILE_ENTITY_TYPE,
        entityId: messageId,
        file: {
          deletedAt: null,
        },
      },
      include: {
        file: {
          include: {
            attachments: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return attachments.map((attachment) => ({
      id: attachment.file.id,
      bucket: attachment.file.bucket,
      objectKey: attachment.file.objectKey,
      originalName: attachment.file.originalName,
      mimeType: attachment.file.mimeType,
      sizeBytes: attachment.file.sizeBytes,
      uploadedByUserId: attachment.file.uploadedByUserId,
      createdAt: attachment.file.createdAt.toISOString(),
      url: `/api/v1/files/${attachment.file.id}/content`,
      attachments: attachment.file.attachments.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        fieldCode: item.fieldCode,
        uploadedByUserId: item.uploadedByUserId,
        createdAt: item.createdAt.toISOString(),
      })),
    }));
  }

  private async publishMessageEvent(
    roomId: string,
    type: 'chat.message_created' | 'chat.message_updated',
    message: ChatMessageResponseDto,
  ): Promise<void> {
    const room = await this.getRoomRecord(roomId);
    const recipientUserIds = await this.loadRecipientUserIds(room);

    await this.realtimeService.publish({
      type,
      roomId,
      recipientUserIds,
      payload: message as unknown as Record<string, unknown>,
    });

    await this.publishRoomUpdate(room);
  }

  private async publishRoomUpdate(room: ChatRoomRecord): Promise<void> {
    const recipientUserIds = await this.loadRecipientUserIds(room);

    await this.realtimeService.publish({
      type: 'chat.room_updated',
      roomId: room.id,
      recipientUserIds,
      payload: {
        roomId: room.id,
      },
    });
  }

  private async loadRecipientUserIds(room: ChatRoomRecord): Promise<string[]> {
    switch (room.visibilityType as ChatVisibilityType) {
      case 'leadership_only':
        return this.loadUserIdsByRoles(CHAT_LEADERSHIP_ROLE_CODES);
      case 'objects_scope':
        return this.loadOperationalObjectChatUserIds();
      case 'one_time_orders_scope':
        return this.loadOperationalOrderChatUserIds();
      case 'explicit_members': {
        const participants = await this.prisma.chatRoomParticipant.findMany({
          where: { chatRoomId: room.id },
          select: { userId: true },
        });
        return participants.map((participant) => participant.userId);
      }
    }
  }

  private async updateRoomLastMessage(
    roomId: string,
    preview: string,
  ): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: preview,
      },
    });
  }

  private buildMessagePreview(
    text: string | null,
    files: UploadedFilePayload[],
  ): string {
    if (text) {
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }

    if (files.length > 0) {
      return files.length === 1 ? 'Вложение' : `Вложения: ${files.length}`;
    }

    return 'Сообщение';
  }

  private async hasParticipant(roomId: string, userId: string): Promise<boolean> {
    const participant = await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: roomId,
          userId,
        },
      },
      select: { id: true },
    });

    return !!participant;
  }

  private async hasActiveObjectAssignment(userId: string): Promise<boolean> {
    const count = await this.prisma.objectAssignment.count({
      where: {
        userId,
        isActive: true,
      },
    });

    return count > 0;
  }

  private async hasActiveOneTimeOrderManagerAssignment(
    userId: string,
  ): Promise<boolean> {
    const count = await this.prisma.oneTimeOrderAssignment.count({
      where: {
        userId,
        isActive: true,
        assignmentRoleCode: 'one_time_manager',
      },
    });

    return count > 0;
  }

  private async loadUserIdsByRoles(
    roleCodes: readonly string[],
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        roles: {
          some: {
            role: {
              code: {
                in: [...roleCodes],
              },
            },
          },
        },
      },
      select: { id: true },
    });

    return users.map((user) => user.id);
  }

  private async loadOperationalObjectChatUserIds(): Promise<string[]> {
    const [roleUsers, assignedUsers] = await Promise.all([
      this.loadUserIdsByRoles(CHAT_OPERATIONAL_ROLE_CODES),
      this.prisma.objectAssignment.findMany({
        where: { isActive: true },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    return Array.from(
      new Set([...roleUsers, ...assignedUsers.map((item) => item.userId)]),
    );
  }

  private async loadOperationalOrderChatUserIds(): Promise<string[]> {
    const [roleUsers, assignedUsers] = await Promise.all([
      this.loadUserIdsByRoles(CHAT_OPERATIONAL_ROLE_CODES),
      this.prisma.oneTimeOrderAssignment.findMany({
        where: {
          isActive: true,
          assignmentRoleCode: 'one_time_manager',
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    return Array.from(
      new Set([...roleUsers, ...assignedUsers.map((item) => item.userId)]),
    );
  }

  private async assertActiveUsersExist(userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const existingUsers = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    const existingUserIds = new Set(existingUsers.map((user) => user.id));
    const missingUserIds = userIds.filter((userId) => !existingUserIds.has(userId));

    if (missingUserIds.length > 0) {
      throw new BadRequestException('Some chat participants are not active users');
    }
  }

  private dedupeUserIds(userIds: string[]): string[] {
    return Array.from(
      new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
    );
  }

  private getRoleCodes(currentUser: CurrentAuthUser): string[] {
    if (Array.isArray(currentUser.roleCodes) && currentUser.roleCodes.length > 0) {
      return currentUser.roleCodes;
    }

    return currentUser.roleCode ? [currentUser.roleCode] : [];
  }

  private mapJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }
}
