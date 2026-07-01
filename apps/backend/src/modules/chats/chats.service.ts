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
import { CloseChatRoomDto } from './dto/close-chat-room.dto';
import {
  ChatMessageResponseDto,
  ChatRoomParticipantResponseDto,
  ChatRoomResponseDto,
} from './dto/chat-response.dto';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';
import { EditChatMessageDto } from './dto/edit-chat-message.dto';
import { ForwardChatMessageDto } from './dto/forward-chat-message.dto';
import { MarkChatRoomReadDto } from './dto/mark-chat-room-read.dto';
import { RenameChatRoomDto } from './dto/rename-chat-room.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatSearchResponseDto } from './dto/chat-search-response.dto';
import { ChatRealtimeService } from './chat-realtime.service';
import {
  CHAT_MESSAGE_EDIT_WINDOW_MS,
  CHAT_MESSAGE_FILE_ENTITY_TYPE,
  DEFAULT_CHAT_ROOMS,
} from './constants/chat.constants';
import type {
  ChatParticipantRole,
  ChatRoomType,
  ChatRoomCode,
  ChatVisibilityType,
  CurrentAuthUser,
} from './types/chat.types';
import {
  CHAT_LEADERSHIP_ROLE_CODES,
  CHAT_OPERATIONAL_ROLE_CODES,
  canCloseChatGlobally,
  canCreateDirectChat,
  canCreateGroupChat,
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
  directKey: string | null;
  createdByUserId: string | null;
  deletedByUserId: string | null;
  deletedAt: Date | null;
  deleteReason: string | null;
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
  hiddenAt: Date | null;
  leftAt: Date | null;
};

type ChatMessageRecord = {
  id: string;
  chatRoomId: string;
  authorUserId: string | null;
  messageType: string;
  text: string | null;
  metadata: Prisma.JsonValue | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
  replyToMessageId: string | null;
  forwardedFromMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    login: string;
    fullName: string;
  } | null;
};

