'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getAccessHistory, getAccessResources } from '@/entities/user-access/api/user-access-client';
import type { AccessAction, AccessDetail, AccessHistoryEntry, AccessPage } from '@/entities/user-access/model/user-access.types';
import { useAuth } from '@/shared/auth/use-auth';
import { ActivityTimeline } from '@/shared/ui/activity-timeline/activity-timeline';
import { Alert, Button, EmptyState, LoadingState } from '@/shared/ui/foundation';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { accessError, ruleLabel } from './access-presentation';
import styles from './user-access.module.css';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short' });
function dateLabel(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? dateFormat.format(date) : 'Дата не указана'; }
const assignmentRoles: Record<string, string> = { responsible: 'Ответственный', manager: 'Менеджер объекта', one_time_manager: 'Менеджер заказа' };

export function AccessAssignmentsTab({ detail }: { detail: AccessDetail }): React.JSX.Element {
  const { user } = useAuth();
  const { objects, oneTimeOrders, substitutions } = detail.assignments;
  const [referenceNames, setReferenceNames] = useState<Record<string, string>>({});
  const [referenceError, setReferenceError] = useState(false);
  const [referenceRetry, setReferenceRetry] = useState(0);
  const userIdsKey = [...new Set(substitutions.flatMap((item) => [item.principalUserId, item.replacementUserId]))].sort().join(',');
  const objectIdsKey = [...new Set(substitutions.flatMap((item) => item.objects.map((object) => object.objectId)))].sort().join(',');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requests = ([['user', userIdsKey], ['object', objectIdsKey]] as const).flatMap(([type, key]) => {
      const ids = key ? key.split(',') : [];
      const batches = [];
      for (let index = 0; index < ids.length; index += 200) batches.push(getAccessResources(type, { ids: ids.slice(index, index + 200) }, controller.signal));
      return batches;
    });
    setReferenceError(false);
    void Promise.all(requests)
      .then((results) => { if (active) setReferenceNames(Object.fromEntries(results.flatMap((result) => result.items.filter((item) => item.label && item.label !== item.id).map((item) => [item.id, item.label])))); })
      .catch(() => { if (active) setReferenceError(true); });
    return () => { active = false; controller.abort(); };
  }, [userIdsKey, objectIdsKey, referenceRetry]);
  const userName = (id: string): string => id === detail.user.id ? detail.user.fullName : referenceNames[id] ?? 'Имя недоступно';
  const objectName = (id: string): string => objects.find((item) => item.objectId === id)?.object.name ?? referenceNames[id] ?? 'Название объекта недоступно';
  return <div className={styles.stack}>
    <p className="ui-text-muted">Назначения показаны для чтения. Изменения выполняются в действующих процессах объектов, заказов и замещений.</p>
    <section><h3 className="ui-section-title">Объекты</h3>{objects.length ? <ul className={styles.contextList}>{objects.map((item) => <li key={item.id}>
      <strong>{!item.object.deletedAt && user?.capabilities?.canAccessObjects ? <Link href={`/objects/${item.objectId}`}>{item.object.name}</Link> : item.object.name}</strong>
      <span>{assignmentRoles[item.assignmentRoleCode] ?? 'Назначение на объект'} · {item.isActive ? 'Действует' : 'Завершено'}</span>
      <span className="ui-text-muted">Назначено {dateLabel(item.createdAt)} · источник: назначение пользователя</span>
    </li>)}</ul> : <p className="ui-text-muted">Назначений на объекты нет.</p>}</section>
    <section><h3 className="ui-section-title">Разовые заказы</h3>{oneTimeOrders.length ? <ul className={styles.contextList}>{oneTimeOrders.map((item) => <li key={item.id}>
      <strong>{user?.capabilities?.canAccessOneTimeOrders ? <Link href={`/one-time-orders/${item.oneTimeOrderId}`}>{item.oneTimeOrder.title}</Link> : item.oneTimeOrder.title}</strong>
      <span>{assignmentRoles[item.assignmentRoleCode] ?? 'Назначение на заказ'} · {item.isActive ? 'Действует' : 'Завершено'}</span>
      <span className="ui-text-muted">Назначено {dateLabel(item.createdAt)} · источник: назначение пользователя</span>
    </li>)}</ul> : <p className="ui-text-muted">Назначений на заказы нет.</p>}</section>
    <section><h3 className="ui-section-title">Временные замещения</h3>{substitutions.length ? <ul className={styles.contextList}>{substitutions.map((item) => <li key={item.id}>
      <strong>{item.principalUserId === detail.user.id ? 'Пользователь передаёт объектные полномочия' : 'Пользователь получает объектные полномочия'}</strong>
      <span>Исходный пользователь: {userName(item.principalUserId)}. Замещающий: {userName(item.replacementUserId)}.</span>
      <span>{dateLabel(item.startsAt)} — {dateLabel(item.endsAt)}{item.revokedAt ? ' · Отозвано' : ''}</span>
      <span>Основание: {item.reason}</span><span>Объекты: {item.objects.map((object) => objectName(object.objectId)).join(', ') || 'Область не указана'}</span>
      {user?.capabilities?.canAccessUserSubstitutions ? <Link href="/user-substitutions">Открыть действующий процесс замещений</Link> : null}
    </li>)}</ul> : <p className="ui-text-muted">Замещений нет.</p>}</section>
    {referenceError ? <Alert tone="warning" role="status" action={<Button onClick={() => setReferenceRetry((value) => value + 1)}>Повторить загрузку названий</Button>}>Часть имён пользователей и названий объектов не загружена. Назначения и их сроки сохранены в отображении.</Alert> : null}
  </div>;
}

