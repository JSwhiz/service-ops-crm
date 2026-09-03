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
  type LeadershipSummaryPreview,
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

function summaryPreview(params: LeadershipSummaryPreview): LeadershipPreviewTarget {
  return { kind: 'summary', item: params };
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

  const openAttentionPreview = (item: LeadershipAttentionItem): void => {
    if (item.kind === 'task' && item.taskId) {
      const task = (expandedData?.tasks.items ?? source?.tasks.items ?? []).find((candidate) => candidate.id === item.taskId);
      if (task) {
        setPreviewTarget({ kind: 'task', item: task });
        return;
      }
    }
    setPreviewTarget(summaryPreview({
      eyebrow: item.kind === 'approval' ? 'Согласование' : item.kind === 'object_issue' ? 'Объекты' : 'Задача',
      title: item.title,
      subtitle: item.subtitle,
      facts: [{ label: 'Состояние', value: item.meta }],
      href: attentionHref(item),
      actionLabel: 'Открыть выборку →',
    }));
  };

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
          <button className={styles.metricButton} type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Сегодня', title: 'Активные объекты', facts: [{ label: 'Объектов', value: String(source?.today.activeObjects ?? 0) }], href: '/objects?status=active' }))}><strong>{loading ? '—' : source?.today.activeObjects ?? 0}</strong><span>активных объектов</span></button>
          <button className={styles.metricButton} type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Сегодня', title: 'Сотрудники на объектах', facts: [{ label: 'Сотрудников', value: String(source?.today.employeesOnObjects ?? 0) }], href: '/employees?archiveState=active&hasActiveObjectAssignment=true' }))}><strong>{loading ? '—' : source?.today.employeesOnObjects ?? 0}</strong><span>сотрудников на объектах</span></button>
          <button className={`${styles.metricButton} ${source?.today.objectsWithoutAttendanceMark ? styles.alertLink : ''}`} type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Сегодня', title: 'Нет отметки присутствия', facts: [{ label: 'Объектов', value: String(source?.today.objectsWithoutAttendanceMark ?? 0) }, { label: 'Рабочее окно', value: '08:30–17:00' }], href: '/objects?status=active&issue=attendance_missing' }))}><strong>{loading ? '—' : source?.today.objectsWithoutAttendanceMark ?? 0}</strong><span>без отметки</span></button>
          <button className={styles.metricButton} type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Сегодня', title: 'Разовые заказы на сегодня', facts: [{ label: 'Заказов', value: String(source?.today.oneTimeOrders ?? 0) }], href: `/one-time-orders?dateFrom=${moscowNow().date}&dateTo=${moscowNow().date}&sortBy=executionStartDate&sortDirection=asc` }))}><strong>{loading ? '—' : source?.today.oneTimeOrders ?? 0}</strong><span>разовых сегодня</span></button>
          <button className={`${styles.metricButton} ${source?.today.decisionsRequired ? styles.alertLink : ''}`} type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Сегодня', title: 'Согласования от вас', facts: [{ label: 'Ожидают решения', value: String(source?.today.decisionsRequired ?? 0) }], href: '/approvals?status=pending' }))}><strong>{loading ? '—' : source?.today.decisionsRequired ?? 0}</strong><span>согласований от вас</span></button>
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
                  <button className={`${styles.row} ${styles.attentionRow} ${interactionStyles.entityRow}`} type="button" onClick={() => openAttentionPreview(item)} key={item.id}>
                    <span className={`${styles.badge} ${styles[item.tone]}`}>{item.badge}</span>
                    <span className={styles.copy}><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                    <span className={styles.meta}>{item.meta}</span>
                  </button>
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
                <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Деньги', title: 'Расходы на проверке', facts: [{ label: 'Записей', value: String(source.money.submittedExpenses) }], href: '/accountability/queue?view=submitted', secondaryHref: '/accountability', secondaryLabel: 'Весь подотчёт' }))}><span>Расходы на проверке</span><strong>{source.money.submittedExpenses}</strong><small>ожидают решения</small></button>
                <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Деньги', title: 'Закрытие подотчёта', facts: [{ label: 'Запросов', value: String(source.money.closingRequestedAccounts) }], href: '/accountability/queue?view=closing', secondaryHref: '/accountability', secondaryLabel: 'Весь подотчёт' }))}><span>Закрытие подотчёта</span><strong>{source.money.closingRequestedAccounts}</strong><small>ждут решения</small></button>
                <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Деньги', title: 'Приход по разовым', facts: [{ label: 'Сумма', value: formatMoney(source.money.oneTimeOrderReceipts.amount) }, { label: 'Поступлений', value: String(source.money.oneTimeOrderReceipts.count) }], href: '/accountability/queue?view=one_time_receipts', secondaryHref: '/accountability', secondaryLabel: 'Весь подотчёт' }))}><span>Приход по разовым</span><strong>{formatMoney(source.money.oneTimeOrderReceipts.amount)}</strong><small>{source.money.oneTimeOrderReceipts.count} поступлений</small></button>
              </div>
            </section> : null}

            <section className={styles.panel}>
              <header className={styles.head}><div className={styles.headTitle}><h2>Разовые заказы</h2></div><Link href="/one-time-orders/attention">Горящие →</Link></header>
              <div className={styles.rows}>
                {!loading && !(source?.orders.items.length ?? 0) ? <div className={styles.empty}>Нет активных заказов.</div> : (source?.orders.items ?? []).map((item) => (
                  <button className={`${styles.row} ${styles.orderRow} ${interactionStyles.entityRow}`} type="button" onClick={() => setPreviewTarget({ kind: 'order', item })} key={item.id}>
                    <span className={styles.copy}><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span>
                    <span className={`${styles.meta} ${styles.orderStatus}`}>{orderStatus(item.status)}</span>
                    <span className={`${styles.meta} ${styles.orderDate} ${item.executionStartDate?.slice(0, 10) && item.executionStartDate.slice(0, 10) < moscowNow().date ? styles.problem : ''}`}>{orderDate(item.executionStartDate)}</span>
                  </button>
                ))}
              </div>
            </section>

            {source?.people.available ? <section className={styles.panel}>
              <header className={styles.head}><div className={styles.headTitle}><h2>Люди</h2></div><Link href="/user-absences">График отсутствий →</Link></header>
              <div className={styles.peopleGrid}>
                <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Люди', title: 'Активные сотрудники', facts: [{ label: 'Сотрудников', value: String(source.people.activeEmployees) }], href: '/employees?archiveState=active' }))}><strong>{source.people.activeEmployees}</strong><span>активных сотрудников</span></button>
                <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Люди', title: 'Сотрудники без объекта', facts: [{ label: 'Сотрудников', value: String(source.people.employeesWithoutActiveObject) }], href: '/employees?archiveState=active&hasActiveObjectAssignment=false' }))}><strong>{source.people.employeesWithoutActiveObject}</strong><span>сотрудников без объекта</span></button>
                {source.people.overdueCandidateSla !== null ? <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Люди', title: 'Просроченный SLA кандидатов', facts: [{ label: 'Кандидатов', value: String(source.people.overdueCandidateSla ?? 0) }], href: '/candidates?archiveState=active&slaState=overdue' }))}><strong>{source.people.overdueCandidateSla}</strong><span>кандидатов с просроченным SLA</span></button> : <div><strong>—</strong><span>кандидаты недоступны</span></div>}
                {source.people.userAbsencesAvailable ? <button type="button" onClick={() => setPreviewTarget(summaryPreview({ eyebrow: 'Люди', title: 'Отсутствуют сегодня', facts: [{ label: 'Пользователей CRM', value: String(source.people.userAbsencesToday ?? 0) }], href: `/user-absences?from=${moscowNow().date}&to=${moscowNow().date}`, secondaryHref: '/user-absences', secondaryLabel: 'График отсутствий' }))}><strong>{source.people.userAbsencesToday ?? 0}</strong><span>пользователей CRM отсутствуют сегодня</span></button> : <div><strong>—</strong><span>график отсутствий недоступен</span></div>}
              </div>
            </section> : null}
          </div>
        </div>
      </div>

      <LeadershipPreviewDrawer target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </>
  );
}