type ChatRoomsView = 'active' | 'archived';

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

  async listRooms(
    currentUser: CurrentAuthUser,
    view: string = 'active',
  ): Promise<ChatRoomResponseDto[]> {
    await this.ensureDefaultRooms();

    if (view !== 'active' && view !== 'archived') {
      throw new BadRequestException('Unsupported chat rooms view');
    }

    const roomsView = view as ChatRoomsView;
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        deletedAt: null,
      },
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

      if (!this.shouldIncludeRoomInView(room, participant, roomsView)) {
        continue;
      }

      visibleRooms.push(await this.mapRoom(currentUser, room, participant));
    }

    return visibleRooms;
  }

  async search(
    currentUser: CurrentAuthUser,
    rawQuery: string,
  ): Promise<ChatSearchResponseDto> {
    const query = rawQuery.trim();

    if (query.length < 2) {
      return { rooms: [], messages: [] };
    }

    const normalizedQuery = query.toLocaleLowerCase('ru-RU');
    const visibleRooms = await this.listRooms(currentUser, 'active');
    const rooms = visibleRooms
      .filter((room) =>
        `${room.displayTitle} ${room.title}`
          .toLocaleLowerCase('ru-RU')
          .includes(normalizedQuery),
      )
      .slice(0, 20)
      .map((room) => ({
        id: room.id,
        title: room.title,
        displayTitle: room.displayTitle,
        roomType: room.roomType,
        lastMessagePreview: room.lastMessagePreview,
      }));

    const candidates = await this.prisma.chatMessage.findMany({
      where: {
        deletedAt: null,
        text: {
          contains: query,
          mode: 'insensitive',
        },
        chatRoom: {
          deletedAt: null,
        },
      },
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const messages: ChatSearchResponseDto['messages'] = [];

    for (const message of candidates) {
      if (messages.length >= 20) {
        break;
      }

      if (!(await this.canAccessRoom(currentUser, message.chatRoom))) {
        continue;
      }

      const participant = await this.ensureParticipantForAccessibleRoom(
        currentUser,
        message.chatRoom,
      );

      if (
        participant.hiddenAt ||
        participant.leftAt ||
        message.createdAt < participant.joinedAt ||
        !message.text
      ) {
        continue;
      }

      messages.push({
        id: message.id,
        roomId: message.chatRoomId,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        author: message.author
          ? {
              id: message.author.id,
              login: message.author.login,
              fullName: message.author.fullName,
            }
          : null,
        room: {
          id: message.chatRoom.id,
          title: message.chatRoom.title,
          displayTitle: await this.resolveRoomDisplayTitle(
            currentUser,
            message.chatRoom,
          ),
        },
      });
    }

    return { rooms, messages };
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
    return this.createGroupRoom(currentUser, dto);
  }

  async createDirectRoom(
    currentUser: CurrentAuthUser,
    dto: CreateDirectChatDto,
  ): Promise<ChatRoomResponseDto> {
    if (!canCreateDirectChat()) {
      throw new ForbiddenException('Direct chat creation denied');
    }

    const targetUserId = dto.targetUserId.trim();

    if (!targetUserId || targetUserId === currentUser.id) {
      throw new BadRequestException('Direct chat target user is invalid');
    }

    const targetUser = await this.findActiveUser(targetUserId);

    if (!targetUser) {
      throw new BadRequestException('Direct chat target user is not available');
    }

    const directKey = [currentUser.id, targetUser.id].sort().join(':');
    let wasCreated = false;
    let room: ChatRoomRecord;

    try {
      room = (await this.prisma.chatRoom.create({
        data: {
          title: `${currentUser.fullName} / ${targetUser.fullName}`,
          roomType: 'direct',
          visibilityType: 'explicit_members',
          directKey,
          createdByUserId: currentUser.id,
          participants: {
            create: [
              {
                userId: currentUser.id,
                roleInRoom: 'member',
                joinedAt: new Date(),
              },
              {
                userId: targetUser.id,
                roleInRoom: 'member',
                joinedAt: new Date(),
              },
            ],
          },
        },
      })) as ChatRoomRecord;
      wasCreated = true;
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const existingRoom = (await this.prisma.chatRoom.findUnique({
        where: {
          directKey,
        },
      })) as ChatRoomRecord | null;

      if (!existingRoom) {
        throw error;
      }

      room = existingRoom;
    }

    await this.ensureDirectParticipant(room.id, currentUser.id, true);
    await this.ensureDirectParticipant(room.id, targetUser.id, false);

    if (wasCreated) {
      await this.auditService.writeAuditEvent({
        entityType: 'chat_room',
        entityId: room.id,
        actorUserId: currentUser.id,
        action: 'chat.room.direct.created',
        newValues: {
          directKey,
          participantUserIds: [currentUser.id, targetUser.id],
        },
      });

      await this.publishRoomLifecycleEvent(room, 'chat.room_created', [
        currentUser.id,
        targetUser.id,
      ]);
    } else {
      await this.publishRoomLifecycleEvent(room, 'chat.room_updated', [
        currentUser.id,
      ]);
    }

    const participant = await this.ensureParticipantForAccessibleRoom(
      currentUser,
      room,
    );

    return this.mapRoom(currentUser, room, participant);
  }

  async createGroupRoom(
    currentUser: CurrentAuthUser,
    dto: CreateChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    if (!canCreateGroupChat(this.getRoleCodes(currentUser))) {
      throw new ForbiddenException('Group chat creation denied');
    }

    const title = dto.title.trim();

    if (!title) {
      throw new BadRequestException('Group chat title is required');
    }

    const participantIds = this.dedupeUserIds([
      currentUser.id,
      ...(dto.participantUserIds ?? []),
    ]);

    if (participantIds.filter((userId) => userId !== currentUser.id).length === 0) {
      throw new BadRequestException('Group chat requires participants');
    }

    await this.assertActiveUsersExist(participantIds);

    const room = await this.prisma.chatRoom.create({
      data: {
        title,
        roomType: 'group',
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
      action: 'chat.room.group.created',
      newValues: {
        title: room.title,
        participantUserIds: participantIds,
      },
    });

    await this.publishRoomLifecycleEvent(room, 'chat.room_created', participantIds);

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
    this.assertRoomOpen(room);

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
    this.assertRoomOpen(room);

    if (room.roomType !== 'group' || room.visibilityType !== 'explicit_members') {
      throw new BadRequestException(
        'Participants can be manually managed only for group chats',
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
          update: {
            roleInRoom: 'member',
            joinedAt,
            hiddenAt: null,
            leftAt: null,
          },
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

  async hideRoom(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<{ success: true }> {
    const room = await this.getRoomRecord(roomId);
    this.assertRoomOpen(room);

    if (!this.isDirectOrGroupRoom(room)) {
      throw new BadRequestException('Only direct or group chats can be hidden');
    }

    const participant = await this.assertActiveManualParticipant(
      currentUser,
      room,
    );

    await this.prisma.chatRoomParticipant.update({
      where: {
        id: participant.id,
      },
      data: {
        hiddenAt: new Date(),
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.hidden',
    });

    await this.publishRoomLifecycleEvent(room, 'chat.room_hidden', [
      currentUser.id,
    ]);

    return { success: true };
  }

  async unhideRoom(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<ChatRoomResponseDto> {
    const room = await this.getRoomRecord(roomId);
    this.assertRoomOpen(room);

    if (!this.isDirectOrGroupRoom(room)) {
      throw new BadRequestException('Only direct or group chats can be unhidden');
    }

    const participant = await this.assertActiveManualParticipant(
      currentUser,
      room,
    );

    const updatedParticipant = await this.prisma.chatRoomParticipant.update({
      where: {
        id: participant.id,
      },
      data: {
        hiddenAt: null,
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.unhidden',
    });

    await this.publishRoomLifecycleEvent(room, 'chat.room_unhidden', [
      currentUser.id,
    ]);

    return this.mapRoom(currentUser, room, updatedParticipant);
  }

  async leaveRoom(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<{ success: true }> {
    const room = await this.getRoomRecord(roomId);
    this.assertRoomOpen(room);

    if (room.roomType !== 'group') {
      throw new BadRequestException('Only group chats can be left');
    }

    const participant = await this.assertActiveManualParticipant(
      currentUser,
      room,
    );
    const recipientUserIds = await this.loadRecipientUserIds(room);

    await this.prisma.chatRoomParticipant.update({
      where: {
        id: participant.id,
      },
      data: {
        hiddenAt: null,
        leftAt: new Date(),
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.left',
    });

    await this.publishRoomLifecycleEvent(room, 'chat.room_left', [
      ...new Set([...recipientUserIds, currentUser.id]),
    ]);

    return { success: true };
  }

  async closeRoom(
    currentUser: CurrentAuthUser,
    roomId: string,
    dto: CloseChatRoomDto,
  ): Promise<{ success: true }> {
    const room = await this.getRoomRecord(roomId);
    this.assertRoomOpen(room);

    if (room.roomType !== 'group') {
      throw new BadRequestException('Only group chats can be closed globally');
    }

    if (!canCloseChatGlobally(currentUser.login)) {
      throw new ForbiddenException('Global chat close denied');
    }

    const recipientUserIds = await this.loadRecipientUserIds(room);
    const deleteReason = dto.reason?.trim() || null;

    await this.prisma.chatRoom.update({
      where: {
        id: room.id,
      },
      data: {
        deletedAt: new Date(),
        deletedByUserId: currentUser.id,
        deleteReason,
      },
    });

    await this.auditService.writeAuditEvent({
      entityType: 'chat_room',
      entityId: room.id,
      actorUserId: currentUser.id,
      action: 'chat.room.closed_globally',
      newValues: {
        reason: deleteReason,
      },
    });

    await this.publishRoomLifecycleEvent(room, 'chat.room_closed', recipientUserIds);

    return { success: true };
  }

  async listParticipants(
    currentUser: CurrentAuthUser,
    roomId: string,
  ): Promise<ChatRoomParticipantResponseDto[]> {
    const room = await this.getRoomRecord(roomId);
    await this.assertCanReadRoom(currentUser, room);

    const participants = await this.prisma.chatRoomParticipant.findMany({
      where: {
        chatRoomId: room.id,
        leftAt: null,
      },
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
      leftAt: participant.leftAt?.toISOString() ?? null,
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
    options: { before?: string; limit?: string } = {},
  ): Promise<ChatMessageResponseDto[]> {
    const room = await this.getRoomRecord(roomId);
    const participant = await this.assertCanReadRoom(currentUser, room);
    const requestedLimit = Number.parseInt(options.limit ?? '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50;
    const beforeMessage = options.before
      ? await this.prisma.chatMessage.findFirst({
          where: {
            id: options.before,
            chatRoomId: room.id,
            createdAt: { gte: participant.joinedAt },
          },
          select: {
            id: true,
            createdAt: true,
          },
        })
      : null;

    if (options.before && !beforeMessage) {
      throw new BadRequestException('Message cursor is invalid');
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        chatRoomId: room.id,
        createdAt: {
          gte: participant.joinedAt,
        },
        ...(beforeMessage
          ? {
              OR: [
                { createdAt: { lt: beforeMessage.createdAt } },
                {
                  createdAt: beforeMessage.createdAt,
                  id: { lt: beforeMessage.id },
                },
              ],
            }
          : {}),
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    messages.reverse();

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

    if (dto.replyToMessageId) {
      const participant = await this.assertCanReadRoom(currentUser, room);
      const replyTarget = await this.prisma.chatMessage.findUnique({
        where: { id: dto.replyToMessageId },
        select: {
          chatRoomId: true,
          createdAt: true,
        },
      });

      if (!replyTarget || replyTarget.chatRoomId !== room.id) {
        throw new BadRequestException('Reply target must belong to this room');
      }

      if (replyTarget.createdAt < participant.joinedAt) {
        throw new ForbiddenException('Reply target is not available');
      }
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        chatRoomId: room.id,
        authorUserId: currentUser.id,
        messageType: 'user',
        text,
        replyToMessageId: dto.replyToMessageId,
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
    await this.revealHiddenActiveParticipants(room.id);

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
    this.assertRoomOpen(message.chatRoom);

    if (message.deletedAt) {
      throw new ForbiddenException('Deleted message cannot be edited');
    }

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

  async deleteMessage(
    currentUser: CurrentAuthUser,
    messageId: string,
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
    this.assertRoomOpen(message.chatRoom);

    if (message.messageType !== 'user') {
      throw new ForbiddenException('System messages cannot be deleted');
    }

    if (
      message.authorUserId !== currentUser.id &&
      !(await this.canManageRoom(currentUser, message.chatRoom))
    ) {
      throw new ForbiddenException('Chat message delete denied');
    }

    const updated = message.deletedAt
      ? message
      : await this.prisma.chatMessage.update({
          where: { id: message.id },
          data: {
            deletedAt: new Date(),
            deletedByUserId: currentUser.id,
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

    const latestMessage = await this.prisma.chatMessage.findFirst({
      where: { chatRoomId: message.chatRoomId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });

    if (latestMessage?.id === message.id) {
      await this.prisma.chatRoom.update({
        where: { id: message.chatRoomId },
        data: { lastMessagePreview: 'Сообщение удалено' },
      });
    }

    const mapped = await this.mapMessage(currentUser, updated);
    await this.publishMessageEvent(
      message.chatRoomId,
      'chat.message_updated',
      mapped,
    );

    return mapped;
  }

  async forwardMessage(
    currentUser: CurrentAuthUser,
    messageId: string,
    dto: ForwardChatMessageDto,
  ): Promise<ChatMessageResponseDto> {
    const sourceMessage = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { chatRoom: true },
    });

    if (!sourceMessage) {
      throw new NotFoundException('Chat message not found');
    }

    const sourceParticipant = await this.assertCanReadRoom(
      currentUser,
      sourceMessage.chatRoom,
    );

    if (sourceMessage.createdAt < sourceParticipant.joinedAt) {
      throw new ForbiddenException('Chat message is not available');
    }

    if (sourceMessage.deletedAt) {
      throw new ForbiddenException('Deleted message cannot be forwarded');
    }

    if (sourceMessage.messageType !== 'user') {
      throw new ForbiddenException('Only user messages can be forwarded');
    }

    if (!sourceMessage.text?.trim()) {
      throw new BadRequestException(
        'Forwarding attachment-only messages is not supported yet',
      );
    }

    const targetRoom = await this.getRoomRecord(dto.targetRoomId);
    await this.assertCanWriteRoom(currentUser, targetRoom);

    const forwardedMessage = await this.prisma.chatMessage.create({
      data: {
        chatRoomId: targetRoom.id,
        authorUserId: currentUser.id,
        messageType: 'user',
        text: sourceMessage.text,
        forwardedFromMessageId: sourceMessage.id,
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

    await this.updateRoomLastMessage(
      targetRoom.id,
      this.buildMessagePreview(forwardedMessage.text, []),
    );
    await this.revealHiddenActiveParticipants(targetRoom.id);

    const mapped = await this.mapMessage(currentUser, forwardedMessage);
    await this.publishMessageEvent(
      targetRoom.id,
      'chat.message_created',
      mapped,
    );

    return mapped;
  }

  async toggleHeartReaction(
    currentUser: CurrentAuthUser,
    messageId: string,
  ): Promise<ChatMessageResponseDto> {
    const message = await this.prisma.chatMessage.findUnique({
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

    const participant = await this.assertCanReadRoom(
      currentUser,
      message.chatRoom,
    );
    this.assertRoomOpen(message.chatRoom);

    if (message.createdAt < participant.joinedAt) {
      throw new ForbiddenException('Chat message is not available');
    }

    if (message.deletedAt) {
      throw new ForbiddenException('Deleted message cannot receive reactions');
    }

    const uniqueKey = {
      chatMessageId_userId_reactionType: {
        chatMessageId: message.id,
        userId: currentUser.id,
        reactionType: 'heart',
      },
    };
    const existing = await this.prisma.chatMessageReaction.findUnique({
      where: uniqueKey,
      select: { id: true },
    });

    if (existing) {
      await this.prisma.chatMessageReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.chatMessageReaction.create({
        data: {
          chatMessageId: message.id,
          userId: currentUser.id,
          reactionType: 'heart',
        },
      });
    }

    const mapped = await this.mapMessage(currentUser, message);
    const broadcast = await this.mapMessageForBroadcast(message);
    await this.publishMessageEvent(
      message.chatRoomId,
      'chat.message_updated',
      broadcast,
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

    if (message.chatRoom.deletedAt) {
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

  private assertRoomOpen(room: ChatRoomRecord): void {
    if (room.deletedAt) {
      throw new ForbiddenException('Chat room is closed');
    }
  }

  private shouldIncludeRoomInView(
    room: ChatRoomRecord,
    participant: ChatParticipantRecord,
    view: ChatRoomsView,
  ): boolean {
    if (participant.leftAt) {
      return false;
    }

    if (view === 'archived') {
      return this.isDirectOrGroupRoom(room) && participant.hiddenAt !== null;
    }

    return room.roomType === 'system_default' || participant.hiddenAt === null;
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
    if (room.deletedAt) {
      return false;
    }

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
        return this.hasActiveParticipant(room.id, currentUser.id);
    }
  }

  private async canWriteRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<boolean> {
    if (!currentUser.isActive || room.deletedAt) {
      return false;
    }

    if (room.visibilityType === 'explicit_members') {
      return this.hasActiveParticipant(room.id, currentUser.id);
    }

    return this.canAccessRoom(currentUser, room);
  }

  private async canManageRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<boolean> {
    const roleCodes = this.getRoleCodes(currentUser);

    if (room.deletedAt) {
      return false;
    }

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
        leftAt: true,
      },
    });

    return participant?.roleInRoom === 'admin' && participant.leftAt === null;
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
      if (
        room.visibilityType === 'explicit_members' &&
        existing.leftAt !== null
      ) {
        throw new ForbiddenException('Chat participant has left this room');
      }

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

  private async resolveRoomDisplayTitle(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<string> {
    if (room.roomType !== 'direct') {
      return room.title;
    }

    const otherParticipant = await this.prisma.chatRoomParticipant.findFirst({
      where: {
        chatRoomId: room.id,
        userId: {
          not: currentUser.id,
        },
        leftAt: null,
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      select: {
        user: {
          select: {
            fullName: true,
            login: true,
          },
        },
      },
    });

    return (
      otherParticipant?.user.fullName?.trim() ||
      otherParticipant?.user.login ||
      room.title
    );
  }

  private async mapRoom(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
    participant: ChatParticipantRecord,
  ): Promise<ChatRoomResponseDto> {
    const participantCount = await this.prisma.chatRoomParticipant.count({
      where: {
        chatRoomId: room.id,
        leftAt: null,
      },
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
      displayTitle: await this.resolveRoomDisplayTitle(currentUser, room),
      roomType: room.roomType,
      visibilityType: room.visibilityType,
      lastMessageAt: room.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: room.lastMessagePreview,
      lastReadAt: participant.lastReadAt?.toISOString() ?? null,
      unreadCount,
      participantCount,
      capabilities: {
        canWrite: await this.canWriteRoom(currentUser, room),
        canManage: await this.canManageRoom(currentUser, room),
        canHide:
          this.isDirectOrGroupRoom(room) &&
          !room.deletedAt &&
          participant.leftAt === null,
        canLeave:
          room.roomType === 'group' &&
          !room.deletedAt &&
          participant.leftAt === null,
        canCloseGlobally:
          room.roomType === 'group' &&
          !room.deletedAt &&
          canCloseChatGlobally(currentUser.login),
      },
    };
  }

  private async mapMessage(
    currentUser: CurrentAuthUser,
    message: ChatMessageRecord,
  ): Promise<ChatMessageResponseDto> {
    const isDeleted = message.deletedAt !== null;
    const attachments = isDeleted
      ? []
      : await this.loadMessageAttachments(message.id);
    const canManageRoom = currentUser.id
      ? await this.canManageRoom(
          currentUser,
          await this.getRoomRecord(message.chatRoomId),
        )
      : false;
    const reactions = await this.prisma.chatMessageReaction.findMany({
      where: { chatMessageId: message.id },
      select: {
        userId: true,
        reactionType: true,
      },
    });
    const reactionCounts = reactions.reduce<Record<string, number>>(
      (counts, reaction) => {
        counts[reaction.reactionType] =
          (counts[reaction.reactionType] ?? 0) + 1;
        return counts;
      },
      {},
    );

    return {
      id: message.id,
      chatRoomId: message.chatRoomId,
      messageType: message.messageType,
      text: isDeleted ? 'Сообщение удалено' : message.text,
      metadata: this.mapJsonObject(message.metadata),
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      isDeleted,
      replyTo: await this.loadMessageReferencePreview(message.replyToMessageId),
      forwardedFrom: await this.loadMessageReferencePreview(
        message.forwardedFromMessageId,
      ),
      reactionCounts,
      myReactions: currentUser.id
        ? reactions
            .filter((reaction) => reaction.userId === currentUser.id)
            .map((reaction) => reaction.reactionType)
        : [],
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
          !isDeleted &&
          message.messageType === 'user' &&
          message.authorUserId === currentUser.id &&
          Date.now() - message.createdAt.getTime() <=
            CHAT_MESSAGE_EDIT_WINDOW_MS,
        canDelete:
          !isDeleted &&
          message.messageType === 'user' &&
          (message.authorUserId === currentUser.id || canManageRoom),
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

  private async loadMessageReferencePreview(
    messageId: string | null,
  ): Promise<ChatMessageResponseDto['replyTo']> {
    if (!messageId) {
      return null;
    }

    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
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

    if (!message) {
      return null;
    }

    return {
      id: message.id,
      text: message.deletedAt ? 'Сообщение удалено' : message.text,
      author: message.author
        ? {
            id: message.author.id,
            login: message.author.login,
            fullName: message.author.fullName,
          }
        : null,
      createdAt: message.createdAt.toISOString(),
      isDeleted: message.deletedAt !== null,
    };
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

  private async publishRoomLifecycleEvent(
    room: ChatRoomRecord,
    type:
      | 'chat.room_created'
      | 'chat.room_updated'
      | 'chat.room_hidden'
      | 'chat.room_unhidden'
      | 'chat.room_left'
      | 'chat.room_closed',
    recipientUserIds: string[],
  ): Promise<void> {
    await this.realtimeService.publish({
      type,
      roomId: room.id,
      recipientUserIds: Array.from(new Set(recipientUserIds)),
      payload: {
        roomId: room.id,
      },
    });
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
          where: {
            chatRoomId: room.id,
            leftAt: null,
            user: {
              isActive: true,
              deletedAt: null,
            },
          },
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

  private async hasActiveParticipant(
    roomId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: roomId,
          userId,
        },
      },
      select: {
        id: true,
        leftAt: true,
      },
    });

    return !!participant && participant.leftAt === null;
  }

  private async assertActiveManualParticipant(
    currentUser: CurrentAuthUser,
    room: ChatRoomRecord,
  ): Promise<ChatParticipantRecord> {
    if (room.visibilityType !== 'explicit_members') {
      throw new BadRequestException('Action is available only for manual rooms');
    }

    const participant = (await this.prisma.chatRoomParticipant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: currentUser.id,
        },
      },
    })) as ChatParticipantRecord | null;

    if (!participant || participant.leftAt) {
      throw new ForbiddenException('Active chat participant required');
    }

    return participant;
  }

  private async ensureDirectParticipant(
    roomId: string,
    userId: string,
    shouldUnhide: boolean,
  ): Promise<void> {
    await this.prisma.chatRoomParticipant.upsert({
      where: {
        chatRoomId_userId: {
          chatRoomId: roomId,
          userId,
        },
      },
      create: {
        chatRoomId: roomId,
        userId,
        roleInRoom: 'member',
        joinedAt: new Date(),
      },
      update: {
        roleInRoom: 'member',
        leftAt: null,
        ...(shouldUnhide ? { hiddenAt: null } : {}),
      },
    });
  }

  private async revealHiddenActiveParticipants(roomId: string): Promise<void> {
    await this.prisma.chatRoomParticipant.updateMany({
      where: {
        chatRoomId: roomId,
        hiddenAt: {
          not: null,
        },
        leftAt: null,
      },
      data: {
        hiddenAt: null,
      },
    });
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

  private async findActiveUser(userId: string): Promise<{
    id: string;
    fullName: string;
  } | null> {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
      },
    });
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

  private isDirectOrGroupRoom(room: ChatRoomRecord): boolean {
    return (['direct', 'group'] as ChatRoomType[]).includes(
      room.roomType as ChatRoomType,
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
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
