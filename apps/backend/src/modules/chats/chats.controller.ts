import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ChatsService } from './chats.service';
import { AddChatParticipantsDto } from './dto/add-chat-participants.dto';
import { CloseChatRoomDto } from './dto/close-chat-room.dto';
import {
  ChatMessageResponseDto,
  ChatMessageWindowResponseDto,
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
import type { ChatRoomCode, CurrentAuthUser } from './types/chat.types';

interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get('search')
  search(
    @CurrentUser() user: CurrentAuthUser,
    @Query('q') query?: string,
  ): Promise<ChatSearchResponseDto> {
    return this.chatsService.search(user, query ?? '');
  }

  @Get('rooms')
  listRooms(
    @CurrentUser() user: CurrentAuthUser,
    @Query('view') view?: string,
  ): Promise<ChatRoomResponseDto[]> {
    return this.chatsService.listRooms(user, view);
  }

  @Get('rooms/code/:code')
  getRoomByCode(
    @CurrentUser() user: CurrentAuthUser,
    @Param('code') code: ChatRoomCode,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.getRoomByCode(user, code);
  }

  @Post('rooms')
  createRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Body() body: CreateChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.createRoom(user, body);
  }

  @Post('rooms/direct')
  createDirectRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Body() body: CreateDirectChatDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.createDirectRoom(user, body);
  }

  @Post('rooms/group')
  createGroupRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Body() body: CreateChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.createGroupRoom(user, body);
  }

  @Patch('rooms/:roomId')
  renameRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: RenameChatRoomDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.renameRoom(user, roomId, body);
  }

  @Post('rooms/:roomId/participants')
  addParticipants(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: AddChatParticipantsDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.addParticipants(user, roomId, body);
  }

  @Post('rooms/:roomId/hide')
  hideRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<{ success: true }> {
    return this.chatsService.hideRoom(user, roomId);
  }

  @Post('rooms/:roomId/unhide')
  unhideRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.unhideRoom(user, roomId);
  }

  @Post('rooms/:roomId/leave')
  leaveRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<{ success: true }> {
    return this.chatsService.leaveRoom(user, roomId);
  }

  @Post('rooms/:roomId/close')
  closeRoom(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: CloseChatRoomDto,
  ): Promise<{ success: true }> {
    return this.chatsService.closeRoom(user, roomId, body);
  }

  @Get('rooms/:roomId/participants')
  listParticipants(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<ChatRoomParticipantResponseDto[]> {
    return this.chatsService.listParticipants(user, roomId);
  }

  @Get('rooms/:roomId/messages')
  listMessages(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<ChatMessageResponseDto[]> {
    return this.chatsService.listMessages(user, roomId, { before, limit });
  }

  @Get('rooms/:roomId/messages/window')
  listMessagesAround(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Query('around') around: string,
    @Query('limitBefore') limitBefore?: string,
    @Query('limitAfter') limitAfter?: string,
  ): Promise<ChatMessageWindowResponseDto> {
    return this.chatsService.listMessagesAround(user, roomId, {
      around,
      limitBefore,
      limitAfter,
    });
  }

  @Get('rooms/:roomId/messages/unread-window')
  listUnreadMessagesWindow(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<ChatMessageWindowResponseDto> {
    return this.chatsService.listUnreadMessagesWindow(user, roomId);
  }

  @Get('messages/:messageId')
  getMessage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('messageId') messageId: string,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.getMessage(user, messageId);
  }

  @Post('rooms/:roomId/messages')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: {
        fileSize: 25 * 1024 * 1024,
      },
    }),
  )
  sendMessage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: SendChatMessageDto,
    @UploadedFiles() files: UploadedFilePayload[] | undefined,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.sendMessage(user, roomId, body, files ?? []);
  }

  @Patch('messages/:messageId')
  editMessage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('messageId') messageId: string,
    @Body() body: EditChatMessageDto,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.editMessage(user, messageId, body);
  }

  @Post('messages/:messageId/delete')
  deleteMessage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('messageId') messageId: string,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.deleteMessage(user, messageId);
  }

  @Post('messages/:messageId/forward')
  forwardMessage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('messageId') messageId: string,
    @Body() body: ForwardChatMessageDto,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.forwardMessage(user, messageId, body);
  }

  @Post('messages/:messageId/reactions/heart')
  toggleHeartReaction(
    @CurrentUser() user: CurrentAuthUser,
    @Param('messageId') messageId: string,
  ): Promise<ChatMessageResponseDto> {
    return this.chatsService.toggleHeartReaction(user, messageId);
  }

  @Post('rooms/:roomId/read')
  markRead(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: MarkChatRoomReadDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.markRead(user, roomId, body);
  }
}
