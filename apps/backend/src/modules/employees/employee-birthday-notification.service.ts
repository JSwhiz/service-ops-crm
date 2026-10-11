import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { LEADERSHIP_OBJECT_ROLE_CODES } from '../objects/utils/object-access.util';

const BIRTHDAY_CHECK_INTERVAL_MS = 5 * 60_000;
const BUSINESS_TIME_ZONE = 'Europe/Moscow';

@Injectable()
export class EmployeeBirthdayNotificationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EmployeeBirthdayNotificationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private activePass: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.runScheduledPass();
    this.timer = setInterval(() => void this.runScheduledPass(), BIRTHDAY_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async notifyTodaysBirthdays(now = new Date()): Promise<number> {
    if (this.activePass) return 0;
    const pass = this.processBirthdays(now);
    this.activePass = pass;
    try {
      return await pass;
    } finally {
      if (this.activePass === pass) this.activePass = null;
    }
  }

  private async processBirthdays(now: Date): Promise<number> {
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = Number(dateParts.find(({ type }) => type === 'year')?.value);
    const month = Number(dateParts.find(({ type }) => type === 'month')?.value);
    const day = Number(dateParts.find(({ type }) => type === 'day')?.value);

    const [employees, recipients] = await Promise.all([
      this.prisma.employee.findMany({
        where: { deletedAt: null, employmentStatus: 'active', birthDate: { not: null } },
        select: { id: true, fullName: true, birthDate: true },
      }),
      this.notificationsService.listActiveUserIdsByRoles([
        'hr',
        ...LEADERSHIP_OBJECT_ROLE_CODES,
      ]),
    ]);
    const recipientsWithoutDuplicates = [...new Set(recipients)];
    const employeesWithBirthday = employees.filter(({ birthDate }) =>
      birthDate?.getUTCMonth() === month - 1 && birthDate.getUTCDate() === day,
    );

    for (const employee of employeesWithBirthday) {
      await this.notificationsService.createForRecipients({
        recipientUserIds: recipientsWithoutDuplicates,
        type: 'employee.birthday',
        title: 'Сегодня день рождения сотрудника',
        body: employee.fullName,
        entityType: 'employee',
        entityId: employee.id,
        targetUrl: `/employees/${encodeURIComponent(employee.id)}`,
        dedupeKey: `employee:${employee.id}:birthday:${year}`,
      });
    }

    return employeesWithBirthday.length;
  }

  private async runScheduledPass(): Promise<void> {
    try {
      const count = await this.notifyTodaysBirthdays();
      if (count > 0) this.logger.log(`Processed ${count} employee birthday(s)`);
    } catch (error) {
      this.logger.error(
        'Employee birthday notification pass failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
