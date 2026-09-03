'use client';

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
import { PageTitle } from '@/shared/ui/page-title/page-title';

import styles from './user-absences.module.css';

const TYPE_LABELS: Record<UserAbsenceType, string> = {
  vacation: 'Отпуск',
  sick_leave: 'Больничный',
  day_off: 'Отгул',
};

function moscowDate(offsetDays = 0): string {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const get = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function statusLabel(item: UserAbsenceItem, today: string): string {
  if (item.startDate <= today && item.endDate >= today) return 'Отсутствует сегодня';
  if (item.startDate > today) return 'Запланировано';
  return 'Завершено';
}

export default function UserAbsencesPage(): React.JSX.Element {
  const today = useMemo(() => moscowDate(), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => moscowDate(60));
  const [type, setType] = useState<UserAbsenceType | ''>('');
  const [items, setItems] = useState<UserAbsenceItem[]>([]);
  const [users, setUsers] = useState<UserAbsenceUserOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAbsenceItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState({
    userId: '',
    absenceType: 'vacation' as UserAbsenceType,
    startDate: today,
    endDate: today,
    comment: '',
  });

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await listUserAbsences({
        from: from || undefined,
        to: to || undefined,
        absenceType: type || undefined,
      });
      setItems(response.items);
      setCanManage(response.capabilities.canManage);
      if (response.capabilities.canManage && !users.length) {
        const options = await listUserAbsenceUsers();
        setUsers(options);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить график отсутствий.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [from, to, type]);

  const openCreate = (): void => {
    setEditing(null);
    setForm({
      userId: users[0]?.id ?? '',
      absenceType: 'vacation',
      startDate: today,
      endDate: today,
      comment: '',
    });
    setEditorOpen(true);
  };

  const openEdit = (item: UserAbsenceItem): void => {
    setEditing(item);
    setForm({
      userId: item.userId,
      absenceType: item.absenceType,
      startDate: item.startDate,
      endDate: item.endDate,
      comment: item.comment ?? '',
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
          comment: form.comment || null,
        });
      } else {
        await createUserAbsence({
          userId: form.userId,
          absenceType: form.absenceType,
          startDate: form.startDate,
          endDate: form.endDate,
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

  const todayCount = items.filter((item) => item.startDate <= today && item.endDate >= today).length;
  const upcomingCount = items.filter((item) => item.startDate > today).length;

  return (
    <div className={styles.root}>
      <PageTitle title="Отсутствия команды" />

      <div className={styles.summary}>
        <strong>{todayCount}</strong><span>отсутствуют сегодня</span>
        <strong>{upcomingCount}</strong><span>запланированных отсутствий</span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.field}><span>С</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className={styles.field}><span>По</span><input type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label className={styles.field}><span>Тип</span><select value={type} onChange={(event) => setType(event.target.value as UserAbsenceType | '')}><option value="">Все</option><option value="vacation">Отпуск</option><option value="sick_leave">Больничный</option><option value="day_off">Отгул</option></select></label>
        </div>
        {canManage ? <button className={`${styles.button} ${styles.primary}`} type="button" onClick={openCreate}>Добавить отсутствие</button> : null}
      </div>

      {editorOpen && canManage ? (
        <div className={styles.editor}>
          <label className={styles.field}><span>Пользователь</span><select value={form.userId} disabled={Boolean(editing)} onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))}>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.login}</option>)}</select></label>
          <label className={styles.field}><span>Тип</span><select value={form.absenceType} onChange={(event) => setForm((value) => ({ ...value, absenceType: event.target.value as UserAbsenceType }))}><option value="vacation">Отпуск</option><option value="sick_leave">Больничный</option><option value="day_off">Отгул</option></select></label>
          <label className={styles.field}><span>С</span><input type="date" value={form.startDate} onChange={(event) => setForm((value) => ({ ...value, startDate: event.target.value }))} /></label>
          <label className={styles.field}><span>По</span><input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm((value) => ({ ...value, endDate: event.target.value }))} /></label>
          <label className={styles.field}><span>Комментарий</span><input value={form.comment} onChange={(event) => setForm((value) => ({ ...value, comment: event.target.value }))} placeholder="Необязательно" /></label>
          <div className={styles.editorActions}><button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void save()}>Сохранить</button><button className={styles.button} type="button" onClick={() => setEditorOpen(false)}>Отмена</button></div>
        </div>
      ) : null}

      {error ? <div className="inline-notice inline-notice--warning">{error}</div> : null}

      <div className={styles.list}>
        {loading ? <div className={styles.empty}>Загрузка…</div> : items.length === 0 ? <div className={styles.empty}>В выбранном периоде отсутствий нет.</div> : items.map((item) => {
          const currentStatus = statusLabel(item, today);
          return <div className={styles.row} key={item.id}>
            <span className={styles.person}><strong>{item.user.fullName}</strong><small>{item.user.login}</small></span>
            <span className={styles.type}>{TYPE_LABELS[item.absenceType]}</span>
            <span className={styles.period}>{formatDate(item.startDate)} — {formatDate(item.endDate)}</span>
            <span className={`${styles.status} ${currentStatus === 'Отсутствует сегодня' ? styles.statusToday : ''}`}>{currentStatus}</span>
            <span className={styles.comment}>{item.comment || 'Без комментария'}</span>
            {canManage ? <span className={styles.actions}><button className={styles.iconButton} type="button" aria-label="Редактировать" onClick={() => openEdit(item)}>✎</button><button className={styles.iconButton} type="button" aria-label="Удалить" onClick={() => { if (window.confirm('Удалить эту запись об отсутствии?')) void deleteUserAbsence(item.id).then(load).catch((caught) => setError(caught instanceof Error ? caught.message : 'Не удалось удалить отсутствие.')); }}>×</button></span> : null}
          </div>;
        })}
      </div>
    </div>
  );
}
