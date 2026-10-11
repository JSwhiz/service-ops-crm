'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import {
  createUserAbsence,
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
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Button, Field } from '@/shared/ui/foundation';
import { MonthPeriodPicker } from '@/shared/ui/month-period-picker/month-period-picker';
import { ConfirmDialog } from '@/shared/ui/overlays';

import styles from './user-absences.module.css';

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

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function eventForDay(items: UserAbsenceItem[], userId: string, day: string): UserAbsenceItem | undefined {
  return items.find((item) => item.userId === userId && item.startDate <= day && item.endDate >= day);
}

function eventLabel(item: UserAbsenceItem): string {
  return `${TYPE_LABELS[item.absenceType]} · ${formatDay(item.startDate)} — ${formatDay(item.endDate)}`;
}

export default function UserAbsencesPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = useMemo(() => moscowDate(), []);
  const queryMonth = searchParams.get('month');
  const monthKey = queryMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(queryMonth)
    ? queryMonth
    : (searchParams.get('from')?.slice(0, 7) ?? today.slice(0, 7));
  const bounds = useMemo(() => monthBounds(monthKey), [monthKey]);
  const [items, setItems] = useState<UserAbsenceItem[]>([]);
  const [users, setUsers] = useState<UserAbsenceUserOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canManageAll, setCanManageAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAbsenceItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserAbsenceItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedType, setSelectedType] = useState<UserAbsenceType | ''>('');
  const [form, setForm] = useState({
    userId: user?.id ?? '', absenceType: 'vacation' as UserAbsenceType,
    startDate: today, endDate: today, comment: '',
  });

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('month', monthKey);
    next.delete('from');
    next.delete('to');
    const serialized = next.toString();
    if (serialized !== searchParams.toString()) {
      router.replace(`/user-absences?${serialized}`, { scroll: false });
    }
  }, [monthKey, router, searchParams]);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await listUserAbsences({
        from: bounds.from,
        to: bounds.to,
        userId: selectedUserId || undefined,
        absenceType: selectedType || undefined,
      });
      setItems(response.items);
      setCanManage(response.capabilities.canManage);
      setCanManageAll(response.capabilities.canManageAll);
      const options = await listUserAbsenceUsers();
      setUsers(options);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить календарь.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [bounds.from, bounds.to, selectedUserId, selectedType]);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return users.filter((entry) => {
      if (selectedUserId && entry.id !== selectedUserId) return false;
      if (!canManageAll && entry.id !== user?.id) return false;
      if (!query) return true;
      return `${entry.fullName} ${entry.login}`.toLocaleLowerCase('ru-RU').includes(query);
    });
  }, [canManageAll, search, selectedUserId, user?.id, users]);

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

  const openCreate = (day = today): void => {
    setEditing(null);
    setForm({
      userId: selectedUserId || user?.id || users[0]?.id || '',
      absenceType: 'vacation', startDate: day, endDate: day, comment: '',
    });
    setEditorOpen(true);
  };

  const openEdit = (item: UserAbsenceItem): void => {
    setEditing(item);
    setForm({
      userId: item.userId, absenceType: item.absenceType,
      startDate: item.startDate, endDate: item.endDate, comment: item.comment ?? '',
    });
    setEditorOpen(true);
  };

  const save = async (): Promise<void> => {
    if (!form.userId || !form.startDate || !form.endDate) return;
    setError(null);
    try {
      if (editing) {
        await updateUserAbsence(editing.id, {
          absenceType: form.absenceType,
          startDate: form.startDate,
          endDate: form.endDate,
          ...(editing.userId === user?.id || canManageAll ? { comment: form.comment || null } : {}),
        });
      } else {
        await createUserAbsence({
          userId: canManageAll ? form.userId : user?.id ?? form.userId,
          absenceType: form.absenceType, startDate: form.startDate, endDate: form.endDate,
          comment: form.comment || null,
        });
      }
      setEditorOpen(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить отсутствие.');
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await deleteUserAbsence(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить запись.');
    } finally {
      setDeletePending(false);
    }
  };

  const monthTitle = formatMonth(bounds.year, bounds.month);

  return (
    <div className={styles.root}>
      <PageTitle title="Календарь пользователей" />

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
          {canManageAll ? (
            <Field label="Пользователь">
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                <option value="">Все пользователи</option>
                {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.login}</option>)}
              </select>
            </Field>
          ) : null}
          {canManageAll ? (
            <Field label="Поиск пользователя">
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или логин" />
            </Field>
          ) : null}
          <Field label="Тип отсутствия">
            <select value={selectedType} onChange={(event) => setSelectedType(event.target.value as UserAbsenceType | '')}>
              <option value="">Все типы</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {canManage ? <Button variant="primary" onClick={() => openCreate()}>Добавить отсутствие</Button> : null}
        </div>
      </section>

      <div className={styles.summary}>
        <strong>{todayCount}</strong><span>отсутствуют сегодня</span>
        <strong>{upcomingCount}</strong><span>запланировано в месяце</span>
      </div>

      {error ? <div className="inline-notice inline-notice--warning" role="alert">{error}</div> : null}

      {editorOpen && canManage ? (
        <section className={styles.editor} aria-labelledby="absence-editor-title">
          <div className={styles.editorHeading}><h2 id="absence-editor-title">{editing ? 'Изменить отсутствие' : 'Новое отсутствие'}</h2><span>* — обязательные поля</span></div>
          <div className={styles.editorGrid}>
            {canManageAll ? <Field label="Пользователь" required><select value={form.userId} disabled={Boolean(editing)} onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))}>{users.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.login}</option>)}</select></Field> : null}
            <Field label="Тип отсутствия" required><select value={form.absenceType} onChange={(event) => setForm((value) => ({ ...value, absenceType: event.target.value as UserAbsenceType }))}><option value="vacation">Отпуск</option><option value="sick_leave">Больничный</option><option value="day_off">Отгул</option></select></Field>
            <Field label="С" required><input type="date" value={form.startDate} onChange={(event) => setForm((value) => ({ ...value, startDate: event.target.value, endDate: value.endDate < event.target.value ? event.target.value : value.endDate }))} /></Field>
            <Field label="По" required><input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm((value) => ({ ...value, endDate: event.target.value }))} /></Field>
            {editing && editing.userId !== user?.id && !canManageAll ? null : <Field label="Комментарий"><input value={form.comment} onChange={(event) => setForm((value) => ({ ...value, comment: event.target.value }))} placeholder="Необязательно" /></Field>}
          </div>
          <div className={styles.editorActions}><Button variant="primary" onClick={() => void save()}>Сохранить</Button><Button onClick={() => setEditorOpen(false)}>Отмена</Button></div>
        </section>
      ) : null}

      <section className={styles.calendarSurface} aria-label={`Календарь отсутствий: ${monthTitle}`} aria-busy={loading}>
        {loading ? <div className={styles.empty}>Загрузка календаря…</div> : visibleUsers.length === 0 ? <div className={styles.empty}>Пользователи не найдены.</div> : (
          <div className={styles.gridScroll} role="region" aria-label="Календарь по дням; прокручивайте по горизонтали">
            <table className={styles.calendarGrid}>
              <thead><tr><th scope="col" className={styles.personHeader}>Пользователь</th>{Array.from({ length: bounds.days }, (_, index) => {
                const day = index + 1;
                const date = isoDay(bounds.year, bounds.month, day);
                const weekDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
                return <th scope="col" key={date} className={`${styles.dayHeader} ${date === today ? styles.today : ''}`}><span>{weekDay}</span><strong>{day}</strong></th>;
              })}</tr></thead>
              <tbody>{visibleUsers.map((entry) => <tr key={entry.id}>
                <th scope="row" className={styles.personCell}><strong>{entry.fullName || entry.login}</strong><small>{entry.login}</small></th>
                {Array.from({ length: bounds.days }, (_, index) => {
                  const day = index + 1;
                  const date = isoDay(bounds.year, bounds.month, day);
                  const item = eventForDay(visibleItems, entry.id, date);
                  const canEdit = canManage && (canManageAll || entry.id === user?.id);
                  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                  return <td key={date} className={`${styles.dayCell} ${weekday === 0 || weekday === 6 ? styles.weekend : ''} ${date === today ? styles.today : ''}`}>
                    {item ? <button type="button" className={`${styles.event} ${styles[item.absenceType]}`} title={`${eventLabel(item)}${item.comment ? `\n${item.comment}` : ''}`} aria-label={`${entry.fullName}, ${date}, ${eventLabel(item)}${item.comment ? `, ${item.comment}` : ''}${canEdit ? ', изменить' : ''}`} onClick={() => canEdit ? openEdit(item) : undefined} disabled={!canEdit}><span>{item.startDate === date ? TYPE_LABELS[item.absenceType] : ' '}</span></button>
                      : canEdit ? <button type="button" className={styles.addDay} aria-label={`Добавить отсутствие: ${entry.fullName}, ${formatDay(date)}`} onClick={() => openCreate(date)}>+</button> : null}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.agenda} aria-labelledby="absence-agenda-title">
        <h2 id="absence-agenda-title">Записи за месяц</h2>
        {visibleItems.length === 0 ? <p className={styles.agendaEmpty}>В этом месяце отсутствий нет.</p> : visibleItems.map((item) => {
          const canEdit = canManage && (canManageAll || item.userId === user?.id);
          return <article className={styles.agendaRow} key={item.id}>
            <div><strong>{item.user.fullName}</strong><span>{TYPE_LABELS[item.absenceType]} · {formatDay(item.startDate)} — {formatDay(item.endDate)}</span>{item.comment ? <p>{item.comment}</p> : null}</div>
            {canEdit ? <div className={styles.agendaActions}><Button size="sm" onClick={() => openEdit(item)}>Изменить</Button><Button size="sm" variant="ghost" onClick={() => setDeleteTarget(item)}>Удалить</Button></div> : null}
          </article>;
        })}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open && !deletePending) setDeleteTarget(null); }}
        title="Удалить отсутствие?"
        consequence={deleteTarget ? `${deleteTarget.user.fullName}: ${eventLabel(deleteTarget)}. Запись будет скрыта из календаря, но останется в истории.` : ''}
        confirmLabel="Удалить запись"
        tone="danger"
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
