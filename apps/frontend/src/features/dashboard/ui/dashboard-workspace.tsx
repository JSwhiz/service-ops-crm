'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { getAccountabilityAccountByUserId, listAccountabilityAccounts } from '@/entities/accountability/api/accountability-client';
import type { AccountabilityAccountListItem } from '@/entities/accountability/model/accountability.types';
import { listApprovalRequests } from '@/entities/approval/api/approval-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import { listCandidates } from '@/entities/candidate/api/candidate-client';
import { listEmployees } from '@/entities/employee/api/employee-client';
import type { EmployeeListResponse } from '@/entities/employee/model/employee.types';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import { listTasks } from '@/entities/task/api/task-client';
import type { TaskItem, TaskListResponse } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './dashboard-workspace.module.css';

type MoneyState = { accounts: AccountabilityAccountListItem[]; submitted: number; closures: number; receiptCount: number; receiptAmount: number };
type DashboardData = { approvals: ApprovalRequestItem[]; tasks: TaskListResponse; objects: ServiceObject[]; orders: OneTimeOrderListResponse; employees: EmployeeListResponse; unassignedEmployees: number; overdueCandidates: number; money: MoneyState };

const EMPTY_TASKS: TaskListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_ORDERS: OneTimeOrderListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_EMPLOYEES: EmployeeListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0, capabilities: { canCreate: false } };
const EMPTY_MONEY: MoneyState = { accounts: [], submitted: 0, closures: 0, receiptCount: 0, receiptAmount: 0 };

function moscowHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(new Date()));
}
function greeting(): string { const h = moscowHour(); return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; }
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || value; }
function dateKey(value: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(value)) : 'Без срока'; }
function money(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽'; }
function orderStatus(value: string): string { return ({ in_progress: 'В работе', active: 'Активен', completed: 'Завершён', cancelled: 'Отменён', draft: 'Черновик' } as Record<string,string>)[value] ?? value.replaceAll('_',' '); }

function buildAttention(approvals: ApprovalRequestItem[], tasks: TaskItem[]): Array<{ id:string; href:string; badge:string; tone:'danger'|'warning'|'neutral'; title:string; subtitle:string; date:string }> {
  const today = dateKey(new Date());
  const rows = [
    ...tasks.filter((task) => task.isOverdue && task.status !== 'completed').map((task) => ({ id:`task-overdue-${task.id}`, href:`/tasks/${task.id}`, badge:'Просрочено', tone:'danger' as const, title:task.title, subtitle:task.targetName || 'Без привязки', date:formatDate(task.dueAt) })),
    ...approvals.map((item) => ({ id:`approval-${item.id}`, href:'/approvals', badge:'Согласование', tone:'warning' as const, title:item.summary.title, subtitle:item.summary.subtitle ?? 'Ожидает решения', date:formatDate(item.createdAt) })),
    ...tasks.filter((task) => !task.isOverdue && task.dueAt && dateKey(new Date(task.dueAt)) === today && task.status !== 'completed').map((task) => ({ id:`task-today-${task.id}`, href:`/tasks/${task.id}`, badge:'Сегодня', tone:'warning' as const, title:task.title, subtitle:task.targetName || 'Без привязки', date:'Сегодня' })),
    ...tasks.filter((task) => task.status === 'awaiting_confirmation' && !task.isOverdue).map((task) => ({ id:`task-confirm-${task.id}`, href:`/tasks/${task.id}`, badge:'Подтверждение', tone:'neutral' as const, title:task.title, subtitle:task.targetName || 'Без привязки', date:formatDate(task.dueAt) })),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => { const entity = row.id.replace(/^(task-overdue-|task-today-|task-confirm-)/,'task-'); if (seen.has(entity)) return false; seen.add(entity); return true; }).slice(0,5);
}

export function DashboardWorkspace(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>({ approvals:[], tasks:EMPTY_TASKS, objects:[], orders:EMPTY_ORDERS, employees:EMPTY_EMPLOYEES, unassignedEmployees:0, overdueCandidates:0, money:EMPTY_MONEY });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);
    const loadMoney = async (): Promise<MoneyState> => {
      if (!user?.capabilities?.canReviewAccountability) return EMPTY_MONEY;
      const accounts = await safe(listAccountabilityAccounts(), []);
      const submitted = accounts.reduce((sum, account) => sum + account.summary.submittedExpensesCount, 0);
      const closures = accounts.filter((account) => account.status === 'closing_requested').length;
      const details = await Promise.all(accounts.map((account) => safe(getAccountabilityAccountByUserId(account.user.id), null)));
      const receipts = details.flatMap((detail) => detail?.fundings ?? []).filter((funding) => funding.fundingType === 'one_time_order_receipt' && funding.entryDirection === 'credit');
      return { accounts, submitted, closures, receiptCount: receipts.length, receiptAmount: receipts.reduce((sum, item) => sum + Number(item.amount), 0) };
    };

    setLoading(true); setFailed(false);
    void Promise.all([
      safe(listApprovalRequests({ status:'pending' }), []),
      safe(listTasks({ page:1, limit:24, sortBy:'dueAt', sortDirection:'asc' }), EMPTY_TASKS),
      safe(listObjects(), []),
      safe(listOneTimeOrders({ page:1, limit:8, sortBy:'executionStartDate', sortDirection:'asc' }), EMPTY_ORDERS),
      safe(listEmployees({ archiveState:'active', page:1, limit:1 }), EMPTY_EMPLOYEES),
      safe(listEmployees({ archiveState:'active', hasActiveObjectAssignment:false, page:1, limit:1 }), EMPTY_EMPLOYEES),
      user?.capabilities?.canAccessCandidates ? safe(listCandidates({ slaState:'overdue', archiveState:'active', page:1, limit:1 }), { items:[], page:1, limit:1, total:0, totalPages:0 }) : Promise.resolve({ items:[], page:1, limit:1, total:0, totalPages:0 }),
      loadMoney(),
    ]).then(([approvals,tasks,objects,orders,employees,unassigned,candidates,moneyState]) => {
      if (!active) return;
      setData({ approvals,tasks,objects,orders,employees,unassignedEmployees:unassigned.total,overdueCandidates:candidates.total,money:moneyState });
      setLoading(false);
    }).catch(() => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [user?.capabilities?.canAccessCandidates, user?.capabilities?.canReviewAccountability]);

  const attention = useMemo(() => buildAttention(data.approvals, data.tasks.items), [data.approvals, data.tasks.items]);
  const activeObjects = useMemo(() => data.objects.filter((item) => item.status === 'active'), [data.objects]);
  const problemObjects = useMemo(() => activeObjects.filter((item) => !item.responsible), [activeObjects]);
  const objectPreview = useMemo(() => [...problemObjects, ...activeObjects.filter((item) => item.responsible)].slice(0,4), [activeObjects, problemObjects]);
  const orders = useMemo(() => data.orders.items.filter((item) => !['completed','cancelled'].includes(item.status)).slice(0,4), [data.orders.items]);
  const attentionCount = data.approvals.length + data.tasks.items.filter((item) => item.isOverdue && item.status !== 'completed').length;
  const name = user ? firstName(getUserDisplayName(user)) : '';

  return <div className={styles.root}>
    <section className={styles.intro}>
      <div className={styles.introCopy}><div className={styles.greeting}>{greeting()}{name ? `, ${name}` : ''}</div><div className={styles.summary}>{loading ? 'Обновляем рабочую сводку…' : attentionCount > 0 ? `На сегодня ${attentionCount} ${attentionCount === 1 ? 'вопрос требует' : 'вопроса требуют'} внимания` : 'На сегодня срочных вопросов нет'}</div></div>
      <div className={styles.health}><i className={`${styles.dot} ${attentionCount > 0 ? styles.attentionDot : ''}`} />{loading ? 'Обновление' : attentionCount > 0 ? 'Есть приоритеты' : 'Спокойный контур'}</div>
    </section>
    {failed ? <div className={styles.notice}>Часть данных рабочего стола временно недоступна.</div> : null}

    <div className={styles.grid}>
      <div className={styles.left}>
        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Требует внимания</h2><span className={styles.count}>{attention.length}</span></div><Link href="/tasks">Все →</Link></header>
          <div className={styles.rows}>{loading ? <div className={styles.empty}>Загружаем сигналы…</div> : attention.length === 0 ? <div className={styles.empty}><strong>Нет срочных вопросов</strong></div> : attention.map((item) => <Link className={styles.row} href={item.href} key={item.id}><span className={`${styles.badge} ${item.tone === 'danger' ? styles.danger : item.tone === 'warning' ? styles.warning : ''}`}>{item.badge}</span><span className={styles.rowCopy}><strong>{item.title}</strong><small>{item.subtitle}</small></span><span className={styles.meta}>{item.date}</span></Link>)}</div>
        </section>

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Объекты</h2>{problemObjects.length > 0 ? <span className={styles.count}>{problemObjects.length}</span> : null}</div><Link href="/objects">Все →</Link></header>
          <div className={styles.sectionSummary}><strong>{loading ? '—' : activeObjects.length}</strong><span>активных</span><span>{problemObjects.length > 0 ? `${problemObjects.length} требуют внимания` : 'Проблем не обнаружено'}</span></div>
          <div className={styles.rows}>{objectPreview.map((item) => <Link className={`${styles.row} ${styles.objectRow}`} href={`/objects/${item.id}`} key={item.id}><span className={styles.rowCopy}><strong>{item.name}</strong><small>{item.address}</small></span><span className={`${styles.meta} ${!item.responsible ? styles.problem : ''}`}>{item.responsible?.fullName ?? 'Нет ответственного'}</span><span className={styles.meta}>{item.employees.length} чел.</span></Link>)}</div>
        </section>
      </div>

      <div className={styles.right}>
        {user?.capabilities?.canAccessAccountability ? <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Деньги</h2>{data.money.submitted + data.money.closures > 0 ? <span className={styles.count}>{data.money.submitted + data.money.closures}</span> : null}</div><Link href="/accountability">Подотчёт →</Link></header>
          <div className={styles.finance}>
            <Link href="/accountability" className={styles.financeItem}><span>Расходы на проверке</span><strong>{loading ? '—' : data.money.submitted}</strong><small>submitted</small></Link>
            <Link href="/accountability" className={styles.financeItem}><span>Закрытие подотчёта</span><strong>{loading ? '—' : data.money.closures}</strong><small>ждут решения</small></Link>
            <Link href="/accountability" className={styles.financeItem}><span>Приход по разовым</span><strong>{loading ? '—' : money(data.money.receiptAmount)}</strong><small>{data.money.receiptCount} поступлений</small></Link>
          </div>
        </section> : null}

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Разовые заказы</h2></div><Link href="/one-time-orders">Все →</Link></header>
          <div className={styles.rows}>{orders.length === 0 && !loading ? <div className={styles.empty}>Нет ближайших активных заказов.</div> : orders.map((item) => <Link className={`${styles.row} ${styles.orderRow}`} href={`/one-time-orders/${item.id}`} key={item.id}><span className={styles.rowCopy}><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span><span className={styles.meta}>{orderStatus(item.status)}</span><span className={styles.meta}>{formatDate(item.executionStartDate)}</span></Link>)}</div>
        </section>

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Люди</h2></div><Link href="/employees">Все →</Link></header>
          <div className={styles.people}>
            <Link href="/employees" className={styles.peopleItem}><strong>{loading ? '—' : data.employees.total}</strong><span>активных сотрудников</span></Link>
            <Link href="/employees?hasActiveObjectAssignment=false" className={styles.peopleItem}><strong>{loading ? '—' : data.unassignedEmployees}</strong><span>без объекта</span></Link>
            {user?.capabilities?.canAccessCandidates ? <Link href="/candidates?slaState=overdue" className={styles.peopleItem}><strong>{loading ? '—' : data.overdueCandidates}</strong><span>кандидатов с просроченным SLA</span></Link> : <div className={styles.peopleItem}><strong>—</strong><span>кандидаты недоступны</span></div>}
          </div>
        </section>
      </div>
    </div>
  </div>;
}
