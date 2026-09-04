'use client';

import React, { useEffect, useState } from 'react';

import { getHrDashboard } from '@/entities/dashboard/api/dashboard-client';
import type { HrDashboardResponse } from '@/entities/dashboard/model/dashboard.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import {
  DashboardEmpty,
  DashboardKpi,
  DashboardKpiGrid,
  DashboardMetric,
  DashboardPanel,
  DashboardRow,
  DashboardRows,
  DashboardSummaryStrip,
} from './dashboard-primitives';
import {
  LeadershipPreviewDrawer,
  type LeadershipPreviewTarget,
} from './leadership-preview-drawer';
import styles from './operation-manager-dashboard.module.css';

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
  }).format(new Date()));
  return hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
}
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || value; }
function shortDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00+03:00`));
}
function candidateStatus(value: string): string {
  return ({ new: 'Новый', in_progress: 'В работе', accepted: 'Принят', rejected: 'Отклонён' } as Record<string, string>)[value] ?? value;
}
function absenceLabel(value: string): string {
  return ({ vacation: 'Отпуск', sick_leave: 'Больничный', day_off: 'Отгул' } as Record<string, string>)[value] ?? value;
}

export function HrDashboard(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<HrDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<LeadershipPreviewTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setPreview(null);
    void getHrDashboard()
      .then((response) => { if (!cancelled) setData(response); })
      .catch(() => { if (!cancelled) { setData(null); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const name = user ? firstName(getUserDisplayName(user)) : '';

  return (
    <>
      <div className={styles.root}>
        <section className={styles.intro}>
          <div>
            <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
            <p>{loading ? 'Обновляем кадровую сводку…' : data?.attention.total ? `${data.attention.total} кадровых вопросов требуют внимания` : 'На сегодня срочных кадровых вопросов нет'}</p>
          </div>
          <span className={`${styles.health} ${data?.attention.total ? styles.healthAttention : ''}`}><i />{loading ? 'Обновление' : data?.attention.total ? 'Есть приоритеты' : 'Спокойный контур'}</span>
        </section>

        {failed ? <div className={styles.notice}>Кадровую сводку не удалось обновить полностью. Повторите загрузку страницы.</div> : null}

        <DashboardSummaryStrip label="Сегодня">
          <DashboardMetric value={data?.today.activeEmployees ?? '—'} label="активных сотрудников" href="/employees?archiveState=active" />
          <DashboardMetric value={data?.today.employeesWithoutObject ?? '—'} label="без объекта" alert={Boolean(data?.today.employeesWithoutObject)} href="/employees?archiveState=active&hasActiveObjectAssignment=false" />
          <DashboardMetric value={data?.today.newCandidates ?? '—'} label="новых кандидатов" href="/candidates?status=new" />
          <DashboardMetric value={data?.today.overdueCandidateSla ?? '—'} label="просрочено SLA" alert={Boolean(data?.today.overdueCandidateSla)} href="/candidates?sla=overdue" />
          <DashboardMetric value={data?.today.userAbsencesToday ?? '—'} label="отсутствуют сегодня" href="/user-absences?period=today" />
          <DashboardMetric value={data?.today.myTasksToday ?? '—'} label="моих задач" href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" />
        </DashboardSummaryStrip>

        <div className={styles.grid}>
          <div className={styles.column}>
            <div className={styles.wide}>
              <DashboardPanel title="Требует внимания" count={data?.attention.total ?? 0}>
                <DashboardRows>
                  {loading ? <DashboardEmpty>Загружаем сигналы…</DashboardEmpty> : (data?.attention.items ?? []).length === 0 ? <DashboardEmpty><strong>Нет срочных вопросов</strong></DashboardEmpty> : (data?.attention.items ?? []).map((item) => (
                    <DashboardRow key={item.id} badge={item.badge} tone={item.tone} title={item.title} subtitle={item.subtitle} meta={item.meta} onClick={() => {
                      const href = item.kind === 'candidate_sla' && item.entityId
                        ? `/candidates/${item.entityId}`
                        : item.kind === 'task' && item.entityId
                          ? `/tasks/${item.entityId}`
                          : '/employees?archiveState=active&hasActiveObjectAssignment=false';
                      setPreview({ kind: 'summary', item: {
                        eyebrow: item.kind === 'candidate_sla' ? 'Кандидат' : item.kind === 'task' ? 'Задача' : 'Сотрудники',
                        title: item.title, subtitle: item.subtitle,
                        facts: [{ label: 'Состояние', value: item.meta }], href, actionLabel: 'Открыть →',
                      } });
                    }} />
                  ))}
                </DashboardRows>
              </DashboardPanel>
            </div>

            <DashboardPanel title="Кандидаты" count={(data?.candidates.newCount ?? 0) + (data?.candidates.inProgressCount ?? 0)} actionHref="/candidates" actionLabel="Все →">
              <DashboardKpiGrid columns={3}>
                <DashboardKpi value={data?.candidates.newCount ?? '—'} label="Новые" href="/candidates?status=new" />
                <DashboardKpi value={data?.candidates.inProgressCount ?? '—'} label="В работе" href="/candidates?status=in_progress" />
                <DashboardKpi value={data?.candidates.overdueSlaCount ?? '—'} label="SLA просрочено" href="/candidates?sla=overdue" />
              </DashboardKpiGrid>
              <DashboardRows>
                {(data?.candidates.items ?? []).map((candidate) => (
                  <DashboardRow key={candidate.id} badge={candidate.overdue ? 'SLA' : candidateStatus(candidate.status)} tone={candidate.overdue ? 'danger' : 'neutral'} title={candidate.fullName} subtitle={candidate.managerName ? `Менеджер: ${candidate.managerName}` : candidate.phone ?? 'Менеджер не назначен'} meta={candidate.responseDueAt ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(candidate.responseDueAt)) : 'Без SLA'} onClick={() => setPreview({ kind: 'summary', item: {
                    eyebrow: 'Кандидат', title: candidate.fullName,
                    facts: [
                      { label: 'Статус', value: candidateStatus(candidate.status) },
                      { label: 'Менеджер', value: candidate.managerName ?? 'Не назначен' },
                    ], href: `/candidates/${candidate.id}`, actionLabel: 'Открыть кандидата →',
                  } })} />
                ))}
              </DashboardRows>
            </DashboardPanel>
          </div>

          <div className={styles.column}>
            <DashboardPanel title="Сотрудники" count={data?.employees.activeCount ?? 0} actionHref="/employees?archiveState=active" actionLabel="Реестр →">
              <DashboardKpiGrid columns={2}>
                <DashboardKpi value={data?.employees.activeCount ?? '—'} label="Активные" href="/employees?archiveState=active" />
                <DashboardKpi value={data?.employees.withoutObjectCount ?? '—'} label="Без объекта" href="/employees?archiveState=active&hasActiveObjectAssignment=false" />
              </DashboardKpiGrid>
              <DashboardRows>
                {(data?.employees.items ?? []).length === 0 && !loading ? <DashboardEmpty>Все активные сотрудники распределены.</DashboardEmpty> : (data?.employees.items ?? []).map((employee) => (
                  <DashboardRow key={employee.id} badge="Без объекта" tone="warning" title={employee.fullName} subtitle={employee.position ?? 'Должность не указана'} meta="Назначить" href={`/employees/${employee.id}`} />
                ))}
              </DashboardRows>
            </DashboardPanel>

            <DashboardPanel title="Отсутствия" count={data?.absences.today ?? 0} actionHref="/user-absences" actionLabel="График →">
              <DashboardRows>
                {(data?.absences.upcoming ?? []).length === 0 && !loading ? <DashboardEmpty>Ближайших отсутствий нет.</DashboardEmpty> : (data?.absences.upcoming ?? []).map((absence) => (
                  <DashboardRow key={absence.id} badge={absenceLabel(absence.absenceType)} title={absence.fullName} subtitle={`${shortDate(absence.startDate)} — ${shortDate(absence.endDate)}`} meta={absence.startDate <= new Date().toISOString().slice(0, 10) ? 'Сейчас' : 'Скоро'} onClick={() => setPreview({ kind: 'summary', item: {
                    eyebrow: 'Отсутствие', title: absence.fullName,
                    facts: [
                      { label: 'Тип', value: absenceLabel(absence.absenceType) },
                      { label: 'Период', value: `${shortDate(absence.startDate)} — ${shortDate(absence.endDate)}` },
                    ], href: `/user-absences?userId=${absence.userId}`, actionLabel: 'Открыть график →',
                  } })} />
                ))}
              </DashboardRows>
            </DashboardPanel>

            <DashboardPanel title="Мои задачи" count={data?.tasks.totalRelevant ?? 0} actionHref="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" actionLabel="В реестр →">
              <DashboardRows>
                {(data?.tasks.items ?? []).length === 0 && !loading ? <DashboardEmpty>Ближайших задач нет.</DashboardEmpty> : (data?.tasks.items ?? []).map((task) => (
                  <DashboardRow key={task.id} badge="Моя" tone={task.isOverdue ? 'danger' : 'neutral'} title={task.title} subtitle={task.targetName || 'Без привязки'} meta={task.dueAt ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(task.dueAt)) : 'Без срока'} onClick={() => setPreview({ kind: 'task', item: task })} />
                ))}
              </DashboardRows>
            </DashboardPanel>
          </div>
        </div>
      </div>
      <LeadershipPreviewDrawer target={preview} onClose={() => setPreview(null)} />
    </>
  );
}