export function AccessHistoryTab({ userId, version, actions }: { userId: string; version: number; actions: AccessAction[] }): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccessPage<AccessHistoryEntry> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true); setError('');
    void getAccessHistory(userId, (page - 1) * 30, controller.signal)
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(accessError(cause)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, version, page, retry]);
  if (!data && busy) return <LoadingState label="Загрузка истории…" />;
  return <div className={styles.stack} aria-busy={busy}>
    {error ? <Alert tone="danger" role="alert" action={<Button onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</Button>}>{error}</Alert> : null}
    {data ? <>
      {!data.items.length ? <EmptyState title="История изменений пуста" description="Сохранённые изменения прав появятся здесь с автором и причиной." /> : <ActivityTimeline entries={data.items.map((entry) => ({
        id: entry.id, title: 'Изменение персональных прав', occurredAt: entry.createdAt,
        actor: `${entry.actor.fullName || entry.actor.login} · версия ${entry.versionBefore} → ${entry.versionAfter}`,
        children: <div className={styles.stack}><p className={styles.reason}>Причина: {entry.reason}</p><ul className={styles.changes}>{entry.changes.map((change) => <li key={change.actionCode}>
          <strong>{actions.find((action) => action.code === change.actionCode)?.name ?? 'Действие вне текущего каталога'}</strong>
          <span>{ruleLabel(entry.before.find((rule) => rule.actionCode === change.actionCode))} → {ruleLabel(entry.after.find((rule) => rule.actionCode === change.actionCode))}</span>
          <details><summary>Технические сведения точного изменения</summary><pre className={styles.technical}>{JSON.stringify({ actionCode: change.actionCode, before: entry.before.find((rule) => rule.actionCode === change.actionCode) ?? null, after: entry.after.find((rule) => rule.actionCode === change.actionCode) ?? null }, null, 2)}</pre></details>
        </li>)}</ul></div>,
      }))} />}
      <TablePagination page={page} totalPages={Math.ceil(data.total / 30)} onPageChange={setPage} pending={busy} label="Страницы истории доступа" summary={`Сохранённых изменений: ${data.total}`} />
    </> : null}
  </div>;
}
