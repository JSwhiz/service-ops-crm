import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('chats support default visibility, attachments, unread, custom join-point and edit window', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  const [managerOne, managerTwo] = await Promise.all([
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

    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerOneCookie, managerTwoCookie, hrCookie] =
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

  const objectsRoom = founderRooms.find((room) => room.code === 'objects');
  assert.ok(objectsRoom);

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
  const readRoom = (await markReadResponse.json()) as { unreadCount: number };
  assert.equal(readRoom.unreadCount, 0);

  const createRoomResponse = await fetch(`${baseUrl}/api/v1/chats/rooms`, {
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
  const customRoom = (await createRoomResponse.json()) as { id: string };
  createdRoomIds.push(customRoom.id);

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
});
