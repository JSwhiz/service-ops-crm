'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteUserAbsence,
  listUserAbsences,
  listUserAbsenceUsers,
  updateUserAbsence,
} from '@/entities/user-absence/api/user-absence-client';
import type {
  UserAbsenceItem,
  UserAbsenceType,
  UserAbsenceUserOption,
} from '@/entities/user-absence/model/user-absence.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { toUpdateUserAbsencePayload } from '@/features/user-absence-create/model/create-user-absence-payload';
import { Alert, Button, ButtonLink, EmptyState, Field, LoadingState } from '@/shared/ui/foundation';
import { MonthPeriodPicker } from '@/shared/ui/month-period-picker/month-period-picker';
import { ConfirmDialog } from '@/shared/ui/overlays';
import { useCreateNavigation } from '@/shared/create-navigation';

import styles from './user-absences.module.css';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { isoMonthDays } from '../calendar-date-helpers';

const TYPE_LABELS: Record<UserAbsenceType, string> = {
  vacation: 'Отпуск',
  sick_leave: 'Больничный',
  day_off: 'Отгул',
};

function moscowDate(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted);
  const get = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function monthBounds(value: string): { from: string; to: string; year: number; month: number; days: number } {
  const [year, parsedMonth] = value.split('-').map(Number);
  const safeYear = year || Number(moscowDate().slice(0, 4));
  const safeMonth = parsedMonth !== undefined && parsedMonth >= 1 && parsedMonth <= 12
    ? parsedMonth
    : Number(moscowDate().slice(5, 7));
  const days = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();
  const mm = String(safeMonth).padStart(2, '0');
  return { from: `${safeYear}-${mm}-01`, to: `${safeYear}-${mm}-${String(days).padStart(2, '0')}`, year: safeYear, month: safeMonth, days };
}

function formatMonth(year: number, month: number): string {
  const value = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1);
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function eventForDay(items: UserAbsenceItem[], userId: string, day: string): UserAbsenceItem | undefined {
  return items.find((item) => item.userId === userId && item.startDate <= day && item.endDate >= day);
}

function eventLabel(item: UserAbsenceItem): string {
  return `${TYPE_LABELS[item.absenceType]} · ${formatDay(item.startDate)} — ${formatDay(item.endDate)}`;
}

export default function UserAbsencesPage(): React.JSX.Element {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="ui-page"><LoadingState label="Проверка доступа…" /></div>;
  if (user?.capabilities?.canAccessUserAbsences === false) return <div className="ui-page">
    <EmptyState title="Доступ к календарю закрыт" description="Для просмотра календаря необходимо разрешение. Если доступ нужен для работы, обратитесь к учредителю." action={<ButtonLink href="/dashboard">На рабочий стол</ButtonLink>} />
  </div>;
  return <UserAbsencesContent />;
}

