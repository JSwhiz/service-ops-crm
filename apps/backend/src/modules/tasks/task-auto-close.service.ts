import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const AUTO_CLOSE_INTERVAL_MS = 30_000;
const AUTO_CLOSE_BATCH_SIZE = 100;

@Injectable()
export class TaskAutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskAutoCloseService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private activePass: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runScheduledPass();
    this.timer = setInterval(() => {
      void this.runScheduledPass();
    }, AUTO_CLOSE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processDueTasks(now = new Date()): Promise<number> {
    if (this.activePass) {
      return 0;
    }

    const pass = this.processDueTasksBatch(now);
    this.activePass = pass;

    try {
      return await pass;
    } finally {
      if (this.activePass === pass) {
        this.activePass = null;
      }
    }
  }

  private async processDueTasksBatch(now: Date): Promise<number> {
    const candidates = await this.prisma.task.findMany({
      where: {
        status: 'pending_auto_close',
        requiresConfirmation: false,
        autoCloseAt: { lte: now },
      },
      orderBy: [{ autoCloseAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: AUTO_CLOSE_BATCH_SIZE,
    });

    let completedCount = 0;
    for (const candidate of candidates) {
      completedCount += await this.completeCandidate(candidate.id, now);
    }

    return completedCount;
  }

  private async runScheduledPass(): Promise<void> {
    try {
      const completedCount = await this.processDueTasks();
      const overdueTaskCount = await this.processOverdueTasks();
      if (completedCount > 0) {
        this.logger.log(`Auto-completed ${completedCount} task(s)`);
      }
      if (overdueTaskCount > 0) {
        this.logger.log(`Created overdue notifications for ${overdueTaskCount} task(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Task auto-close pass failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async processOverdueTasks(now = new Date()): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: 'in_progress',
        dueAt: { lte: now },
        assignees: { some: { isActive: true } },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        createdByUserId: true,
        assignees: {
          where: {
            isActive: true,
            user: { isActive: true, deletedAt: null },
          },
          select: { userId: true },
        },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: AUTO_CLOSE_BATCH_SIZE,
    });

    for (const task of tasks) {
      if (!task.dueAt) continue;
      await this.notificationsService.createForRecipients({
        recipientUserIds: [
          ...task.assignees.map(({ userId }) => userId),
          task.createdByUserId,
        ],
        type: 'task.overdue',
        title: 'Срок задачи истёк',
        body: task.title,
        entityType: 'task',
        entityId: task.id,
        targetUrl: `/tasks?taskId=${encodeURIComponent(task.id)}`,
        dedupeKey: `task:${task.id}:overdue:${task.dueAt.toISOString()}`,
      });
    }

    return tasks.length;
  }

  private async completeCandidate(taskId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${taskId} FOR UPDATE`;
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          requiresConfirmation: true,
          autoCloseAt: true,
          workCycle: true,
          assignees: {
            where: { isActive: true },
            select: {
              isCompleted: true,
              completions: {
                where: { status: 'submitted' },
                select: { workCycle: true },
              },
            },
          },
        },
      });

      if (
        !task ||
        task.status !== 'pending_auto_close' ||
        task.requiresConfirmation ||
        !task.autoCloseAt ||
        task.autoCloseAt.getTime() > now.getTime() ||
        task.assignees.length === 0 ||
        !task.assignees.every(
          (assignment) =>
            assignment.isCompleted &&
            assignment.completions.some(
              (completion) => completion.workCycle === task.workCycle,
            ),
        )
      ) {
        return 0;
      }

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          completedAt: now,
          completedByUserId: null,
          completedByKind: 'auto',
          autoCloseAt: null,
        },
      });
      await tx.taskHistoryEvent.create({
        data: {
          taskId: task.id,
          actorUserId: null,
          eventType: 'task.auto_closed',
          payload: {
            workCycle: task.workCycle,
            completedByKind: 'auto',
            completedAt: now.toISOString(),
          } satisfies Prisma.InputJsonValue,
        },
      });

      return 1;
    });
  }
}
