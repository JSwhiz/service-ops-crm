import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const REMINDER_INTERVAL_MS = 60_000;
const REMINDER_BATCH_SIZE = 100;

@Injectable()
export class CandidateReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandidateReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private activePass: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runScheduledPass();
    this.timer = setInterval(() => void this.runScheduledPass(), REMINDER_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processOverdueAssignments(now = new Date()): Promise<number> {
    if (this.activePass) return 0;
    const pass = this.processBatch(now);
    this.activePass = pass;
    try {
      return await pass;
    } finally {
      if (this.activePass === pass) this.activePass = null;
    }
  }

  private async processBatch(now: Date): Promise<number> {
    const candidates = await this.prisma.candidateManagerAssignment.findMany({
      where: {
        endedAt: null,
        firstRespondedAt: null,
        reminderSentAt: null,
        responseDueAt: { lte: now },
        candidate: { deletedAt: null, status: { notIn: ['accepted', 'rejected'] } },
      },
      select: { id: true },
      orderBy: [{ responseDueAt: 'asc' }, { id: 'asc' }],
      take: REMINDER_BATCH_SIZE,
    });
    let sent = 0;
    for (const candidate of candidates) sent += await this.claimAndNotify(candidate.id, now);
    return sent;
  }

  private async claimAndNotify(assignmentId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "candidate_manager_assignments" WHERE "id" = ${assignmentId} FOR UPDATE`;
      const assignment = await tx.candidateManagerAssignment.findUnique({
        where: { id: assignmentId },
        include: { candidate: true },
      });
      if (!assignment || assignment.endedAt || assignment.firstRespondedAt || assignment.reminderSentAt || assignment.responseDueAt > now || assignment.candidate.deletedAt || ['accepted', 'rejected'].includes(assignment.candidate.status)) return 0;

      await this.notificationsService.create({
        recipientUserId: assignment.managerUserId,
        type: 'candidate.response_overdue',
        title: `Просрочен ответ по кандидату ${assignment.candidate.fullName}`,
        body: 'Пожалуйста, добавьте ответ по кандидату.',
        entityType: 'candidate',
        entityId: assignment.candidateId,
        targetUrl: `/candidates/${assignment.candidateId}`,
        dedupeKey: `candidate:${assignment.candidateId}:assignment:${assignment.id}:overdue`,
      }, tx);
      await tx.candidateManagerAssignment.update({
        where: { id: assignment.id },
        data: { reminderSentAt: now },
      });
      return 1;
    });
  }

  private async runScheduledPass(): Promise<void> {
    try {
      const count = await this.processOverdueAssignments();
      if (count > 0) this.logger.log(`Created ${count} candidate SLA reminder(s)`);
    } catch (error) {
      this.logger.error('Candidate SLA reminder pass failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
