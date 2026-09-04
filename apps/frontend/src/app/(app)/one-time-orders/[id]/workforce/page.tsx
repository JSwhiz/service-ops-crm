'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import {
  addOneTimeWorkforceEmployee,
  getOneTimeTimesheet,
  getTodayOneTimeAttendance,
  listOneTimeWorkforce,
  listOneTimeWorkforceDirectory,
  removeOneTimeWorkforceEmployee,
  submitTodayOneTimeAttendance,
  type OneTimeAttendance,
  type OneTimeEmployeeDirectoryItem,
  type OneTimeTimesheet,
  type OneTimeWorkforceEmployee,
} from '@/entities/one-time-order/api/one-time-order-workforce-client';
import { getOneTimeOrderById } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { PageTitle } from '@/shared/ui/page-title/page-title';

import styles from './workforce.module.css';

function moscowMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

function money(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: 'short',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00+03:00`));
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось выполнить операцию.';
}

export default function OneTimeOrderWorkforcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<OneTimeOrderItem | null>(null);
  const [workforce, setWorkforce] = useState<OneTimeWorkforceEmployee[]>([]);
  const [directory, setDirectory] = useState<OneTimeEmployeeDirectoryItem[]>([]);
  const [attendance, setAttendance] = useState<OneTimeAttendance | null>(null);
  const [timesheet, setTimesheet] = useState<OneTimeTimesheet | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeToAdd, setEmployeeToAdd] = useState('');
  const [month, setMonth] = useState(moscowMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeIds = useMemo(
    () => new Set(workforce.filter((item) => item.isActive).map((item) => item.employeeId)),
    [workforce],
  );
  const availableDirectory = directory.filter((item) => !activeIds.has(item.id));

  useEffect(() => {
    let cancelled = false;
    void params.then(({ id }) => {
      if (cancelled) return;
      setOrderId(id);
      setLoading(true);
      setError(null);
      return Promise.all([
        getOneTimeOrderById(id),
        listOneTimeWorkforce(id),
        listOneTimeWorkforceDirectory(id),
        getTodayOneTimeAttendance(id),
        getOneTimeTimesheet(id, month),
      ]).then(([orderValue, workforceValue, directoryValue, attendanceValue, timesheetValue]) => {
        if (cancelled) return;
        setOrder(orderValue);
        setWorkforce(workforceValue);
        setDirectory(directoryValue);
        setAttendance(attendanceValue);
        setTimesheet(timesheetValue);
        setSelected(new Set(attendanceValue.employees.filter((item) => item.present).map((item) => item.employeeId)));
      });
    }).catch((loadError) => {
      if (!cancelled) setError(errorText(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listOneTimeWorkforceDirectory(orderId, employeeSearch)
        .then((items) => { if (!cancelled) setDirectory(items); })
        .catch(() => undefined);
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [employeeSearch, orderId]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    void getOneTimeTimesheet(orderId, month)
      .then((value) => { if (!cancelled) setTimesheet(value); })
      .catch((loadError) => { if (!cancelled) setError(errorText(loadError)); });
    return () => { cancelled = true; };
  }, [month, orderId]);

  const reloadWorkforce = async (): Promise<void> => {
    if (!orderId) return;
    const [workforceValue, directoryValue, attendanceValue, timesheetValue] = await Promise.all([
      listOneTimeWorkforce(orderId),
      listOneTimeWorkforceDirectory(orderId, employeeSearch),
      getTodayOneTimeAttendance(orderId),
      getOneTimeTimesheet(orderId, month),
    ]);
    setWorkforce(workforceValue);
    setDirectory(directoryValue);
    setAttendance(attendanceValue);
    setTimesheet(timesheetValue);
    setSelected(new Set(attendanceValue.employees.filter((item) => item.present).map((item) => item.employeeId)));
  };

  const dayColumns = useMemo(() => {
    const dates = new Set<string>();
    for (const row of timesheet?.rows ?? []) {
      for (const day of row.days) dates.add(day.operationDate.slice(0, 10));
    }
    return Array.from(dates).sort();
  }, [timesheet]);

  if (loading) {
    return <div className="workspace-page"><PageTitle title="Сотрудники разового заказа" /><div className="page-card">Загрузка...</div></div>;
  }

  return (
    <div className={`workspace-page ${styles.root}`}>
      <PageTitle title={order ? `Команда · ${order.title}` : 'Команда разового заказа'} />
      <div className={styles.toolbar}>
        <Link className={styles.back} href={orderId ? `/one-time-orders/${orderId}` : '/one-time-orders'}>← Вернуться к заказу</Link>
        {attendance ? <span className={styles.status}><i />{attendance.submittedAt ? `Отметка сохранена · ${attendance.submittedBy?.fullName ?? 'пользователь'}` : 'Отметка сегодня ещё не отправлена'}</span> : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.grid}>
        <section className={styles.card}>
          <header className={styles.head}>
            <div><h2>Состав на текущий цикл</h2><p>Сотрудники разового заказа хранятся отдельно от состава обычного объекта.</p></div>
            <strong>{workforce.filter((item) => item.isActive).length}</strong>
          </header>
          <div className={styles.body}>
            <div className={styles.searchRow}>
              <input className={styles.input} value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Найти сотрудника" />
              <select className={styles.select} value={employeeToAdd} onChange={(event) => setEmployeeToAdd(event.target.value)}>
                <option value="">Выбрать...</option>
                {availableDirectory.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}{employee.position ? ` · ${employee.position}` : ''}</option>)}
              </select>
            </div>
            <button className={styles.button} type="button" disabled={!employeeToAdd || saving} onClick={async () => {
              setSaving(true); setError(null);
              try {
                await addOneTimeWorkforceEmployee(orderId, employeeToAdd);
                setEmployeeToAdd('');
                await reloadWorkforce();
              } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
            }}>Добавить в состав</button>

            <div className={styles.list}>
              {workforce.filter((item) => item.isActive).length === 0 ? <div className={styles.empty}>Состав ещё не сформирован.</div> : workforce.filter((item) => item.isActive).map((employee) => (
                <div className={styles.row} key={employee.employeeId}>
                  <div className={styles.copy}><strong>{employee.fullName}</strong><span>{employee.position ?? 'Должность не указана'} · ставка {money(employee.baseDailyRate)}</span></div>
                  <button className={styles.buttonSecondary} type="button" disabled={saving} onClick={async () => {
                    setSaving(true); setError(null);
                    try { await removeOneTimeWorkforceEmployee(orderId, employee.employeeId); await reloadWorkforce(); }
                    catch (saveError) { setError(errorText(saveError)); }
                    finally { setSaving(false); }
                  }}>Убрать</button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <header className={styles.head}>
            <div><h2>Присутствие сегодня</h2><p>{attendance ? shortDate(attendance.operationDate) : 'Сегодня'} · отметка сохраняет историческую выплату за день.</p></div>
            <span>{attendance?.workCycle ? `Цикл ${attendance.workCycle}` : ''}</span>
          </header>
          <div className={styles.body}>
            {(attendance?.employees ?? []).length === 0 ? <div className={styles.empty}>Сначала добавьте сотрудников в состав заказа.</div> : (attendance?.employees ?? []).map((employee) => (
              <label className={styles.attendanceRow} key={employee.employeeId}>
                <input className={styles.checkbox} type="checkbox" checked={selected.has(employee.employeeId)} onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(employee.employeeId); else next.delete(employee.employeeId);
                  setSelected(next);
                }} />
                <div className={styles.copy}><strong>{employee.fullName}</strong><span>{employee.position ?? 'Сотрудник'}</span></div>
                <span className={styles.value}>{employee.finalValue === null ? money(employee.baseDailyRate) : money(employee.finalValue)}</span>
              </label>
            ))}
            <div style={{ marginTop: 14 }}>
              <button className={styles.button} type="button" disabled={saving || (attendance?.employees.length ?? 0) === 0} onClick={async () => {
                setSaving(true); setError(null);
                try {
                  const saved = await submitTodayOneTimeAttendance(orderId, Array.from(selected));
                  setAttendance(saved);
                  setTimesheet(await getOneTimeTimesheet(orderId, month));
                } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
              }}>Сохранить отметку</button>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.card}>
        <header className={styles.head}>
          <div><h2>Табель разового заказа</h2><p>Исторические значения фиксируются по дням и не зависят от последующего изменения состава.</p></div>
          <input className={styles.input} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </header>
        <div className={styles.body}>
          {(timesheet?.rows ?? []).length === 0 ? <div className={styles.empty}>За выбранный месяц сохранённых выходов пока нет.</div> : (
            <div className={styles.timesheetWrap}>
              <table className={styles.table}>
                <thead><tr><th>Сотрудник</th>{dayColumns.map((date) => <th key={date}>{date.slice(8, 10)}</th>)}<th>Итого</th></tr></thead>
                <tbody>
                  {timesheet?.rows.map((row) => {
                    const byDate = new Map(row.days.map((day) => [day.operationDate.slice(0, 10), day]));
                    return <tr key={row.employeeId}><td>{row.fullName}</td>{dayColumns.map((date) => {
                      const day = byDate.get(date);
                      return <td className={day?.present ? styles.present : styles.absent} key={date}>{day ? money(day.finalValue) : '—'}</td>;
                    })}<td className={styles.total}>{money(row.total)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
