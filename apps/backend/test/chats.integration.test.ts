import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

      await prisma.chatMessageEditHistory.deleteMany({
        where: {
          chatMessageId: {
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
    capabilities: {
      canManage: boolean;
      canCloseGlobally: boolean;
    };
  }>;

  assert.deepEqual(
    founderRooms
      .map((room) => room.code)
      .filter(Boolean)
      .sort(),
    ['leadership', 'objects', 'one_time_orders'],
  );
  assert.ok(founderRooms.every((room) => room.capabilities.canManage));
  assert.ok(
    founderRooms.every((room) => room.capabilities.canCloseGlobally === false),
  );

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

  const hiddenRoomSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=manager2`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(hiddenRoomSearchResponse.status, 200);
  const hiddenRoomSearch = (await hiddenRoomSearchResponse.json()) as {
    rooms: Array<{ id: string }>;
  };
  assert.equal(
    hiddenRoomSearch.rooms.some((room) => room.id === directRoom.id),
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
  const leadershipRoom = founderRooms.find((room) => room.code === 'leadership');
  assert.ok(objectsRoom);
  assert.ok(leadershipRoom);

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
      participantUserIds: [managerOne.id, closerUser.id],
    }),
  });
  assert.equal(createRoomResponse.status, 201);
  const customRoom = (await createRoomResponse.json()) as {
    id: string;
    roomType: string;
    capabilities: {
      canManage: boolean;
      canLeave: boolean;
      canCloseGlobally: boolean;
    };
  };
  createdRoomIds.push(customRoom.id);
  assert.equal(customRoom.roomType, 'group');
  assert.equal(customRoom.capabilities.canManage, true);
  assert.equal(customRoom.capabilities.canLeave, true);
  assert.equal(customRoom.capabilities.canCloseGlobally, false);

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

  const paginationRoomResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/group`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Pagination chat ${Date.now()}`,
        participantUserIds: [managerOne.id],
      }),
    },
  );
  assert.equal(paginationRoomResponse.status, 201);
  const paginationRoom = (await paginationRoomResponse.json()) as { id: string };
  createdRoomIds.push(paginationRoom.id);

  const paginationMessageIds = Array.from({ length: 55 }, () => randomUUID());
  const paginationStartedAt = Date.now() + 1000;
  await prisma.chatMessage.createMany({
    data: paginationMessageIds.map((id, index) => ({
      id,
      chatRoomId: paginationRoom.id,
      authorUserId: founderUser.id,
      messageType: 'user',
      text: `Pagination message ${index + 1}`,
      createdAt: new Date(paginationStartedAt + index),
    })),
  });
  createdMessageIds.push(...paginationMessageIds);

  const managerPaginationParticipantBeforeUnreadWindow =
    await prisma.chatRoomParticipant.findUniqueOrThrow({
      where: {
        chatRoomId_userId: {
          chatRoomId: paginationRoom.id,
          userId: managerOne.id,
        },
      },
      select: { lastReadAt: true },
    });
  const unreadWindowResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${paginationRoom.id}/messages/unread-window`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(unreadWindowResponse.status, 200);
  const unreadWindow = (await unreadWindowResponse.json()) as {
    messages: Array<{ id: string }>;
    hasOlder: boolean;
    hasNewer: boolean;
    anchorMessageId: string | null;
    unreadMessageId: string | null;
    isLatestWindow: boolean;
  };
  assert.equal(unreadWindow.unreadMessageId, paginationMessageIds[0]);
  assert.equal(unreadWindow.anchorMessageId, paginationMessageIds[0]);
  assert.equal(unreadWindow.messages[0]?.id, paginationMessageIds[0]);
  assert.equal(unreadWindow.hasOlder, false);
  assert.equal(unreadWindow.hasNewer, true);
  assert.equal(unreadWindow.isLatestWindow, false);
  const managerPaginationParticipantAfterUnreadWindow =
    await prisma.chatRoomParticipant.findUniqueOrThrow({
      where: {
        chatRoomId_userId: {
          chatRoomId: paginationRoom.id,
          userId: managerOne.id,
        },
      },
      select: { lastReadAt: true },
    });
  assert.equal(
    managerPaginationParticipantAfterUnreadWindow.lastReadAt?.toISOString() ?? null,
    managerPaginationParticipantBeforeUnreadWindow.lastReadAt?.toISOString() ?? null,
  );

  const latestMessagesResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${paginationRoom.id}/messages`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(latestMessagesResponse.status, 200);
  const latestMessages = (await latestMessagesResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(latestMessages.length, 50);
  assert.deepEqual(
    latestMessages.map((message) => message.id),
    paginationMessageIds.slice(5),
  );

  const olderMessagesResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${paginationRoom.id}/messages?before=${latestMessages[0]?.id}&limit=50`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(olderMessagesResponse.status, 200);
  const olderMessages = (await olderMessagesResponse.json()) as Array<{
    id: string;
  }>;
  assert.deepEqual(
    olderMessages.map((message) => message.id),
    paginationMessageIds.slice(0, 5),
  );

  const aroundMessageId = paginationMessageIds[20];
  assert.ok(aroundMessageId);
  const aroundMessagesResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${paginationRoom.id}/messages/window?around=${aroundMessageId}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(aroundMessagesResponse.status, 200);
  const aroundMessages = (await aroundMessagesResponse.json()) as {
    messages: Array<{ id: string }>;
    hasOlder: boolean;
    hasNewer: boolean;
    anchorMessageId: string | null;
  };
  assert.equal(aroundMessages.anchorMessageId, aroundMessageId);
  assert.equal(
    aroundMessages.messages.some((message) => message.id === aroundMessageId),
    true,
  );
  assert.equal(aroundMessages.hasOlder, false);
  assert.equal(aroundMessages.hasNewer, true);

  const inaccessibleAroundResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${paginationRoom.id}/messages/window?around=${aroundMessageId}`,
    { headers: { Cookie: managerTwoCookie } },
  );
  assert.equal(inaccessibleAroundResponse.status, 403);

  const creatorRenameResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Integration chat renamed by creator' }),
    },
  );
  assert.equal(creatorRenameResponse.status, 200);
  const creatorRenamedRoom = (await creatorRenameResponse.json()) as {
    title: string;
    capabilities: { canManage: boolean; canCloseGlobally: boolean };
  };
  assert.equal(creatorRenamedRoom.title, 'Integration chat renamed by creator');
  assert.equal(creatorRenamedRoom.capabilities.canManage, true);
  assert.equal(creatorRenamedRoom.capabilities.canCloseGlobally, false);

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

  const ordinaryMemberRenameResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Manager member rename attempt' }),
    },
  );
  assert.equal(ordinaryMemberRenameResponse.status, 403);

  const ordinaryMemberAddParticipantsResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/participants`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userIds: [managerTwo.id] }),
    },
  );
  assert.equal(ordinaryMemberAddParticipantsResponse.status, 403);

  const globalManagerRenameResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Integration chat managed by global manager' }),
    },
  );
  assert.equal(globalManagerRenameResponse.status, 200);
  const globalManagerRenamedRoom = (await globalManagerRenameResponse.json()) as {
    title: string;
    capabilities: { canManage: boolean; canCloseGlobally: boolean };
  };
  assert.equal(
    globalManagerRenamedRoom.title,
    'Integration chat managed by global manager',
  );
  assert.equal(globalManagerRenamedRoom.capabilities.canManage, true);
  assert.equal(globalManagerRenamedRoom.capabilities.canCloseGlobally, false);

  const roomSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent('managed by global')}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(roomSearchResponse.status, 200);
  const roomSearch = (await roomSearchResponse.json()) as {
    rooms: Array<{ id: string }>;
    messages: Array<{ id: string }>;
  };
  assert.equal(roomSearch.rooms.some((room) => room.id === customRoom.id), true);

  const participantSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=manager1`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(participantSearchResponse.status, 200);
  const participantSearch = (await participantSearchResponse.json()) as {
    rooms: Array<{ id: string }>;
  };
  assert.equal(
    participantSearch.rooms.some((room) => room.id === customRoom.id),
    true,
  );

  const inaccessibleRoomSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent('Руководство')}`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(inaccessibleRoomSearchResponse.status, 200);
  const inaccessibleRoomSearch =
    (await inaccessibleRoomSearchResponse.json()) as {
      rooms: Array<{ id: string }>;
    };
  assert.equal(
    inaccessibleRoomSearch.rooms.some((room) => room.id === leadershipRoom.id),
    false,
  );

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

  const messageSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent('after manager2 join')}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(messageSearchResponse.status, 200);
  const messageSearch = (await messageSearchResponse.json()) as {
    messages: Array<{ id: string; roomId: string; text: string }>;
  };
  assert.equal(
    messageSearch.messages.some(
      (message) =>
        message.id === newCustomMessage.id && message.roomId === customRoom.id,
    ),
    true,
  );

  const joinedAtSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent('before manager2 join')}`,
    { headers: { Cookie: managerTwoCookie } },
  );
  assert.equal(joinedAtSearchResponse.status, 200);
  const joinedAtSearch = (await joinedAtSearchResponse.json()) as {
    messages: Array<{ id: string }>;
  };
  assert.equal(
    joinedAtSearch.messages.some((message) => message.id === oldCustomMessage.id),
    false,
  );

  const replyResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Reply to custom message',
        replyToMessageId: newCustomMessage.id,
      }),
    },
  );
  assert.equal(replyResponse.status, 201);
  const replyMessage = (await replyResponse.json()) as {
    id: string;
    replyTo: {
      id: string;
      text: string | null;
      author: { id: string } | null;
      isDeleted: boolean;
    } | null;
  };
  createdMessageIds.push(replyMessage.id);
  assert.equal(replyMessage.replyTo?.id, newCustomMessage.id);
  assert.equal(replyMessage.replyTo?.text, 'Message after manager2 join');
  assert.equal(replyMessage.replyTo?.author?.id, founderUser.id);
  assert.equal(replyMessage.replyTo?.isDeleted, false);

  const crossRoomReplyResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Invalid cross-room reply',
        replyToMessageId: sentMessage.id,
      }),
    },
  );
  assert.equal(crossRoomReplyResponse.status, 400);

  const forwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: objectsRoom.id }),
    },
  );
  assert.equal(forwardResponse.status, 201);
  const forwardedMessage = (await forwardResponse.json()) as {
    id: string;
    chatRoomId: string;
    text: string | null;
    forwardedFrom: {
      id: string;
      text: string | null;
      author: { id: string } | null;
      isAccessRestricted: boolean;
    } | null;
  };
  createdMessageIds.push(forwardedMessage.id);
  assert.equal(forwardedMessage.chatRoomId, objectsRoom.id);
  assert.equal(forwardedMessage.text, 'Message after manager2 join');
  assert.equal(forwardedMessage.forwardedFrom?.id, newCustomMessage.id);
  assert.equal(forwardedMessage.forwardedFrom?.isAccessRestricted, false);

  const managerObjectsMessagesResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${objectsRoom.id}/messages`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(managerObjectsMessagesResponse.status, 200);
  const managerObjectsMessages =
    (await managerObjectsMessagesResponse.json()) as Array<{
      id: string;
      forwardedFrom: {
        text: string | null;
        author: { id: string } | null;
        isAccessRestricted: boolean;
      } | null;
    }>;
  const managerVisibleForward = managerObjectsMessages.find(
    (message) => message.id === forwardedMessage.id,
  );
  assert.equal(managerVisibleForward?.forwardedFrom?.isAccessRestricted, false);
  assert.equal(
    managerVisibleForward?.forwardedFrom?.text,
    'Message after manager2 join',
  );
  assert.equal(managerVisibleForward?.forwardedFrom?.author?.id, founderUser.id);

  const leadershipSourceResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${leadershipRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Restricted leadership source' }),
    },
  );
  assert.equal(leadershipSourceResponse.status, 201);
  const leadershipSource = (await leadershipSourceResponse.json()) as {
    id: string;
  };
  createdMessageIds.push(leadershipSource.id);

  const restrictedForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${leadershipSource.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: customRoom.id }),
    },
  );
  assert.equal(restrictedForwardResponse.status, 201);
  const restrictedForward = (await restrictedForwardResponse.json()) as {
    id: string;
    forwardedFrom: { isAccessRestricted: boolean } | null;
  };
  createdMessageIds.push(restrictedForward.id);
  assert.equal(restrictedForward.forwardedFrom?.isAccessRestricted, false);

  const managerCustomMessagesAfterRestrictedForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(managerCustomMessagesAfterRestrictedForwardResponse.status, 200);
  const managerCustomMessagesAfterRestrictedForward =
    (await managerCustomMessagesAfterRestrictedForwardResponse.json()) as Array<{
      id: string;
      forwardedFrom: {
        text: string | null;
        author: { id: string } | null;
        isAccessRestricted: boolean;
      } | null;
    }>;
  const managerRestrictedForward =
    managerCustomMessagesAfterRestrictedForward.find(
      (message) => message.id === restrictedForward.id,
    );
  assert.equal(
    managerRestrictedForward?.forwardedFrom?.isAccessRestricted,
    true,
  );
  assert.equal(managerRestrictedForward?.forwardedFrom?.text, null);
  assert.equal(managerRestrictedForward?.forwardedFrom?.author, null);

  const attachmentOnlyForm = new FormData();
  attachmentOnlyForm.append(
    'files',
    new Blob(['attachment-only forward'], { type: 'text/plain' }),
    'attachment-only-forward.txt',
  );
  const attachmentOnlyMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
      body: attachmentOnlyForm,
    },
  );
  assert.equal(attachmentOnlyMessageResponse.status, 201);
  const attachmentOnlyMessage =
    (await attachmentOnlyMessageResponse.json()) as {
      id: string;
      attachments: Array<{ id: string }>;
    };
  createdMessageIds.push(attachmentOnlyMessage.id);
  createdFileIds.push(
    ...attachmentOnlyMessage.attachments.map((attachment) => attachment.id),
  );

  const attachmentOnlyForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${attachmentOnlyMessage.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: objectsRoom.id }),
    },
  );
  assert.equal(attachmentOnlyForwardResponse.status, 201);
  const attachmentOnlyForward =
    (await attachmentOnlyForwardResponse.json()) as {
      id: string;
      text: string | null;
      attachments: Array<{ id: string }>;
    };
  createdMessageIds.push(attachmentOnlyForward.id);
  assert.equal(attachmentOnlyForward.text, null);
  assert.deepEqual(
    attachmentOnlyForward.attachments.map((attachment) => attachment.id),
    attachmentOnlyMessage.attachments.map((attachment) => attachment.id),
  );

  const forbiddenForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: leadershipRoom.id }),
    },
  );
  assert.equal(forbiddenForwardResponse.status, 403);

  const founderHeartResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/reactions/heart`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(founderHeartResponse.status, 201);
  const founderHeartMessage = (await founderHeartResponse.json()) as {
    reactionCounts: Record<string, number>;
    myReactions: string[];
  };
  assert.equal(founderHeartMessage.reactionCounts.heart, 1);
  assert.deepEqual(founderHeartMessage.myReactions, ['heart']);

  const managerHeartResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/reactions/heart`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(managerHeartResponse.status, 201);
  const managerHeartMessage = (await managerHeartResponse.json()) as {
    reactionCounts: Record<string, number>;
    myReactions: string[];
  };
  assert.equal(managerHeartMessage.reactionCounts.heart, 2);
  assert.deepEqual(managerHeartMessage.myReactions, ['heart']);

  const founderHeartToggleOffResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/reactions/heart`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(founderHeartToggleOffResponse.status, 201);
  const founderHeartToggledOff =
    (await founderHeartToggleOffResponse.json()) as {
      reactionCounts: Record<string, number>;
      myReactions: string[];
    };
  assert.equal(founderHeartToggledOff.reactionCounts.heart, 1);
  assert.deepEqual(founderHeartToggledOff.myReactions, []);

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
  assert.equal(lateEditResponse.status, 200);
  const lateEditedMessage = (await lateEditResponse.json()) as {
    text: string;
    editedAt: string | null;
  };
  assert.equal(lateEditedMessage.text, 'Too late');
  assert.ok(lateEditedMessage.editedAt);

  const editHistory = await prisma.chatMessageEditHistory.findMany({
    where: { chatMessageId: newCustomMessage.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(editHistory.length, 2);
  assert.equal(editHistory[0]?.oldText, 'Message after manager2 join');
  assert.equal(editHistory[0]?.newText, 'Edited custom message');
  assert.equal(editHistory[1]?.oldText, 'Edited custom message');
  assert.equal(editHistory[1]?.newText, 'Too late');
  assert.equal(editHistory[1]?.editedByUserId, founderUser.id);

  const ordinaryMemberDeleteResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${newCustomMessage.id}/delete`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie },
    },
  );
  assert.equal(ordinaryMemberDeleteResponse.status, 403);

  const textAndAttachmentForm = new FormData();
  textAndAttachmentForm.set('text', 'Text and attachment forward source');
  textAndAttachmentForm.append(
    'files',
    new Blob(['text and attachment forward'], { type: 'text/plain' }),
    'text-and-attachment-forward.txt',
  );
  const textAndAttachmentSourceResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
      body: textAndAttachmentForm,
    },
  );
  assert.equal(textAndAttachmentSourceResponse.status, 201);
  const textAndAttachmentSource =
    (await textAndAttachmentSourceResponse.json()) as {
      id: string;
      attachments: Array<{ id: string }>;
    };
  createdMessageIds.push(textAndAttachmentSource.id);
  createdFileIds.push(
    ...textAndAttachmentSource.attachments.map((attachment) => attachment.id),
  );

  const textAndAttachmentForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${textAndAttachmentSource.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: objectsRoom.id }),
    },
  );
  assert.equal(textAndAttachmentForwardResponse.status, 201);
  const textAndAttachmentForward =
    (await textAndAttachmentForwardResponse.json()) as {
      id: string;
      text: string | null;
      attachments: Array<{ id: string }>;
    };
  createdMessageIds.push(textAndAttachmentForward.id);
  assert.equal(
    textAndAttachmentForward.text,
    'Text and attachment forward source',
  );
  assert.deepEqual(
    textAndAttachmentForward.attachments.map((attachment) => attachment.id),
    textAndAttachmentSource.attachments.map((attachment) => attachment.id),
  );

  const attachedDeleteForm = new FormData();
  attachedDeleteForm.set('text', 'Message with attachment to delete');
  attachedDeleteForm.append(
    'files',
    new Blob(['deleted chat attachment'], { type: 'text/plain' }),
    'deleted-chat-attachment.txt',
  );
  const attachedDeleteMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
      body: attachedDeleteForm,
    },
  );
  assert.equal(attachedDeleteMessageResponse.status, 201);
  const attachedDeleteMessage = (await attachedDeleteMessageResponse.json()) as {
    id: string;
    attachments: Array<{ id: string }>;
  };
  createdMessageIds.push(attachedDeleteMessage.id);
  createdFileIds.push(...attachedDeleteMessage.attachments.map((file) => file.id));
  assert.equal(attachedDeleteMessage.attachments.length, 1);

  const attachedFileId = attachedDeleteMessage.attachments[0]?.id;
  assert.ok(attachedFileId);
  const attachmentBeforeDeleteResponse = await fetch(
    `${baseUrl}/api/v1/files/${attachedFileId}/content`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(attachmentBeforeDeleteResponse.status, 200);

  const authorDeleteResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${attachedDeleteMessage.id}/delete`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(authorDeleteResponse.status, 201);
  const deletedMessage = (await authorDeleteResponse.json()) as {
    isDeleted: boolean;
    deletedAt: string | null;
    text: string | null;
    attachments: unknown[];
    capabilities: { canEdit: boolean; canDelete: boolean };
  };
  assert.equal(deletedMessage.isDeleted, true);
  assert.ok(deletedMessage.deletedAt);
  assert.equal(deletedMessage.text, 'Сообщение удалено');
  assert.deepEqual(deletedMessage.attachments, []);
  assert.deepEqual(deletedMessage.capabilities, {
    canEdit: false,
    canDelete: false,
  });

  const attachmentAfterDeleteResponse = await fetch(
    `${baseUrl}/api/v1/files/${attachedFileId}/content`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(attachmentAfterDeleteResponse.status, 403);

  const deletedForwardResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${attachedDeleteMessage.id}/forward`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetRoomId: objectsRoom.id }),
    },
  );
  assert.equal(deletedForwardResponse.status, 403);

  const deletedReactionResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${attachedDeleteMessage.id}/reactions/heart`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(deletedReactionResponse.status, 403);

  const deletedMessageSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent(
      'Message with attachment to delete',
    )}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(deletedMessageSearchResponse.status, 200);
  const deletedMessageSearch =
    (await deletedMessageSearchResponse.json()) as {
      messages: Array<{ id: string; text: string }>;
    };
  assert.equal(
    deletedMessageSearch.messages.some(
      (message) => message.id === attachedDeleteMessage.id,
    ),
    false,
  );

  const editDeletedResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${attachedDeleteMessage.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Deleted message edit attempt' }),
    },
  );
  assert.equal(editDeletedResponse.status, 403);

  const roomAfterAuthorDeleteResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms`,
    { headers: { Cookie: founderCookie } },
  );
  const roomAfterAuthorDelete = (
    (await roomAfterAuthorDeleteResponse.json()) as Array<{
      id: string;
      lastMessagePreview: string | null;
    }>
  ).find((room) => room.id === customRoom.id);
  assert.equal(roomAfterAuthorDelete?.lastMessagePreview, 'Сообщение удалено');

  const memberMessageResponse = await fetch(
    `${baseUrl}/api/v1/chats/rooms/${customRoom.id}/messages`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Member message for room admin delete' }),
    },
  );
  assert.equal(memberMessageResponse.status, 201);
  const memberMessage = (await memberMessageResponse.json()) as { id: string };
  createdMessageIds.push(memberMessage.id);

  const roomManagerDeleteResponse = await fetch(
    `${baseUrl}/api/v1/chats/messages/${memberMessage.id}/delete`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(roomManagerDeleteResponse.status, 201);
  const roomManagerDeletedMessage =
    (await roomManagerDeleteResponse.json()) as { isDeleted: boolean };
  assert.equal(roomManagerDeletedMessage.isDeleted, true);

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

  const leftRoomSearchResponse = await fetch(
    `${baseUrl}/api/v1/chats/search?q=${encodeURIComponent(
      'managed by global manager',
    )}`,
    { headers: { Cookie: managerTwoCookie } },
  );
  assert.equal(leftRoomSearchResponse.status, 200);
  const leftRoomSearch = (await leftRoomSearchResponse.json()) as {
    rooms: Array<{ id: string }>;
    messages: Array<{ roomId: string }>;
  };
  assert.equal(
    leftRoomSearch.rooms.some((room) => room.id === customRoom.id),
    false,
  );
  assert.equal(
    leftRoomSearch.messages.some((message) => message.roomId === customRoom.id),
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

  const closerRoomsBeforeCloseResponse = await fetch(`${baseUrl}/api/v1/chats/rooms`, {
    headers: { Cookie: closerCookie },
  });
  assert.equal(closerRoomsBeforeCloseResponse.status, 200);
  const closerRoomsBeforeClose =
    (await closerRoomsBeforeCloseResponse.json()) as Array<{
      id: string;
      capabilities: {
        canManage: boolean;
        canCloseGlobally: boolean;
      };
    }>;
  const closerCustomRoom = closerRoomsBeforeClose.find(
    (room) => room.id === customRoom.id,
  );
  assert.ok(closerCustomRoom);
  assert.equal(closerCustomRoom.capabilities.canCloseGlobally, true);

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
