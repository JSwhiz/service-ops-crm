'use client';

import React, { useEffect, useMemo, useState } from 'react';

import {
  addOneTimeWorkforceEmployee,
  downloadOneTimeWorkforceExcel,
  getOneTimeAttendanceCoverage,
  getOneTimeTimesheet,
  getTodayOneTimeAttendance,
  listOneTimeWorkforce,
  listOneTimeWorkforceDirectory,
  removeOneTimeWorkforceEmployee,
  submitTodayOneTimeAttendance,
  updateOneTimeWorkforceEmployeePayment,
  type OneTimeAttendance,
  type OneTimeAttendanceCoverage,
  type OneTimeTimesheet,
  type OneTimeWorkforceEmployee,
} from '@/entities/one-time-order/api/one-time-order-workforce-client';
import { getOneTimeOrderById } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { BackLink, Button, StatusBadge } from '@/shared/ui/foundation';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { MonthPeriodPicker } from '@/shared/ui/month-period-picker/month-period-picker';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';

import styles from './workforce.module.css';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';

function moscowMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

function money(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
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
  const [attendance, setAttendance] = useState<OneTimeAttendance | null>(null);
  const [coverage, setCoverage] = useState<OneTimeAttendanceCoverage | null>(null);
  const [timesheet, setTimesheet] = useState<OneTimeTimesheet | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [employeeToAdd, setEmployeeToAdd] = useState('');
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  const [month, setMonth] = useState(moscowMonth());
  const [attendanceDate, setAttendanceDate] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [exportEmployeeId, setExportEmployeeId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeIds = useMemo(
    () => new Set(workforce.filter((item) => item.isActive).map((item) => item.employeeId)),
    [workforce],
  );
  useEffect(() => {
    setPaymentDrafts(
      Object.fromEntries(
        workforce.map((employee) => [
          employee.employeeId,
          employee.orderPayment === null ? '' : String(employee.orderPayment),
        ]),
      ),
    );
  }, [workforce]);

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
        getTodayOneTimeAttendance(id),
        getOneTimeTimesheet(id, month),
        getOneTimeAttendanceCoverage(id),
      ]).then(([orderValue, workforceValue, attendanceValue, timesheetValue, coverageValue]) => {
        if (cancelled) return;
        setOrder(orderValue);
        setWorkforce(workforceValue);
        setAttendance(attendanceValue);
        setAttendanceDate(attendanceValue.operationDate.slice(0, 10));
        setTimesheet(timesheetValue);
        setCoverage(coverageValue);
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
    void getOneTimeTimesheet(orderId, month)
      .then((value) => { if (!cancelled) setTimesheet(value); })
      .catch((loadError) => { if (!cancelled) setError(errorText(loadError)); });
    return () => { cancelled = true; };
  }, [month, orderId]);

  const reloadWorkforce = async (): Promise<void> => {
    if (!orderId) return;
    const [workforceValue, attendanceValue, timesheetValue, coverageValue] = await Promise.all([
      listOneTimeWorkforce(orderId),
      getTodayOneTimeAttendance(orderId, attendanceDate || undefined),
      getOneTimeTimesheet(orderId, month),
      getOneTimeAttendanceCoverage(orderId),
    ]);
    setWorkforce(workforceValue);
    setAttendance(attendanceValue);
    setAttendanceDate(attendanceValue.operationDate.slice(0, 10));
    setTimesheet(timesheetValue);
    setCoverage(coverageValue);
    setSelected(new Set(attendanceValue.employees.filter((item) => item.present).map((item) => item.employeeId)));
  };

  const dayColumns = useMemo(() => {
    const dates = new Set<string>();
    for (const row of timesheet?.rows ?? []) {
      for (const day of row.days) dates.add(day.operationDate.slice(0, 10));
    }
    return Array.from(dates).sort();
  }, [timesheet]);

  const activeWorkforce = useMemo(
    () => workforce.filter((employee) => employee.isActive),
    [workforce],
  );
  const exportEmployeeOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: '', label: 'Все сотрудники' },
      ...workforce.map((employee) => ({
        value: employee.employeeId,
        label: employee.fullName,
        description: employee.position ?? undefined,
      })),
    ],
    [workforce],
  );

  if (loading) {
    return <div className="workspace-page"><PageTitle title="Сотрудники разового заказа" /><div className="page-card">Загрузка...</div></div>;
  }

  return (
    <div className={`workspace-page ${styles.root}`}>
      <PageTitle title="Команда заказа" />
      <div className={styles.toolbar}>
        <div className={styles.orderContext}>
          <BackLink href={orderId ? `/one-time-orders/${orderId}` : '/one-time-orders'}>К карточке заказа</BackLink>
          {order ? <><strong>{order.title}</strong><StatusBadge status={order.status}>{getOneTimeOrderStatusLabel(order.status)}</StatusBadge></> : null}
        </div>
        {attendance ? (
          <span className={styles.status} data-saved={attendance.submittedAt ? 'true' : 'false'}>
            <i />
            {attendance.submittedAt
              ? `Отметка за ${shortDate(attendance.operationDate)} сохранена`
              : `Нет отметки за ${shortDate(attendance.operationDate)}`}
          </span>
        ) : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <nav className={styles.sectionNav} aria-label="Разделы команды заказа">
        <a href="#roster">Состав</a>
        <a href="#attendance">Выходы</a>
        <a href="#coverage">Контроль отметок</a>
        <a href="#timesheet">Табель</a>
      </nav>

      <div className={styles.grid}>
        <section className={styles.card} id="roster">
          <header className={styles.head}>
            <div><h2>Состав команды</h2><p>Цикл {order?.workCycle ?? '—'}</p></div>
            <span className={styles.count}>{activeWorkforce.length}</span>
          </header>
          <div className={styles.body}>
            <div className={styles.addRow}>
              <SearchableSelect
                label="Добавить сотрудника"
                value={employeeToAdd}
                options={[]}
                placeholder="Найти сотрудника"
                searchPlaceholder="ФИО или должность"
                emptyText="Подходящие сотрудники не найдены"
                asyncSearch={async (query) =>
                  (await listOneTimeWorkforceDirectory(orderId, query))
                    .filter((employee) => !activeIds.has(employee.id))
                    .map((employee) => ({
                      value: employee.id,
                      label: employee.fullName,
                      description: employee.position ?? undefined,
                      searchText: [employee.fullName, employee.position]
                        .filter(Boolean)
                        .join(' '),
                    }))
                }
                onChange={setEmployeeToAdd}
                disabled={saving}
              />
              <Button variant="primary" disabled={!employeeToAdd || saving} pending={saving} pendingLabel="Добавляем…" onClick={async () => {
                setSaving(true); setError(null);
                try {
                  await addOneTimeWorkforceEmployee(orderId, employeeToAdd);
                  setEmployeeToAdd('');
                  await reloadWorkforce();
                } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
              }}>Добавить в состав</Button>
            </div>

            <div className={styles.list}>
              {activeWorkforce.length === 0 ? <div className={styles.empty}>Состав ещё не сформирован.</div> : activeWorkforce.map((employee) => (
                <div className={styles.row} key={employee.employeeId}>
                  <div className={styles.copy}>
                    <strong>{employee.fullName}</strong>
                    <span>{employee.position ?? 'Должность не указана'}</span>
                    <div className={styles.rateFacts}>
                      <span><small>Ставка за выход</small><strong>{money(employee.baseDailyRate)}</strong></span>
                      <span><small>Сумма по заказу</small><strong>{money(employee.orderPayment)}</strong></span>
                    </div>
                  </div>
                  <div className={styles.employeeActions}>
                    <label className={styles.paymentField}>
                      <span>Сумма по заказу</span>
                      <input
                        className={styles.paymentInput}
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentDrafts[employee.employeeId] ?? ''}
                        placeholder="Не задана"
                        aria-label={`Сумма по заказу для ${employee.fullName}`}
                        onChange={(event) =>
                          setPaymentDrafts((current) => ({
                            ...current,
                            [employee.employeeId]: event.target.value,
                          }))
                        }
                      />
                      <small>Отдельно от ставки за выход и табеля</small>
                    </label>
                    <div className={styles.employeeButtons}>
                      <Button disabled={saving} onClick={async () => {
                        const raw = (paymentDrafts[employee.employeeId] ?? '').trim();
                        const amount = raw === '' ? null : Number(raw);
                        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
                          setError('Оплата за заказ должна быть неотрицательной суммой.');
                          return;
                        }
                        setSaving(true);
                        setError(null);
                        try {
                          await updateOneTimeWorkforceEmployeePayment(
                            orderId,
                            employee.employeeId,
                            amount,
                          );
                          await reloadWorkforce();
                        } catch (saveError) {
                          setError(errorText(saveError));
                        } finally {
                          setSaving(false);
                        }
                      }}
                      >Сохранить сумму</Button>
                      <Button variant="ghost" disabled={saving} onClick={async () => {
                      setSaving(true); setError(null);
                      try { await removeOneTimeWorkforceEmployee(orderId, employee.employeeId); await reloadWorkforce(); }
                      catch (saveError) { setError(errorText(saveError)); }
                      finally { setSaving(false); }
                      }}>Убрать из состава</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.card} id="attendance">
          <header className={styles.head}>
            <div><h2>Отметить выход</h2><p>{attendance ? shortDate(attendance.operationDate) : 'Выберите дату'}{attendance?.workCycle ? ` · цикл ${attendance.workCycle}` : ''}</p></div>
            {attendance?.submittedAt ? <span className={styles.savedMark}>Сохранено</span> : null}
          </header>
          <div className={styles.body}>
            <label className={styles.dateField}>
              <span>Дата выхода</span>
              <DatePicker value={attendanceDate} max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())} onChange={(nextValue) => {
                const nextDate = nextValue;
                setAttendanceDate(nextDate);
                setCorrectionReason('');
                if (!nextDate || !orderId) return;
                setSaving(true); setError(null);
                void getTodayOneTimeAttendance(orderId, nextDate).then((value) => {
                  setAttendance(value);
                  setSelected(new Set(value.employees.filter((item) => item.present).map((item) => item.employeeId)));
                }).catch((loadError) => setError(errorText(loadError))).finally(() => setSaving(false));
              }} />
            </label>
            {attendance?.submittedAt ? <div className={styles.savedBy}>Отметил: {attendance.submittedBy?.fullName ?? 'пользователь'} · {new Date(attendance.submittedAt).toLocaleString('ru-RU')}</div> : null}
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
            {attendance?.submittedAt ? (
              <label className={styles.dateField}>
                <span>Причина изменения сохранённой отметки</span>
                <textarea className={styles.input} rows={2} maxLength={500} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Укажите, почему корректируете отметку" />
              </label>
            ) : null}
            <div className={styles.formActions}>
              <Button variant="primary" disabled={saving || (attendance?.employees.length ?? 0) === 0 || (Boolean(attendance?.submittedAt) && !correctionReason.trim())} pending={saving} pendingLabel="Сохраняем…" onClick={async () => {
                setSaving(true); setError(null);
                try {
                  const saved = await submitTodayOneTimeAttendance(orderId, Array.from(selected), attendanceDate || undefined, correctionReason.trim() || undefined);
                  setAttendance(saved);
                  setCorrectionReason('');
                  setTimesheet(await getOneTimeTimesheet(orderId, month));
                  setCoverage(await getOneTimeAttendanceCoverage(orderId));
                } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
              }}>Сохранить отметку</Button>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.card} id="coverage">
        <header className={styles.head}>
          <div><h2>Контроль отметок</h2></div>
          <span className={styles.count}>{coverage?.missingDates.length ?? 0} без отметки</span>
        </header>
        <div className={styles.body}>
          {!coverage?.startDate || !coverage.endDate ? (
            <div className={styles.empty}>Укажите период выполнения в карточке заказа, чтобы видеть даты без отметок.</div>
          ) : coverage.missingDates.length === 0 ? (
            <div className={styles.empty}>В периоде {shortDate(coverage.startDate)} — {shortDate(coverage.endDate)} отметки сохранены на все даты.</div>
          ) : (
            <div className={styles.missingDates}>{coverage.missingDates.map((date) => <span key={date}>{shortDate(date)}</span>)}</div>
          )}
          <details className={styles.details}>
            <summary>Как считаются даты без отметки</summary>
            <p>Сравниваются только даты внутри периода выполнения заказа. Это не означает, что сотрудник должен был выходить каждый календарный день.</p>
          </details>
          {coverage?.history.length ? (
            <details className={styles.correctionHistory}>
              <summary>История отметок и исправлений · {coverage.history.length}</summary>
              <div className={styles.historyList}>
                {coverage.history.map((entry, index) => (
                  <article key={`${entry.at}-${index}`}>
                    <strong>{shortDate(entry.operationDate)} · {entry.action.endsWith('corrected') ? 'Исправление' : 'Первичная отметка'}</strong>
                    <span>{entry.actor} · {new Date(entry.at).toLocaleString('ru-RU')}</span>
                    {entry.reason ? <span>Причина: {entry.reason}</span> : null}
                    {entry.previousPresentEmployees.length ? <span>Было: {entry.previousPresentEmployees.join(', ')}</span> : null}
                    <span>Стало: {entry.presentEmployees.length ? entry.presentEmployees.join(', ') : 'никто не отмечен'}</span>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>

      <section className={styles.card} id="timesheet">
        <header className={styles.head}>
          <div><h2>Табель выходов</h2><p>Сохранённые выходы и суммы по дням</p></div>
          <div className={styles.exportControls}>
            <MonthPeriodPicker
              year={Number(month.slice(0, 4))}
              month={Number(month.slice(5, 7))}
              onChange={(year, nextMonth) => setMonth(`${year}-${String(nextMonth).padStart(2, '0')}`)}
            />
            <SearchableSelect
              label="Сотрудник"
              value={exportEmployeeId}
              options={exportEmployeeOptions}
              placeholder="Все сотрудники"
              searchPlaceholder="Найти сотрудника"
              emptyText="Сотрудник не найден"
              clearable={false}
              onChange={setExportEmployeeId}
            />
            <Button disabled={exporting} pending={exporting} pendingLabel="Готовим Excel…" onClick={() => {
              setExporting(true); setError(null);
              void downloadOneTimeWorkforceExcel({ orderId, month, employeeId: exportEmployeeId || undefined }).then((blob) => {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `разовый-заказ-выходы-${month}.xlsx`;
                anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }).catch((exportError) => setError(errorText(exportError))).finally(() => setExporting(false));
            }}>Скачать Excel</Button>
          </div>
        </header>
        <div className={styles.body}>
          {(timesheet?.rows ?? []).length === 0 ? <div className={styles.empty}>За выбранный месяц сохранённых выходов пока нет.</div> : (
            <div className={styles.timesheetWrap}>
              <table className={styles.table}>
                <thead><tr><th>Сотрудник</th>{dayColumns.map((date) => <th key={date}>{date.slice(8, 10)}</th>)}<th>Начислено</th><th>Выплачено</th><th>Не подтверждено</th><th>Остаток</th></tr></thead>
                <tbody>
                  {timesheet?.rows.map((row) => {
                    const byDate = new Map(row.days.map((day) => [day.operationDate.slice(0, 10), day]));
                    return <tr key={row.employeeId}><td>{row.fullName}</td>{dayColumns.map((date) => {
                      const day = byDate.get(date);
                      return <td className={day?.present ? styles.present : styles.absent} key={date}>{day ? money(day.finalValue) : '—'}</td>;
                    })}<td className={styles.total}>{money(row.total)}</td><td>{money(row.paidTotal)}</td><td>{money(row.pendingPayoutTotal)}</td><td>{row.paidTotal === null ? '—' : money(row.total - row.paidTotal)}</td></tr>;
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
