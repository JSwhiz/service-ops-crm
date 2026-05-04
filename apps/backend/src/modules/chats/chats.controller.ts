import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ChatsService } from './chats.service';
import { AddChatParticipantsDto } from './dto/add-chat-participants.dto';
import { ChatMessageResponseDto, ChatRoomResponseDto } from './dto/chat-response.dto';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';
import { EditChatMessageDto } from './dto/edit-chat-message.dto';
import { MarkChatRoomReadDto } from './dto/mark-chat-room-read.dto';
import { RenameChatRoomDto } from './dto/rename-chat-room.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
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

  @Get('rooms')
  listRooms(@CurrentUser() user: CurrentAuthUser): Promise<ChatRoomResponseDto[]> {
    return this.chatsService.listRooms(user);
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

  @Get('rooms/:roomId/messages')
  listMessages(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
  ): Promise<ChatMessageResponseDto[]> {
    return this.chatsService.listMessages(user, roomId);
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

  @Post('rooms/:roomId/read')
  markRead(
    @CurrentUser() user: CurrentAuthUser,
    @Param('roomId') roomId: string,
    @Body() body: MarkChatRoomReadDto,
  ): Promise<ChatRoomResponseDto> {
    return this.chatsService.markRead(user, roomId, body);
  }
}
