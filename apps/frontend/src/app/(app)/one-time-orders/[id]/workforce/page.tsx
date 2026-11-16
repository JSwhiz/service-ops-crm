'use client';

import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
import { Alert, BackLink, Button, StatusBadge, Surface } from '@/shared/ui/foundation';
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
  const { user, capabilitiesRefreshError } = useAuth();
  const accessRevision = useAccessRevision();
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

  const [accessError, setAccessError] = useState<string | null>(null);
  const [loadedContext, setLoadedContext] = useState<{ params: typeof params; revision: string; userId: string | undefined } | null>(null);
  const dirtyPayments = useRef(new Set<string>());
  const dirtyAttendance = useRef(false);
  const attendanceDateRef = useRef(attendanceDate);
  attendanceDateRef.current = attendanceDate;
  const ready = !loading && !accessError && !capabilitiesRefreshError && loadedContext?.params === params &&
    loadedContext.revision === accessRevision && loadedContext.userId === user?.id;
  const live = useRef({ params, accessRevision, orderId, order, ready, userId: user?.id });
  live.current = { params, accessRevision, orderId, order, ready, userId: user?.id };
  const captureAction = (leaf: keyof OneTimeOrderItem['capabilities']): (() => boolean) => {
    const generation = getAccessGeneration();
    const origin = live.current;
    return () => isAccessGenerationCurrent(generation) && live.current.ready &&
      live.current.params === origin.params && live.current.accessRevision === origin.accessRevision &&
      live.current.userId === origin.userId && live.current.orderId === origin.orderId &&
      live.current.order?.capabilities[leaf] === true;
  };
  const acceptAttendance = (value: OneTimeAttendance | null): void => {
    setAttendance(value);
    if (!value) return;
    setAttendanceDate(value.operationDate.slice(0, 10));
    if (!dirtyAttendance.current) setSelected(new Set(value.employees.filter((item) => item.present).map((item) => item.employeeId)));
  };
  useEffect(() => {
    dirtyPayments.current.clear(); dirtyAttendance.current = false;
    setPaymentDrafts({}); setSelected(new Set()); setCorrectionReason('');
    setEmployeeToAdd(''); setAttendanceDate(''); setExportEmployeeId('');
  }, [params, user?.id]);

  const activeIds = useMemo(
    () => new Set(workforce.filter((item) => item.isActive).map((item) => item.employeeId)),
    [workforce],
  );
  useEffect(() => {
    setPaymentDrafts((current) =>
      Object.fromEntries(
        workforce.map((employee) => [
          employee.employeeId,
          dirtyPayments.current.has(employee.employeeId) ? (current[employee.employeeId] ?? '') : employee.orderPayment === null ? '' : String(employee.orderPayment),
        ]),
      ),
    );
  }, [workforce]);

  useEffect(() => {
    let cancelled = false;
    const generation = getAccessGeneration();
    const origin = { params, revision: accessRevision, userId: user?.id };
    const current = (): boolean => !cancelled && isAccessGenerationCurrent(generation) &&
      live.current.params === origin.params && live.current.accessRevision === origin.revision && live.current.userId === origin.userId;
    setLoadedContext(null); setAccessError(null); setLoading(true);
    if (capabilitiesRefreshError) return () => { cancelled = true; };
    void params.then(async ({ id }) => {
      if (!current()) return;
      const nextOrder = await getOneTimeOrderById(id);
      if (!current()) return;
      const caps = nextOrder.capabilities;
      const [nextWorkforce, nextAttendance, nextTimesheet, nextCoverage] = await Promise.all([
        caps.canReadEmployees ? listOneTimeWorkforce(id) : Promise.resolve([]),
        caps.canReadAttendance ? getTodayOneTimeAttendance(id, attendanceDateRef.current || undefined) : Promise.resolve(null),
        caps.canReadTimesheet ? getOneTimeTimesheet(id, month) : Promise.resolve(null),
        caps.canReadAttendance ? getOneTimeAttendanceCoverage(id) : Promise.resolve(null),
      ]);
      if (!current()) return;
      setOrderId(id); setOrder(nextOrder); setWorkforce(nextWorkforce);
      acceptAttendance(nextAttendance); setTimesheet(nextTimesheet); setCoverage(nextCoverage);
      setLoadedContext({ params, revision: accessRevision, userId: user?.id });
    }).catch((caught) => { if (current()) setAccessError(errorText(caught)); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, accessRevision, user?.id, capabilitiesRefreshError]);

  useEffect(() => {
    if (!ready || !orderId || !order?.capabilities.canReadTimesheet) return;
    let cancelled = false;
    const current = captureAction('canReadTimesheet');
    void getOneTimeTimesheet(orderId, month)
      .then((value) => { if (!cancelled && current()) setTimesheet(value); })
      .catch((caught) => { if (!cancelled && current()) setError(errorText(caught)); });
    return () => { cancelled = true; };
  }, [month, orderId, accessRevision, ready]);

  const reloadWorkforce = async (): Promise<void> => {
    const current = captureAction('canReadEmployees');
    if (!current() || !order) return;
    const [value, today, sheet, days] = await Promise.all([
      listOneTimeWorkforce(orderId),
      order.capabilities.canReadAttendance ? getTodayOneTimeAttendance(orderId, attendanceDate || undefined) : Promise.resolve(null),
      order.capabilities.canReadTimesheet ? getOneTimeTimesheet(orderId, month) : Promise.resolve(null),
      order.capabilities.canReadAttendance ? getOneTimeAttendanceCoverage(orderId) : Promise.resolve(null),
    ]);
    if (!current()) return;
    setWorkforce(value); acceptAttendance(today); setTimesheet(sheet); setCoverage(days);
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

  return (
    <div className={`ui-page ${styles.root}`}>
      <PageTitle title="Команда заказа" />
      {!ready ? <Surface padding="md" role="status">{capabilitiesRefreshError || accessError || 'Проверяем доступ к команде заказа…'}</Surface> : null}
      <AccessSnapshotBoundary blocked={!ready}>
      <div className={styles.toolbar}>
        <div className={styles.orderContext}>
          <BackLink href={orderId ? `/one-time-orders/${orderId}` : '/one-time-orders'}>К карточке заказа</BackLink>
          {order ? <><strong>{order.title}</strong><StatusBadge status={order.status}>{getOneTimeOrderStatusLabel(order.status)}</StatusBadge></> : null}
        </div>
        {order?.capabilities.canReadAttendance && attendance ? (
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
        {order?.capabilities.canReadEmployees ? <a href="#roster">Состав</a> : null}
        {order?.capabilities.canReadAttendance ? <a href="#attendance">Выходы</a> : null}
        {order?.capabilities.canReadAttendance ? <a href="#coverage">Контроль отметок</a> : null}
        {order?.capabilities.canReadTimesheet ? <a href="#timesheet">Табель</a> : null}
      </nav>

      {!order?.capabilities.canReadEmployees ? <Alert tone="info">Нет доступа к составу команды заказа.</Alert> : null}
      {!order?.capabilities.canReadAttendance ? <Alert tone="info">Нет доступа к отметкам выхода и контролю отметок.</Alert> : null}
      {!order?.capabilities.canReadTimesheet ? <Alert tone="info">Нет доступа к табелю заказа.</Alert> : null}
      <div className={styles.grid}>
        <AccessSnapshotBoundary blocked={!order?.capabilities.canReadEmployees}><section className={styles.card} id="roster">
          <header className={styles.head}>
            <div><h2>Состав команды</h2><p>Цикл {order?.workCycle ?? '—'}</p></div>
            <span className={styles.count}>{activeWorkforce.length}</span>
          </header>
          <div className={styles.body}>
            {!order?.capabilities.canManageEmployees ? <Alert tone="info">Назначение и снятие сотрудников недоступны.</Alert> : null}
            {!order?.capabilities.canEditEmployeePayment ? <Alert tone="info">Изменение оплаты сотрудников недоступно.</Alert> : null}
            <AccessSnapshotBoundary blocked={!order?.capabilities.canManageEmployees}><div className={styles.addRow}>
              <SearchableSelect
                label="Добавить сотрудника"
                value={employeeToAdd}
                options={[]}
                placeholder="Найти сотрудника"
                searchPlaceholder="ФИО или должность"
                emptyText="Подходящие сотрудники не найдены"
                asyncSearch={async (query) => {
                  const current = captureAction('canManageEmployees');
                  if (!current()) return [];
                  const rows = await listOneTimeWorkforceDirectory(orderId, query);
                  if (!current()) return [];
                  return rows
                    .filter((employee) => !activeIds.has(employee.id))
                    .map((employee) => ({
                      value: employee.id,
                      label: employee.fullName,
                      description: employee.position ?? undefined,
                      searchText: [employee.fullName, employee.position]
                        .filter(Boolean)
                        .join(' '),
                    }))
                }}
                onChange={setEmployeeToAdd}
                disabled={saving}
              />
              <Button variant="primary" disabled={!employeeToAdd || saving} pending={saving} pendingLabel="Добавляем…" onClick={async () => {
                setSaving(true); setError(null);
                try {
                  const current = captureAction('canManageEmployees');
                  if (!current()) return;
                  await addOneTimeWorkforceEmployee(orderId, employeeToAdd);
                  if (!current()) return;
                  setEmployeeToAdd('');
                  await reloadWorkforce();
                } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
              }}>Добавить в состав</Button>
            </div></AccessSnapshotBoundary>

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
                    <AccessSnapshotBoundary blocked={!order?.capabilities.canEditEmployeePayment}><label className={styles.paymentField}>
                      <span>Сумма по заказу</span>
                      <input
                        className={styles.paymentInput}
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentDrafts[employee.employeeId] ?? ''}
                        placeholder="Не задана"
                        aria-label={`Сумма по заказу для ${employee.fullName}`}
                        onChange={(event) => {
                          dirtyPayments.current.add(employee.employeeId);
                          setPaymentDrafts((current) => ({
                            ...current,
                            [employee.employeeId]: event.target.value,
                          }));
                        }}
                      />
                      <small>Отдельно от ставки за выход и табеля</small>
                    </label>
                      <Button disabled={saving} onClick={async () => {
                        const current = captureAction('canEditEmployeePayment');
                        if (!current()) return;
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
                          if (!current()) return;
                          dirtyPayments.current.delete(employee.employeeId);
                          await reloadWorkforce();
                        } catch (saveError) {
                          setError(errorText(saveError));
                        } finally {
                          setSaving(false);
                        }
                      }}
                      >Сохранить сумму</Button></AccessSnapshotBoundary>
                    <AccessSnapshotBoundary blocked={!order?.capabilities.canManageEmployees}>
                      <Button variant="ghost" disabled={saving} onClick={async () => {
                      setSaving(true); setError(null);
                      try { const current = captureAction('canManageEmployees'); if (!current()) return; await removeOneTimeWorkforceEmployee(orderId, employee.employeeId); if (current()) await reloadWorkforce(); }
                      catch (saveError) { setError(errorText(saveError)); }
                      finally { setSaving(false); }
                      }}>Убрать из состава</Button>
                    </AccessSnapshotBoundary>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section></AccessSnapshotBoundary>

        <AccessSnapshotBoundary blocked={!order?.capabilities.canReadAttendance}><section className={styles.card} id="attendance">
          <header className={styles.head}>
            <div><h2>Отметить выход</h2><p>{attendance ? shortDate(attendance.operationDate) : 'Выберите дату'}{attendance?.workCycle ? ` · цикл ${attendance.workCycle}` : ''}</p></div>
            {attendance?.submittedAt ? <span className={styles.savedMark}>Сохранено</span> : null}
          </header>
          <div className={styles.body}>
            <label className={styles.dateField}>
              <span>Дата выхода</span>
              <DatePicker value={attendanceDate} max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())} onChange={(nextValue) => {
                const current = captureAction('canReadAttendance');
                if (!current()) return;
                const nextDate = nextValue;
                dirtyAttendance.current = false;
                setAttendanceDate(nextDate);
                setCorrectionReason('');
                if (!nextDate || !orderId) return;
                setSaving(true); setError(null);
                void getTodayOneTimeAttendance(orderId, nextDate).then((value) => {
                  if (!current()) return;
                  setAttendance(value);
                  setSelected(new Set(value.employees.filter((item) => item.present).map((item) => item.employeeId)));
                }).catch((loadError) => setError(errorText(loadError))).finally(() => setSaving(false));
              }} />
            </label>
            {!order?.capabilities.canEditAttendance ? <Alert tone="info">Отметки выхода доступны только для просмотра.</Alert> : null}
            {attendance?.submittedAt ? <div className={styles.savedBy}>Отметил: {attendance.submittedBy?.fullName ?? 'пользователь'} · {new Date(attendance.submittedAt).toLocaleString('ru-RU')}</div> : null}
            {(attendance?.employees ?? []).length === 0 ? <div className={styles.empty}>Сначала добавьте сотрудников в состав заказа.</div> : (attendance?.employees ?? []).map((employee) => (
              <label className={styles.attendanceRow} key={employee.employeeId}>
                <input className={styles.checkbox} type="checkbox" checked={selected.has(employee.employeeId)} disabled={!order?.capabilities.canEditAttendance} onChange={(event) => {
                  if (!captureAction('canEditAttendance')()) return;
                  dirtyAttendance.current = true;
                  const next = new Set(selected);
                  if (event.target.checked) next.add(employee.employeeId); else next.delete(employee.employeeId);
                  setSelected(next);
                }} />
                <div className={styles.copy}><strong>{employee.fullName}</strong><span>{employee.position ?? 'Сотрудник'}</span></div>
                <span className={styles.value}>{employee.finalValue === null ? money(employee.baseDailyRate) : money(employee.finalValue)}</span>
              </label>
            ))}
            {attendance?.submittedAt ? (
              <AccessSnapshotBoundary blocked={!order?.capabilities.canEditAttendance}><label className={styles.dateField}>
                <span>Причина изменения сохранённой отметки</span>
                <textarea className={styles.input} rows={2} maxLength={500} value={correctionReason} onChange={(event) => { dirtyAttendance.current = true; setCorrectionReason(event.target.value); }} placeholder="Укажите, почему корректируете отметку" />
              </label></AccessSnapshotBoundary>
            ) : null}
            <AccessSnapshotBoundary blocked={!order?.capabilities.canEditAttendance}><div className={styles.formActions}>
              <Button variant="primary" disabled={saving || (attendance?.employees.length ?? 0) === 0 || (Boolean(attendance?.submittedAt) && !correctionReason.trim())} pending={saving} pendingLabel="Сохраняем…" onClick={async () => {
                setSaving(true); setError(null);
                try {
                  const current = captureAction('canEditAttendance');
                  if (!current()) return;
                  const saved = await submitTodayOneTimeAttendance(orderId, Array.from(selected), attendanceDate || undefined, correctionReason.trim() || undefined);
                  if (!current()) return;
                  dirtyAttendance.current = false; acceptAttendance(saved); setCorrectionReason('');
                  const [sheet, days] = await Promise.all([
                    order?.capabilities.canReadTimesheet ? getOneTimeTimesheet(orderId, month) : Promise.resolve(null),
                    getOneTimeAttendanceCoverage(orderId),
                  ]);
                  if (!current()) return;
                  setTimesheet(sheet); setCoverage(days);
                } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
              }}>Сохранить отметку</Button>
            </div></AccessSnapshotBoundary>
          </div>
        </section></AccessSnapshotBoundary>
      </div>

      <AccessSnapshotBoundary blocked={!order?.capabilities.canReadAttendance}><section className={styles.card} id="coverage">
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
      </section></AccessSnapshotBoundary>

      <AccessSnapshotBoundary blocked={!order?.capabilities.canReadTimesheet}><section className={styles.card} id="timesheet">
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
            <AccessSnapshotBoundary blocked={!order?.capabilities.canExportTimesheet}><Button disabled={exporting} pending={exporting} pendingLabel="Готовим Excel…" onClick={() => {
              const current = captureAction('canExportTimesheet');
              if (!current()) return;
              setExporting(true); setError(null);
              void downloadOneTimeWorkforceExcel({ orderId, month, employeeId: exportEmployeeId || undefined }).then((blob) => {
                if (!current()) return;
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `разовый-заказ-выходы-${month}.xlsx`;
                anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }).catch((exportError) => setError(errorText(exportError))).finally(() => setExporting(false));
            }}>Скачать Excel</Button></AccessSnapshotBoundary>
          </div>
        </header>
        <div className={styles.body}>
          {!order?.capabilities.canExportTimesheet ? <Alert tone="info">Выгрузка табеля недоступна.</Alert> : null}
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
      </section></AccessSnapshotBoundary>
      </AccessSnapshotBoundary>
    </div>
  );
}
