import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('chats support default visibility, attachments, unread, custom join-point and edit window', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  const [founderUser, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { login: 'founder' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager1' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager2' },
      select: { id: true },
    }),
  ]);

  const createdMessageIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdFileIds: string[] = [];
  const cleanupCallbacks: Array<() => Promise<void>> = [];

  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
    select: { id: true },
  });
  const existingCloser = await prisma.user.findUnique({
    where: { login: 'gerasimov' },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
    },
  });
  const closerPassword = 'gerasimov-chat-test';
  const closerPasswordHash = await hashPassword(closerPassword);
  const closerUser = existingCloser
    ? await prisma.user.update({
        where: { id: existingCloser.id },
        data: {
          passwordHash: closerPasswordHash,
          isActive: true,
          deletedAt: null,
        },
      })
    : await prisma.user.create({
        data: {
          login: 'gerasimov',
          fullName: 'Герасимов Тест',
          isActive: true,
          passwordHash: closerPasswordHash,
        },
      });
  const existingCloserRole = await prisma.userRole.findUnique({
    where: {
      userId_roleId: {
        userId: closerUser.id,
        roleId: managerRole.id,
      },
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: closerUser.id,
        roleId: managerRole.id,
      },
    },
    update: {},
    create: {
      userId: closerUser.id,
      roleId: managerRole.id,
    },
  });

  cleanupCallbacks.push(async () => {
    if (existingCloser) {
      if (!existingCloserRole) {
        await prisma.userRole.deleteMany({
          where: {
            userId: closerUser.id,
            roleId: managerRole.id,
          },
        });
      }

      await prisma.user.update({
        where: { id: existingCloser.id },
        data: {
          passwordHash: existingCloser.passwordHash,
          isActive: existingCloser.isActive,
          deletedAt: existingCloser.deletedAt,
        },
      });
      return;
    }

    await prisma.user.delete({
      where: { id: closerUser.id },
    });
  });

  const existingInactiveTarget = await prisma.user.findUnique({
    where: { login: 'chat_inactive_target' },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
    },
  });
  const inactiveTarget = await prisma.user.upsert({
    where: { login: 'chat_inactive_target' },
    update: {
      fullName: 'Inactive Chat Target',
      isActive: false,
      deletedAt: null,
      passwordHash: null,
    },
    create: {
      login: 'chat_inactive_target',
      fullName: 'Inactive Chat Target',
      isActive: false,
      passwordHash: null,
    },
  });

  cleanupCallbacks.push(async () => {
    if (existingInactiveTarget) {
      await prisma.user.update({
        where: { id: existingInactiveTarget.id },
        data: {
          passwordHash: existingInactiveTarget.passwordHash,
          isActive: existingInactiveTarget.isActive,
          deletedAt: existingInactiveTarget.deletedAt,
        },
      });
      return;
    }

    await prisma.user.delete({
      where: { id: inactiveTarget.id },
    });
  });

  t.after(async () => {
    if (createdMessageIds.length > 0) {
      const fileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            entityType: 'chat_message',
            entityId: {
              in: createdMessageIds,
            },
          },
          select: {
            fileId: true,
          },
        })
      ).map((item) => item.fileId);

      createdFileIds.push(...fileIds);

      await prisma.fileAttachment.deleteMany({
        where: {
          entityType: 'chat_message',
          entityId: {
            in: createdMessageIds,
          },
        },
      });

      await prisma.chatMessage.deleteMany({
        where: {
          id: {
            in: createdMessageIds,
          },
        },
      });
    }

    if (createdRoomIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'chat_room',
          entityId: {
            in: createdRoomIds,
          },
        },
      });

      await prisma.chatRoom.deleteMany({
        where: {
          id: {
            in: createdRoomIds,
          },
        },
      });
    }

    if (createdFileIds.length > 0) {
      await prisma.file.deleteMany({
        where: {
          id: {
            in: createdFileIds,
          },
        },
      });
    }

    for (const cleanup of cleanupCallbacks.reverse()) {
      await cleanup();
    }

    await app.close();
    await prisma.$disconnect();
  });

  const [
    founderCookie,
    managerOneCookie,
    managerTwoCookie,
    hrCookie,
    closerCookie,
  ] =
    await Promise.all([
      loginAndGetCookieHeader({
        baseUrl,
        login: 'founder',
        password: 'founder123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'manager1',
        password: 'manager123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'manager2',
        password: 'manager123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'gerasimov',
        password: closerPassword,
      }),
    ]);

  const founderRoomsResponse = await fetch(`${baseUrl}/api/v1/chats/rooms`, {
    headers: { Cookie: founderCookie },
  });
  assert.equal(founderRoomsResponse.status, 200);
  const founderRooms = (await founderRoomsResponse.json()) as Array<{
    id: string;
    code: string | null;
    unreadCount: number;
    capabilities: { canManage: boolean };
  }>;

  assert.deepEqual(
    founderRooms
      .map((room) => room.code)
      .filter(Boolean)
      .sort(),
    ['leadership', 'objects', 'one_time_orders'],
  );
  assert.ok(founderRooms.every((room) => room.capabilities.canManage));

  const hrRoomsResponse = await fetch(`${baseUrl}/api/v1/chats/rooms`, {
    headers: { Cookie: hrCookie },
  });
  assert.equal(hrRoomsResponse.status, 200);
  const hrRooms = (await hrRoomsResponse.json()) as Array<{ code: string | null }>;
  assert.ok(!hrRooms.some((room) => room.code === 'leadership'));

  const directKey = [managerOne.id, managerTwo.id].sort().join(':');
  const existingDirectRoom = await prisma.chatRoom.findUnique({
    where: { directKey },
    select: { id: true },
  });
  const directRoomResponse = await fetch(`${baseUrl}/api/v1/chats/rooms/direct`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetUserId: managerTwo.id }),
  });
  assert.equal(directRoomResponse.status, 201);
  const directRoom = (await directRoomResponse.json()) as {
    id: string;
    roomType: string;
    capabilities: {
      canHide: boolean;
      canLeave: boolean;
      canWrite: boolean;
    };
  };
  if (!existingDirectRoom) {
    createdRoomIds.push(directRoom.id);
  }
  assert.equal(directRoom.roomType, 'direct');
  assert.equal(directRoom.capabilities.canHide, true);
  assert.equal(directRoom.capabilities.canLeave, false);
  assert.equal(directRoom.capabilities.canWrite, true);

  const repeatDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/direct`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetUserId: managerTwo.id }),
    },
  );
  assert.equal(repeatDirectResponse.status, 201);
  const repeatDirectRoom = (await repeatDirectResponse.json()) as { id: string };
  assert.equal(repeatDirectRoom.id, directRoom.id);

  const parallelDirectRooms = await Promise.all(
    Array.from({ length: 2 }, async () => {
      const response = await fetch(`${baseUrl}/api/v1/chats/rooms/direct`, {
        method: 'POST',
        headers: {
          Cookie: managerOneCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetUserId: managerTwo.id }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as { id: string };
    }),
  );
  assert.deepEqual(
    new Set(parallelDirectRooms.map((room) => room.id)),
    new Set([directRoom.id]),
  );
  assert.equal(
    await prisma.chatRoom.count({
      where: { directKey },
    }),
    1,
  );

  const selfDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/direct`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetUserId: managerOne.id }),
    },
  );
  assert.equal(selfDirectResponse.status, 400);

  const inactiveDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/direct`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetUserId: inactiveTarget.id }),
    },
  );
  assert.equal(inactiveDirectResponse.status, 400);

  const ordinaryGroupResponse = await fetch(`${baseUrl}/api/v1/chats/rooms/group`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Manager forbidden group',
      participantUserIds: [managerTwo.id],
    }),
  });
  assert.equal(ordinaryGroupResponse.status, 403);

  const hideDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${directRoom.id}/hide`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(hideDirectResponse.status, 201);

  const managerOneRoomsAfterHideResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    {
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerOneRoomsAfterHideResponse.status, 200);
  const managerOneRoomsAfterHide =
    (await managerOneRoomsAfterHideResponse.json()) as Array<{ id: string }>;
  assert.equal(
    managerOneRoomsAfterHide.some((room) => room.id === directRoom.id),
    false,
  );

  const managerOneArchivedRoomsResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms?view=archived`,
    {
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerOneArchivedRoomsResponse.status, 200);
  const managerOneArchivedRooms =
    (await managerOneArchivedRoomsResponse.json()) as Array<{
      id: string;
      roomType: string;
    }>;
  assert.equal(
    managerOneArchivedRooms.some(
      (room) => room.id === directRoom.id && room.roomType === 'direct',
    ),
    true,
  );

  const unhideDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${directRoom.id}/unhide`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(unhideDirectResponse.status, 201);

  const managerOneArchivedRoomsAfterUnhideResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms?view=archived`,
    {
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerOneArchivedRoomsAfterUnhideResponse.status, 200);
  const managerOneArchivedRoomsAfterUnhide =
    (await managerOneArchivedRoomsAfterUnhideResponse.json()) as Array<{
      id: string;
    }>;
  assert.equal(
    managerOneArchivedRoomsAfterUnhide.some((room) => room.id === directRoom.id),
    false,
  );

  const hideDirectAgainResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${directRoom.id}/hide`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(hideDirectAgainResponse.status, 201);

  const managerTwoRoomsAfterHideResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    {
      headers: { Cookie: managerTwoCookie },
    },
  );
  assert.equal(managerTwoRoomsAfterHideResponse.status, 200);
  const managerTwoRoomsAfterHide =
    (await managerTwoRoomsAfterHideResponse.json()) as Array<{ id: string }>;
  assert.equal(
    managerTwoRoomsAfterHide.some((room) => room.id === directRoom.id),
    true,
  );

  const directRevealMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${directRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: managerTwoCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Direct reveal message' }),
    },
  );
  assert.equal(directRevealMessageResponse.status, 201);
  const directRevealMessage =
    (await directRevealMessageResponse.json()) as { id: string };
  createdMessageIds.push(directRevealMessage.id);

  const managerOneRoomsAfterRevealResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    {
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerOneRoomsAfterRevealResponse.status, 200);
  const managerOneRoomsAfterReveal =
    (await managerOneRoomsAfterRevealResponse.json()) as Array<{ id: string }>;
  assert.equal(
    managerOneRoomsAfterReveal.some((room) => room.id === directRoom.id),
    true,
  );

  const managerOneArchivedRoomsAfterRevealResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms?view=archived`,
    {
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerOneArchivedRoomsAfterRevealResponse.status, 200);
  const managerOneArchivedRoomsAfterReveal =
    (await managerOneArchivedRoomsAfterRevealResponse.json()) as Array<{
      id: string;
    }>;
  assert.equal(
    managerOneArchivedRoomsAfterReveal.some((room) => room.id === directRoom.id),
    false,
  );

  const objectsRoom = founderRooms.find((room) => room.code === 'objects');
  assert.ok(objectsRoom);

  const hideSystemRoomResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${objectsRoom.id}/hide`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(hideSystemRoomResponse.status, 400);

  const founderArchivedRoomsResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms?view=archived`,
    {
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(founderArchivedRoomsResponse.status, 200);
  const founderArchivedRooms =
    (await founderArchivedRoomsResponse.json()) as Array<{
      code: string | null;
    }>;
  assert.equal(
    founderArchivedRooms.some((room) => room.code === 'objects'),
    false,
  );

  const form = new FormData();
  form.set('text', 'Objects chat integration message');
  form.append(
    'files',
    new Blob(['chat attachment smoke'], { type: 'text/plain' }),
    'chat-smoke.txt',
  );

  const sendResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${objectsRoom.id}/messages`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
      body: form,
    },
  );
  assert.equal(sendResponse.status, 201);
  const sentMessage = (await sendResponse.json()) as {
    id: string;
    attachments: Array<{ id: string; originalName: string }>;
  };
  createdMessageIds.push(sentMessage.id);
  createdFileIds.push(...sentMessage.attachments.map((file) => file.id));
  assert.equal(sentMessage.attachments[0]?.originalName, 'chat-smoke.txt');

  const managerRoomsResponse = await fetch(`${baseUrl}/api/v1/chats/rooms`, {
    headers: { Cookie: managerOneCookie },
  });
  assert.equal(managerRoomsResponse.status, 200);
  const managerRooms = (await managerRoomsResponse.json()) as Array<{
    id: string;
    code: string | null;
    unreadCount: number;
  }>;
  const managerObjectsRoom = managerRooms.find((room) => room.code === 'objects');
  assert.ok(managerObjectsRoom);
  assert.equal(managerObjectsRoom.unreadCount >= 1, true);

  const markReadResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${managerObjectsRoom.id}/read`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lastReadMessageId: sentMessage.id }),
    },
  );
  assert.equal(markReadResponse.status, 201);
  const readRoom = (await markReadResponse.json()) as {
    unreadCount: number;
    lastReadAt: string | null;
  };
  assert.equal(readRoom.unreadCount, 0);
  assert.ok(readRoom.lastReadAt);

  const createRoomResponse = await fetch(`${baseUrl}/api/v1/chats/rooms/group`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Integration chat ${Date.now()}`,
      participantUserIds: [managerOne.id],
    }),
  });
  assert.equal(createRoomResponse.status, 201);
  const customRoom = (await createRoomResponse.json()) as {
    id: string;
    roomType: string;
    capabilities: { canManage: boolean; canLeave: boolean };
  };
  createdRoomIds.push(customRoom.id);
  assert.equal(customRoom.roomType, 'group');
  assert.equal(customRoom.capabilities.canManage, true);
  assert.equal(customRoom.capabilities.canLeave, true);

  const customParticipantsResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/participants`,
    {
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(customParticipantsResponse.status, 200);
  const customParticipants =
    (await customParticipantsResponse.json()) as Array<{
      roleInRoom: string;
      user: { id: string };
    }>;
  assert.equal(
    customParticipants.some(
      (participant) =>
        participant.user.id === founderUser.id &&
        participant.roleInRoom === 'admin',
    ),
    true,
  );

  const oldCustomMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Message before manager2 join' }),
    },
  );
  assert.equal(oldCustomMessageResponse.status, 201);
  const oldCustomMessage = (await oldCustomMessageResponse.json()) as {
    id: string;
  };
  createdMessageIds.push(oldCustomMessage.id);

  await delay(5);

  const addParticipantResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/participants`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userIds: [managerTwo.id] }),
    },
  );
  assert.equal(addParticipantResponse.status, 201);

  const managerTwoMessagesResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      headers: { Cookie: managerTwoCookie },
    },
  );
  assert.equal(managerTwoMessagesResponse.status, 200);
  const managerTwoMessages = (await managerTwoMessagesResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(managerTwoMessages.some((message) => message.id === oldCustomMessage.id), false);

  const newCustomMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Message after manager2 join' }),
    },
  );
  assert.equal(newCustomMessageResponse.status, 201);
  const newCustomMessage = (await newCustomMessageResponse.json()) as {
    id: string;
  };
  createdMessageIds.push(newCustomMessage.id);

  const editResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Edited custom message' }),
    },
  );
  assert.equal(editResponse.status, 200);
  const editedMessage = (await editResponse.json()) as { text: string; editedAt: string | null };
  assert.equal(editedMessage.text, 'Edited custom message');
  assert.ok(editedMessage.editedAt);

  await prisma.chatMessage.update({
    where: { id: newCustomMessage.id },
    data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
  });

  const lateEditResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Too late' }),
    },
  );
  assert.equal(lateEditResponse.status, 403);

  const leaveDirectResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${directRoom.id}/leave`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(leaveDirectResponse.status, 400);

  const leaveSystemResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${objectsRoom.id}/leave`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(leaveSystemResponse.status, 400);

  const leaveGroupResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/leave`,
    {
      method: 'POST',
      headers: { Cookie: managerTwoCookie },
    },
  );
  assert.equal(leaveGroupResponse.status, 201);

  const managerTwoRoomsAfterLeaveResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    {
      headers: { Cookie: managerTwoCookie },
    },
  );
  assert.equal(managerTwoRoomsAfterLeaveResponse.status, 200);
  const managerTwoRoomsAfterLeave =
    (await managerTwoRoomsAfterLeaveResponse.json()) as Array<{ id: string }>;
  assert.equal(
    managerTwoRoomsAfterLeave.some((room) => room.id === customRoom.id),
    false,
  );

  const leftParticipantSendResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: managerTwoCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Left participant should not write' }),
    },
  );
  assert.equal(leftParticipantSendResponse.status, 403);

  const forbiddenCloseResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/close`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Founder login is not globally allowed' }),
    },
  );
  assert.equal(forbiddenCloseResponse.status, 403);

  const closeGroupResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/close`,
    {
      method: 'POST',
      headers: {
        Cookie: closerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Integration close' }),
    },
  );
  assert.equal(closeGroupResponse.status, 201);

  const founderRoomsAfterCloseResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    {
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(founderRoomsAfterCloseResponse.status, 200);
  const founderRoomsAfterClose =
    (await founderRoomsAfterCloseResponse.json()) as Array<{ id: string }>;
  assert.equal(
    founderRoomsAfterClose.some((room) => room.id === customRoom.id),
    false,
  );

  const closedRoomSendResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Closed room should not accept messages' }),
    },
  );
  assert.equal(closedRoomSendResponse.status, 403);
});
