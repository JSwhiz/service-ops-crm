'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { getLeadershipDashboard } from '@/entities/dashboard/api/dashboard-client';
import type {
  LeadershipAttentionItem,
  LeadershipDashboardResponse,
  LeadershipObjectIssue,
} from '@/entities/dashboard/model/dashboard.types';
import type { TaskItem } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import interactionStyles from './leadership-dashboard-interactions.module.css';
import styles from './leadership-dashboard.module.css';
import {
  LeadershipPreviewDrawer,
  type LeadershipPreviewTarget,
} from './leadership-preview-drawer';

const PREVIEW_LIMIT = 5;

function moscowNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((item) => item.type === type)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function greeting(): string {
  const hour = moscowNow().hour;
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function formatDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: 'short',
  }).format(new Date(value));
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
}

function taskIsMine(task: TaskItem, userId: string | undefined): boolean {
  return Boolean(task.myAssignment || task.assignees.some((item) => item.id === userId && item.isActive));
}

function taskTime(task: TaskItem): string {
  if (task.isOverdue) return task.dueAt ? `до ${formatDate(task.dueAt)}` : 'Просрочено';
  if (!task.dueAt) return 'Без срока';
  if (task.dueAt.slice(0, 10) === moscowNow().date) return 'Сегодня';
  return formatDate(task.dueAt);
}

function orderStatus(value: string): string {
  return ({
    in_progress: 'В работе', active: 'Активен', planned: 'Запланирован', new: 'Новый', draft: 'Черновик',
  } as Record<string, string>)[value] ?? value.replaceAll('_', ' ');
}

function orderDate(value: string | null): string {
  if (!value) return 'Без даты';
  const key = value.slice(0, 10);
  const today = moscowNow().date;
  if (key === today) return 'Сегодня';
  if (key < today) return `Просрочен · ${formatDate(value)}`;
  return formatDate(value);
}

function issueLabel(issue: LeadershipObjectIssue): string {
  return {
    no_responsible: 'нет ответственного',
    no_employees: 'нет сотрудников',
    attendance_missing: 'нет отметки',
    daily_report_missing: 'нет отчёта',
  }[issue];
}

function attentionHref(item: LeadershipAttentionItem): string {
  if (item.kind === 'task' && item.taskId) return `/tasks/${item.taskId}`;
  if (item.kind === 'approval' && item.approval) {
    const params = new URLSearchParams({
      status: 'pending',
      sourceEntityType: item.approval.sourceEntityType,
      sourceEntityId: item.approval.sourceEntityId,
    });
    return `/approvals?${params.toString()}`;
  }
  if (item.kind === 'object_issue' && item.objectIssueCode) {
    return `/objects?status=active&issue=${item.objectIssueCode}`;
  }
  return '/dashboard';
}