function UserAbsencesContent(): React.JSX.Element {
  const { user } = useAuth();
  useOpenAccessRefresh(Boolean(user));
  const accessRevision = useAccessRevision();
  const router = useRouter();
  const pathname = usePathname();
  const createNavigation = useCreateNavigation();
  const searchParams = useSearchParams();
  const today = useMemo(() => moscowDate(), []);
  const queryMonth = searchParams.get('month');
  const monthKey = queryMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(queryMonth)
    ? queryMonth
    : (searchParams.get('from')?.slice(0, 7) ?? today.slice(0, 7));
  const bounds = useMemo(() => monthBounds(monthKey), [monthKey]);
  const monthDays = useMemo(() => isoMonthDays(bounds.year, bounds.month), [bounds.month, bounds.year]);
  const [items, setItems] = useState<UserAbsenceItem[]>([]);
  const [users, setUsers] = useState<UserAbsenceUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAbsenceItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserAbsenceItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const mutationLock = useRef(false);
  const requestSequence = useRef(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedType, setSelectedType] = useState<UserAbsenceType | ''>('');
  const scope = JSON.stringify([accessRevision, bounds.from, bounds.to, selectedUserId, selectedType]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const accessCurrent = loadedScope === scope && !loading && !loadFailed;
  const checkingAccess = loading || (loadedScope !== scope && !loadFailed);
  const selectedTarget = accessCurrent ? users.find((entry) => entry.id === selectedUserId) : undefined;
  const canCreate = accessCurrent && (selectedUserId
    ? selectedTarget?.capabilities?.canCreate === true
    : users.some((entry) => entry.capabilities?.canCreate === true));
  const canChooseUser = accessCurrent && users.some((entry) => entry.id !== user?.id);
  const currentEditing = accessCurrent ? items.find((item) => item.id === editing?.id) : undefined;
  const canUpdate = currentEditing?.capabilities?.canUpdate === true;
  const showEditorComment = currentEditing?.capabilities?.canViewPrivateReasons === true;
  const currentDeleteTarget = accessCurrent ? items.find((item) => item.id === deleteTarget?.id) : undefined;
  const canDelete = currentDeleteTarget?.capabilities?.canDelete === true;
  const [form, setForm] = useState({
    userId: user?.id ?? '', absenceType: 'vacation' as UserAbsenceType,
    startDate: today, endDate: today, comment: '',
  });
  const [commentTouched, setCommentTouched] = useState(false);
  const editorComment = commentTouched ? form.comment : currentEditing?.comment ?? '';

  useEffect(() => {
    if (pathname !== '/user-absences') return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('month', monthKey);
    next.delete('from');
    next.delete('to');
    const serialized = next.toString();
    if (serialized !== searchParams.toString()) {
      router.replace(`/user-absences?${serialized}`, { scroll: false });
    }
  }, [monthKey, pathname, router, searchParams]);

  const load = useCallback(async (): Promise<void> => {
    if (currentScope.current !== scope) return;
    const request = ++requestSequence.current;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const [response, options] = await Promise.all([listUserAbsences({
        from: bounds.from,
        to: bounds.to,
        userId: selectedUserId || undefined,
        absenceType: selectedType || undefined,
      }), listUserAbsenceUsers()]);
      if (request !== requestSequence.current || currentScope.current !== scope) return;
      setItems(response.items);
      setUsers(options);
      setLoadedScope(scope);
    } catch (caught) {
      if (request !== requestSequence.current || currentScope.current !== scope) return;
      setLoadFailed(true);
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить календарь.');
    } finally {
      if (request === requestSequence.current && currentScope.current === scope) setLoading(false);
    }
  }, [bounds.from, bounds.to, selectedUserId, selectedType, scope]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load, revision]);

  useEffect(() => {
    const onCreated = (): void => setRevision((value) => value + 1);
    window.addEventListener('user-absence-created', onCreated);
    return () => window.removeEventListener('user-absence-created', onCreated);
  }, []);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return users.filter((entry) => {
      if (selectedUserId && entry.id !== selectedUserId) return false;
      if (!query) return true;
      return `${entry.fullName} ${entry.login}`.toLocaleLowerCase('ru-RU').includes(query);
    });
  }, [search, selectedUserId, users]);

  const visibleItems = useMemo(() => items.filter((item) =>
    visibleUsers.some((entry) => entry.id === item.userId),
  ), [items, visibleUsers]);
  const todayCount = visibleItems.filter((item) => item.startDate <= today && item.endDate >= today).length;
  const upcomingCount = visibleItems.filter((item) => item.startDate > today).length;

  const changeMonth = (year: number, month: number): void => {
    const query = new URLSearchParams(searchParams.toString());
    query.set('month', `${year}-${String(month).padStart(2, '0')}`);
    query.delete('from');
    query.delete('to');
    router.replace(`/user-absences?${query.toString()}`, { scroll: false });
  };

  const openCreate = (day = today, targetUserId = selectedUserId): void => {
    if (!accessCurrent) return;
    const target = targetUserId
      ? users.find((entry) => entry.id === targetUserId)
      : users.find((entry) => entry.id === user?.id && entry.capabilities?.canCreate === true)
        ?? users.find((entry) => entry.capabilities?.canCreate === true);
    if (target?.capabilities?.canCreate !== true) return;
    setEditorOpen(false);
    setEditing(null);
    const params = new URLSearchParams();
    params.set('date', day);
    params.set('forUser', target.id);
    createNavigation.open(`/user-absences/new?${params.toString()}`);
  };

  const openEdit = (item: UserAbsenceItem): void => {
    if (!accessCurrent || item.capabilities?.canUpdate !== true || mutationLock.current) return;
    setEditing(item);
    setCommentTouched(false);
    setForm({
      userId: item.userId, absenceType: item.absenceType,
      startDate: item.startDate, endDate: item.endDate,
      comment: item.capabilities.canViewPrivateReasons ? item.comment ?? '' : '',
    });
    setEditorOpen(true);
  };

  const save = async (): Promise<void> => {
    if (mutationLock.current || !accessCurrent || !canUpdate || !editing || !currentEditing || !form.userId || !form.startDate || !form.endDate) return;
    mutationLock.current = true;
    setSavePending(true);
    setError(null);
    try {
      await updateUserAbsence(editing.id, toUpdateUserAbsencePayload(form, currentEditing, commentTouched));
      setEditorOpen(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить отсутствие.');
    } finally {
      mutationLock.current = false;
      setSavePending(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (mutationLock.current || !accessCurrent || !canDelete || !deleteTarget) return;
    mutationLock.current = true;
    setDeletePending(true);
    try {
      await deleteUserAbsence(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить запись.');
    } finally {
      mutationLock.current = false;
      setDeletePending(false);
    }
  };

  const monthTitle = formatMonth(bounds.year, bounds.month);

  return (
    <div className={styles.root}>
      <h1 className={styles.visuallyHidden}>Календарь пользователей</h1>

      <section className={styles.toolbar} aria-label="Управление календарём">
        <div className={styles.periodControls}>
          <MonthPeriodPicker
            year={bounds.year}
            month={bounds.month}
            label="Выбор месяца календаря"
            onChange={changeMonth}
          />
          <span className={styles.periodAnnouncement} aria-live="polite">{monthTitle}</span>
        </div>
        <div className={styles.filters}>
          {canChooseUser ? (
            <Field label="Пользователь">
              <Select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                <option value="">Все пользователи</option>
                {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.login}</option>)}
              </Select>
            </Field>
          ) : null}
          {canChooseUser ? (
            <Field label="Поиск пользователя" className={styles.searchField}>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или логин" />
            </Field>
          ) : null}
          <Field label="Тип отсутствия">
            <Select value={selectedType} onChange={(event) => setSelectedType(event.target.value as UserAbsenceType | '')}>
              <option value="">Все типы</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Button size="lg" variant="primary" icon={<PlusIcon />} disabled={!canCreate || savePending || deletePending} onClick={() => openCreate()}>Добавить отсутствие</Button>
        </div>
      </section>

      <div className={styles.legend} role="list" aria-label="Типы отсутствий">
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <span className={styles.legendItem} role="listitem" key={type}>
            <span className={`${styles.legendSwatch} ${styles[type]}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      {accessCurrent ? <div className={styles.summary}>
        <div className={styles.summaryItem}><strong>{todayCount}</strong><span>отсутствуют сегодня</span></div>
        <div className={styles.summaryItem}><strong>{upcomingCount}</strong><span>запланировано в месяце</span></div>
      </div> : null}

      {error ? <Alert tone="warning" role="alert">{error}</Alert> : null}
      {checkingAccess ? <p role="status">Обновляем календарь и права доступа…</p> : accessCurrent && !canCreate ? <Alert tone="info">{selectedUserId ? 'Создание отсутствий для выбранного пользователя недоступно. Права изменения и удаления проверяются отдельно для каждой записи.' : 'Нет пользователей, для которых разрешено создание отсутствий. Доступные действия показаны у каждой записи.'}</Alert> : null}

      {editorOpen && editing ? (
        <section className={styles.editor} aria-labelledby="absence-editor-title">
          <div className={styles.editorHeading}><h2 id="absence-editor-title">{editing ? 'Изменить отсутствие' : 'Новое отсутствие'}</h2><span>* — обязательные поля</span></div>
          <div className={styles.editorGrid}>
            {currentEditing ? <Field label="Пользователь"><Select value={form.userId} disabled><option value={form.userId}>{currentEditing.user.fullName || currentEditing.user.login}</option></Select></Field> : null}
            <Field label="Тип отсутствия" required><Select value={form.absenceType} disabled={!canUpdate || savePending || deletePending} onChange={(event) => setForm((value) => ({ ...value, absenceType: event.target.value as UserAbsenceType }))}><option value="vacation">Отпуск</option><option value="sick_leave">Больничный</option><option value="day_off">Отгул</option></Select></Field>
            <Field label="С" required><DatePicker value={form.startDate} disabled={!canUpdate || savePending || deletePending} onChange={(nextValue) => setForm((value) => ({ ...value, startDate: nextValue, endDate: value.endDate < nextValue ? nextValue : value.endDate }))} /></Field>
            <Field label="По" required><DatePicker min={form.startDate} value={form.endDate} disabled={!canUpdate || savePending || deletePending} onChange={(nextValue) => setForm((value) => ({ ...value, endDate: nextValue }))} /></Field>
            {showEditorComment ? <Field label="Комментарий"><input value={editorComment} disabled={!canUpdate || savePending || deletePending} onChange={(event) => { setCommentTouched(true); setForm((value) => ({ ...value, comment: event.target.value })); }} placeholder="Необязательно" /></Field> : null}
          </div>
          {!canUpdate ? <Alert tone="warning" role="status">{checkingAccess ? 'Проверяем доступ к записи. Черновик сохранён.' : 'Изменение этой записи недоступно. Черновик сохранён; обновите календарь для проверки доступа.'}</Alert> : null}
          <div className={styles.editorActions}><Button variant="primary" disabled={!canUpdate || savePending || deletePending} pending={savePending} onClick={() => void save()}>Сохранить</Button><Button disabled={savePending} onClick={() => setEditorOpen(false)}>Отмена</Button><Button disabled={checkingAccess || savePending || deletePending} onClick={() => void load()}>Обновить доступ</Button></div>
        </section>
      ) : null}

      <section className={styles.calendarSurface} aria-label={`Календарь отсутствий: ${monthTitle}`} aria-busy={checkingAccess}>
        {checkingAccess ? <div className={styles.empty}>Загрузка календаря…</div> : loadFailed ? <div className={styles.empty}><Button onClick={() => void load()}>Повторить загрузку календаря</Button></div> : visibleUsers.length === 0 ? <div className={styles.empty}>Пользователи не найдены.</div> : (
          <div className={styles.gridScroll} role="region" aria-label="Календарь по дням; прокручивайте по горизонтали">
            <table className={styles.calendarGrid}>
              <thead><tr><th scope="col" className={styles.personHeader}>Пользователь</th>{monthDays.map((date) => {
                const day = Number(date.slice(-2));
                const weekDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
                return <th scope="col" key={date} aria-label={formatDay(date)} className={`${styles.dayHeader} ${date === today ? styles.today : ''}`}><span>{weekDay}</span><strong>{day}</strong></th>;
              })}</tr></thead>
              <tbody>{visibleUsers.map((entry) => <tr key={entry.id}>
                <th scope="row" className={styles.personCell}><strong>{entry.fullName || entry.login}</strong><small>{entry.login}</small></th>
                {monthDays.map((date) => {
                  const item = eventForDay(visibleItems, entry.id, date);
                  const canEdit = accessCurrent && item?.capabilities?.canUpdate === true;
                  const canCreateForUser = accessCurrent && entry.capabilities?.canCreate === true;
                  const comment = item?.capabilities?.canViewPrivateReasons ? item.comment : null;
                  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                  return <td key={date} className={`${styles.dayCell} ${weekday === 0 || weekday === 6 ? styles.weekend : ''} ${date === today ? styles.today : ''}`}>
                    {item ? <button type="button" className={`${styles.event} ${styles[item.absenceType]}`} title={`${eventLabel(item)}${comment ? `\n${comment}` : ''}`} aria-label={`${entry.fullName}, ${date}, ${eventLabel(item)}${comment ? `, ${comment}` : ''}${canEdit ? ', изменить' : ''}`} onClick={() => canEdit ? openEdit(item) : undefined} disabled={!canEdit || savePending || deletePending}><span>{item.startDate === date ? TYPE_LABELS[item.absenceType] : ' '}</span></button>
                      : canCreateForUser ? <button type="button" className={styles.addDay} disabled={savePending || deletePending} aria-label={`Добавить отсутствие: ${entry.fullName}, ${formatDay(date)}`} onClick={() => openCreate(date, entry.id)}>+</button> : null}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.agenda} aria-labelledby="absence-agenda-title">
        <h2 id="absence-agenda-title">Записи за месяц</h2>
        {checkingAccess ? <p className={styles.agendaEmpty}>Загрузка записей…</p> : loadFailed ? <p className={styles.agendaEmpty}>Записи не загружены.</p> : visibleItems.length === 0 ? <p className={styles.agendaEmpty}>По текущим условиям отсутствий не найдено.</p> : visibleItems.map((item) => {
          const canEdit = accessCurrent && item.capabilities?.canUpdate === true;
          const canDeleteItem = accessCurrent && item.capabilities?.canDelete === true;
          return <article className={styles.agendaRow} key={item.id}>
            <div><strong>{item.user.fullName}</strong><span>{TYPE_LABELS[item.absenceType]} · {formatDay(item.startDate)} — {formatDay(item.endDate)}</span>{item.capabilities?.canViewPrivateReasons && item.comment ? <p>{item.comment}</p> : null}</div>
            {canEdit || canDeleteItem ? <div className={styles.agendaActions}>{canEdit ? <Button size="sm" disabled={savePending || deletePending} onClick={() => openEdit(item)}>Изменить</Button> : null}{canDeleteItem ? <Button size="sm" variant="ghost" disabled={savePending || deletePending} onClick={() => setDeleteTarget(item)}>Удалить</Button> : null}</div> : null}
          </article>;
        })}
      </section>

      {deleteTarget && !canDelete ? <Alert tone="warning" role="status">Удаление недоступно, пока право на эту запись не подтверждено. <Button disabled={deletePending} onClick={() => setDeleteTarget(null)}>Отмена удаления</Button></Alert> : null}
      <ConfirmDialog
        open={Boolean(deleteTarget) && canDelete}
        onOpenChange={(open) => { if (!open && !deletePending) setDeleteTarget(null); }}
        title="Удалить отсутствие?"
        consequence={currentDeleteTarget ? `${currentDeleteTarget.user.fullName}: ${eventLabel(currentDeleteTarget)}. Запись будет скрыта из календаря, но останется в истории.` : ''}
        confirmLabel="Удалить запись"
        tone="danger"
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
