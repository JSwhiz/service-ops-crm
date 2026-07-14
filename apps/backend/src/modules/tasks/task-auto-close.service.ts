import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const AUTO_CLOSE_INTERVAL_MS = 30_000;
const AUTO_CLOSE_BATCH_SIZE = 100;

@Injectable()
export class TaskAutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskAutoCloseService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
      if (completedCount > 0) {
        this.logger.log(`Auto-completed ${completedCount} task(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Task auto-close pass failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
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