export function LeadershipDashboard(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<LeadershipDashboardResponse | null>(null);
  const [expandedData, setExpandedData] = useState<LeadershipDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState(false);
  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<LeadershipPreviewTarget | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadWarning(false);
    setExpandedData(null);
    setAttentionExpanded(false);
    setTasksExpanded(false);
    setPreviewTarget(null);

    void getLeadershipDashboard()
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoadWarning(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [user]);

  const ensureExpanded = async (): Promise<LeadershipDashboardResponse | null> => {
    if (expandedData) return expandedData;
    try {
      const response = await getLeadershipDashboard(true);
      setExpandedData(response);
      return response;
    } catch {
      setLoadWarning(true);
      return null;
    }
  };

  const toggleAttention = async (): Promise<void> => {
    if (attentionExpanded) {
      setAttentionExpanded(false);
      return;
    }
    if (await ensureExpanded()) setAttentionExpanded(true);
  };

  const toggleTasks = async (): Promise<void> => {
    if (tasksExpanded) {
      setTasksExpanded(false);
      return;
    }
    if (await ensureExpanded()) setTasksExpanded(true);
  };

  const source = data;
  const attentionItems = attentionExpanded
    ? expandedData?.attention.items ?? source?.attention.items ?? []
    : source?.attention.items ?? [];
  const taskItems = tasksExpanded
    ? expandedData?.tasks.items ?? source?.tasks.items ?? []
    : source?.tasks.items ?? [];
  const attentionTotal = source?.attention.total ?? 0;
  const taskTotal = source?.tasks.totalRelevant ?? 0;
  const displayName = user ? firstName(getUserDisplayName(user)) : '';

  return (
    <>
      <div className={styles.root}>
        <section className={styles.intro}>
          <div>
            <h1>{greeting()}{displayName ? `, ${displayName}` : ''}</h1>
            <p>{loading ? 'Обновляем рабочую сводку…' : attentionTotal ? `На сегодня ${attentionTotal} ${attentionTotal === 1 ? 'сигнал требует' : 'сигналов требуют'} внимания` : 'На сегодня срочных вопросов нет'}</p>
          </div>
          <span className={`${styles.health} ${attentionTotal ? styles.healthAttention : ''}`}><i />{loading ? 'Обновление' : attentionTotal ? 'Есть приоритеты' : 'Спокойный контур'}</span>
        </section>

        {loadWarning ? <div className={styles.notice}>Рабочую сводку не удалось обновить полностью. Повторите загрузку страницы.</div> : null}

        <section className={styles.today} aria-label="Сегодня">
          <div className={styles.todayLabel}>Сегодня</div>
          <Link href="/objects?status=active"><strong>{loading ? '—' : source?.today.activeObjects ?? 0}</strong><span>активных объектов</span></Link>
          <Link href="/employees?archiveState=active&hasActiveObjectAssignment=true"><strong>{loading ? '—' : source?.today.employeesOnObjects ?? 0}</strong><span>сотрудников на объектах</span></Link>
          <Link className={source?.today.objectsWithoutAttendanceMark ? styles.alertLink : ''} href="/objects?status=active&issue=attendance_missing"><strong>{loading ? '—' : source?.today.objectsWithoutAttendanceMark ?? 0}</strong><span>без отметки</span></Link>
          <Link href={`/one-time-orders?dateFrom=${moscowNow().date}&dateTo=${moscowNow().date}&sortBy=executionStartDate&sortDirection=asc`}><strong>{loading ? '—' : source?.today.oneTimeOrders ?? 0}</strong><span>разовых сегодня</span></Link>
          <Link className={source?.today.decisionsRequired ? styles.alertLink : ''} href="/approvals?status=pending"><strong>{loading ? '—' : source?.today.decisionsRequired ?? 0}</strong><span>согласований от вас</span></Link>
        </section>

        <div className={styles.grid}>
          <div className={styles.column}>
            <section className={styles.panel}>
              <header className={styles.head}>
                <div className={styles.headTitle}><h2>Требует внимания</h2><span className={styles.count}>{attentionTotal}</span></div>
                {attentionTotal > PREVIEW_LIMIT ? <button className={styles.expandButton} type="button" onClick={() => void toggleAttention()}>{attentionExpanded ? 'Свернуть' : `Ещё ${attentionTotal - PREVIEW_LIMIT}`}</button> : null}
              </header>
              <div className={styles.rows}>
                {!loading && !attentionItems.length ? <div className={styles.empty}><strong>Нет срочных вопросов</strong></div> : attentionItems.map((item) => (
                  <Link className={`${styles.row} ${styles.attentionRow}`} href={attentionHref(item)} key={item.id}>
                    <span className={`${styles.badge} ${styles[item.tone]}`}>{item.badge}</span>
                    <span className={styles.copy}><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                    <span className={styles.meta}>{item.meta}</span>
                  </Link>
                ))}
              </div>
            </section>

            <section className={styles.panel}>
              <header className={styles.head}>
                <div className={styles.headTitle}><h2>Объекты</h2>{source?.objects.problematic ? <span className={styles.count}>{source.objects.problematic}</span> : null}</div>
                <Link href={source?.objects.problematic ? '/objects?status=active&issue=attention' : '/objects?status=active'}>{source?.objects.problematic ? 'Проблемные' : 'Все'} →</Link>
              </header>
              <div className={styles.sectionSummary}><strong>{loading ? '—' : source?.objects.active ?? 0}</strong><span>активных</span><span>{source?.objects.problematic ? `${source.objects.problematic} требуют внимания` : 'Проблем не обнаружено'}</span></div>
              <div className={styles.rows}>
                {(source?.objects.items ?? []).map((item) => (
                  <button className={`${styles.row} ${styles.objectRow} ${interactionStyles.entityRow}`} type="button" onClick={() => setPreviewTarget({ kind: 'object', item })} key={item.id}>
                    <span className={styles.copy}><strong>{item.name}</strong><small>{item.address}</small></span>
                    <span className={`${styles.meta} ${item.issues.length ? styles.problem : ''}`}>{item.issues.length ? item.issues.map(issueLabel).join(' · ') : item.responsible?.fullName ?? '—'}</span>
                    <span className={styles.meta}>{item.employeeCount} чел.</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className={styles.column}>
            <section className={styles.panel}>
              <header className={styles.head}>
                <div className={styles.headTitle}><h2>Мои задачи</h2><span className={styles.count}>{taskTotal}</span></div>
                <div className={styles.headActions}>{taskTotal > PREVIEW_LIMIT ? <button className={styles.expandButton} type="button" onClick={() => void toggleTasks()}>{tasksExpanded ? 'Свернуть' : `Ещё ${taskTotal - PREVIEW_LIMIT}`}</button> : null}<Link href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc">В реестр →</Link></div>
              </header>
              <div className={styles.rows}>
                {!loading && !taskItems.length ? <div className={styles.empty}>Ближайших задач нет.</div> : taskItems.map((task) => {
                  const mine = taskIsMine(task, user?.id);
                  const dueToday = Boolean(task.dueAt && task.dueAt.slice(0, 10) === moscowNow().date);
                  return (
                    <button className={`${styles.row} ${styles.taskRow} ${interactionStyles.entityRow}`} type="button" onClick={() => setPreviewTarget({ kind: 'task', item: task })} key={task.id}>
                      <span className={`${styles.badge} ${task.isOverdue ? styles.danger : dueToday ? styles.warning : styles.neutral}`}>{task.isOverdue ? 'Просрочено' : dueToday ? 'Сегодня' : mine ? 'Назначено' : 'Компания'}</span>
                      <span className={styles.copy}><strong>{task.title}</strong><small>{task.targetName || 'Без привязки'}</small></span>
                      <span className={styles.metaStrong}>{taskTime(task)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {source?.money.available ? <section className={styles.panel}>
              <header className={styles.head}><div className={styles.headTitle}><h2>Деньги</h2>{source.money.submittedExpenses + source.money.closingRequestedAccounts ? <span className={styles.count}>{source.money.submittedExpenses + source.money.closingRequestedAccounts}</span> : null}</div><Link href="/accountability">Подотчёт →</Link></header>
              <div className={styles.triplet}>
                <Link href="/accountability/queue?view=submitted"><span>Расходы на проверке</span><strong>{source.money.submittedExpenses}</strong><small>ожидают решения</small></Link>
                <Link href="/accountability/queue?view=closing"><span>Закрытие подотчёта</span><strong>{source.money.closingRequestedAccounts}</strong><small>ждут решения</small></Link>
                <Link href="/accountability/queue?view=one_time_receipts"><span>Приход по разовым</span><strong>{formatMoney(source.money.oneTimeOrderReceipts.amount)}</strong><small>{source.money.oneTimeOrderReceipts.count} поступлений</small></Link>
              </div>
            </section> : null}

            <section className={styles.panel}>
              <header className={styles.head}><div className={styles.headTitle}><h2>Разовые заказы</h2></div><Link href="/one-time-orders?sortBy=executionStartDate&sortDirection=asc">По сроку →</Link></header>
              <div className={styles.rows}>
                {!loading && !(source?.orders.items.length ?? 0) ? <div className={styles.empty}>Нет активных заказов.</div> : (source?.orders.items ?? []).map((item) => (
                  <button className={`${styles.row} ${styles.orderRow} ${interactionStyles.entityRow}`} type="button" onClick={() => setPreviewTarget({ kind: 'order', item })} key={item.id}>
                    <span className={styles.copy}><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span>
                    <span className={styles.meta}>{orderStatus(item.status)}</span>
                    <span className={`${styles.meta} ${item.executionStartDate?.slice(0, 10) && item.executionStartDate.slice(0, 10) < moscowNow().date ? styles.problem : ''}`}>{orderDate(item.executionStartDate)}</span>
                  </button>
                ))}
              </div>
            </section>

            {source?.people.available ? <section className={styles.panel}>
              <header className={styles.head}><div className={styles.headTitle}><h2>Люди</h2></div><Link href="/employees?archiveState=active">Все →</Link></header>
              <div className={styles.triplet}>
                <Link href="/employees?archiveState=active"><strong>{source.people.activeEmployees}</strong><span>активных сотрудников</span></Link>
                <Link href="/employees?archiveState=active&hasActiveObjectAssignment=false"><strong>{source.people.employeesWithoutActiveObject}</strong><span>без объекта</span></Link>
                {source.people.overdueCandidateSla !== null ? <Link href="/candidates?archiveState=active&slaState=overdue"><strong>{source.people.overdueCandidateSla}</strong><span>кандидатов с просроченным SLA</span></Link> : <div><strong>—</strong><span>кандидаты недоступны</span></div>}
              </div>
            </section> : null}
          </div>
        </div>
      </div>

      <LeadershipPreviewDrawer target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </>
  );
}
