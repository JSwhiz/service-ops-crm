import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { TaskAutoCloseService } from '../src/modules/tasks/task-auto-close.service';
import { createTestApp } from './helpers/create-test-app';

test('task auto-close is due-aware, cycle-safe and idempotent', async (t) => {
  const prisma = new PrismaClient();
  const marker = randomUUID().slice(0, 8);
  const createdTaskIds: string[] = [];
  let app: Awaited<ReturnType<typeof createTestApp>>['app'] | null = null;
  const manager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
    select: { id: true },
  });

  t.after(async () => {
    await app?.close();
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.$disconnect();
  });

  const createPendingTask = async ({
    autoCloseAt,
    workCycle = 1,
    completionCycle = workCycle,
    isCompleted = true,
  }: {
    autoCloseAt: Date;
    workCycle?: number;
    completionCycle?: number | null;
    isCompleted?: boolean;
  }) => {
    const task = await prisma.task.create({
      data: {
        title: `Auto-close ${marker}`,
        priority: 'important_not_urgent',
        status: 'pending_auto_close',
        createdByUserId: manager.id,
        requiresConfirmation: false,
        completionRequirement: 'none',
        autoCloseAt,
        workCycle,
        assignees: {
          create: {
            userId: manager.id,
            isCompleted,
            completedAt: isCompleted ? new Date() : null,
            ...(completionCycle === null
              ? {}
              : {
                  completions: {
                    create: {
                      workCycle: completionCycle,
                      attemptNumber: 1,
                      completionText: null,
                      status: 'submitted',
                    },
                  },
                }),
          },
        },
      },
      select: { id: true },
    });
    createdTaskIds.push(task.id);
    return task.id;
  };

  const startupTaskId = await createPendingTask({
    autoCloseAt: new Date(Date.now() - 60_000),
  });
  ({ app } = await createTestApp());
  const worker = app.get(TaskAutoCloseService);

  const startupTask = await prisma.task.findUniqueOrThrow({
    where: { id: startupTaskId },
    select: { status: true, completedByKind: true },
  });
  assert.deepEqual(startupTask, {
    status: 'completed',
    completedByKind: 'auto',
  });

  const now = new Date();
  const futureDueAt = new Date(now.getTime() + 60_000);
  const futureTaskId = await createPendingTask({ autoCloseAt: futureDueAt });
  assert.equal(await worker.processDueTasks(now), 0);
  assert.equal(
    (
      await prisma.task.findUniqueOrThrow({
        where: { id: futureTaskId },
        select: { status: true },
      })
    ).status,
    'pending_auto_close',
  );
  assert.equal(
    await worker.processDueTasks(new Date(futureDueAt.getTime() + 1)),
    1,
  );

  const staleCycleTaskId = await createPendingTask({
    autoCloseAt: new Date(now.getTime() - 1),
    workCycle: 2,
    completionCycle: 1,
  });
  const incompleteTaskId = await createPendingTask({
    autoCloseAt: new Date(now.getTime() - 1),
    completionCycle: null,
    isCompleted: false,
  });
  assert.equal(await worker.processDueTasks(now), 0);
  const invalidTasks = await prisma.task.findMany({
    where: { id: { in: [staleCycleTaskId, incompleteTaskId] } },
    select: { status: true },
  });
  assert.ok(invalidTasks.every((task) => task.status === 'pending_auto_close'));

  const concurrentTaskId = await createPendingTask({
    autoCloseAt: new Date(now.getTime() - 1),
  });
  const completedCounts = await Promise.all([
    worker.processDueTasks(now),
    worker.processDueTasks(now),
  ]);
  assert.equal(completedCounts.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(
    await prisma.taskHistoryEvent.count({
      where: { taskId: concurrentTaskId, eventType: 'task.auto_closed' },
    }),
    1,
  );
});
