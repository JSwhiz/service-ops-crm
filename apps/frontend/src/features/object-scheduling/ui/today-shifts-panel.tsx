'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cancelScheduledShift, confirmScheduledShift, getShiftAttendance, getStaffingPositions, previewSchedule } from '@/entities/object/api/object-scheduling-client';
import type { ExpectedShift, SchedulePreview, ShiftAttendance } from '@/entities/object/model/object-scheduling.types';
import { Alert, Button, EmptyState, LoadingState, Surface } from '@/shared/ui/foundation';
import { getErrorMessage } from '@/shared/lib/error-message';
import { ReasonDialog } from '@/shared/ui/overlays';
import { confirmedShiftEmployeeIds, type ShiftDayState } from '../model/shift-day-state';
import { moscowToday, shiftTime } from './schedule-preview';
import styles from './object-scheduling.module.css';

function eventKey(shift: ExpectedShift): string {
  return [shift.positionId, shift.revisionId, shift.groupKey, shift.timeRangeKey, shift.employeeId, shift.operationDate].join(':');
}
const ignoreDayState = (): void => {};
const ignoreChange = async (): Promise<void> => {};

export function TodayShiftsPanel({ objectId, employees, onChanged = ignoreChange, onDayStateChange = ignoreDayState }: {
  objectId: string; employees: { id: string; fullName: string }[]; onChanged?: () => Promise<void>; onDayStateChange?: (state: ShiftDayState) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [facts, setFacts] = useState<ShiftAttendance[]>([]);
  const [canConfirm, setCanConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [factsChecked, setFactsChecked] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ShiftAttendance | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setFactsChecked(false);
    const today = moscowToday();
    void Promise.allSettled([
      getStaffingPositions(objectId), previewSchedule(objectId, { from: today, to: today }), getShiftAttendance(objectId, today, today),
    ]).then(([positions, planned, confirmed]) => {
      if (!active) return;
      setCanConfirm(positions.status === 'fulfilled' && positions.value.capabilities.confirmAttendance);
      if (planned.status === 'fulfilled') setPreview(planned.value);
      if (confirmed.status === 'fulfilled') {
        setFacts(confirmed.value.attendance); setFactsChecked(true);
        confirmed.value.attendance.filter((fact) => fact.status === 'cancelled').forEach((fact) => requests.current.delete(eventKey(fact)));
      }
      const failed = [positions, planned, confirmed].find((item) => item.status === 'rejected');
      if (failed?.status === 'rejected') setError(getErrorMessage(failed.reason, 'Не удалось загрузить смены.'));
      setLoading(false);
    });
    return () => { active = false; };
  }, [objectId, refresh]);
  useEffect(() => {
    const confirmedEmployeeIds = confirmedShiftEmployeeIds(facts, moscowToday());
    onDayStateChange({ checked: factsChecked, pending: loading || !!pending, owned: confirmedEmployeeIds.length > 0, confirmedEmployeeIds });
  }, [facts, factsChecked, loading, pending, onDayStateChange]);
  const confirmShift = async (shift: ExpectedShift): Promise<void> => {
    if (pending || loading || error) return;
    const key = eventKey(shift);
    const requestKey = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestKey);
    setPending(key); setError(null);
    try {
      const saved = await confirmScheduledShift(objectId, shift, requestKey);
      setFacts((previous) => [...previous.filter((fact) => fact.id !== saved.id), saved]);
      await onChanged();
    } catch (caught) { setError(getErrorMessage(caught, 'Не удалось подтвердить выход.')); }
    finally { setPending(null); }
  };
  const cancelShift = async (reason: string): Promise<void> => {
    if (pending || !cancelTarget || cancelTarget.operationDate !== moscowToday() || !reason.trim()) return;
    setPending(`cancel:${cancelTarget.id}`); setCancelError(null);
    try {
      const saved = await cancelScheduledShift(objectId, cancelTarget.id, { expectedVersion: cancelTarget.version, reason: reason.trim() });
      requests.current.delete(eventKey(cancelTarget));
      setFacts((previous) => previous.map((fact) => fact.id === saved.id ? saved : fact));
      setCancelTarget(null); setCancelReason('');
      await onChanged();
    } catch (caught) { setCancelError(getErrorMessage(caught, 'Не удалось отменить выход.')); }
    finally { setPending(null); }
  };
  return <Surface padding="md">
    <ReasonDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && !pending) setCancelTarget(null); }}
      title="Отменить подтверждённый выход?" description="Факт сохранится в истории с автором и причиной отмены. Дневной итог обновит сервер; ручная корректировка табеля сохранится."
      reason={cancelReason} onReasonChange={setCancelReason} reasonRequired confirmLabel="Отменить выход" pending={!!pending} error={cancelError}
      onConfirm={(reason) => { void cancelShift(reason); }} />
    <section className={styles.editor} aria-label="Плановые и подтверждённые смены" aria-busy={loading}>
      <div className="ui-section-header"><h3 className="ui-section-title">Смены сегодня</h3><Button disabled={!!pending || loading} onClick={() => setRefresh((value) => value + 1)}>Обновить</Button></div>
      <p className="ui-text-muted">План по графику показан отдельно от факта. Подтверждение создаёт выход и передаёт его в действующий табель; выплата этим действием не создаётся.</p>
      {loading ? <LoadingState label="Загрузка смен" /> : null}
      {error ? <Alert tone="danger">{error} Введённые и сохранённые данные остаются на месте. Обновите сведения перед следующим действием.</Alert> : null}
      {preview?.warnings.map((warning, index) => <Alert tone="warning" key={`${warning.code}-${index}`}>{warning.message}</Alert>)}
      {preview?.shifts.map((shift) => {
        const key = eventKey(shift);
        const fact = facts.find((item) => item.status === 'confirmed' && eventKey(item) === key);
        return <div className={styles.section} key={key}>
          <strong>{names.get(shift.employeeId) ?? 'Сотрудник из сохранённого назначения'}</strong>
          <span>{shiftTime(shift.startsAt)} — {shiftTime(shift.endsAt)} · {fact ? 'Выход подтверждён' : 'Ожидается по графику'}</span>
          {!fact && canConfirm ? <div><Button disabled={!!pending || loading || !!error} pending={pending === key} onClick={() => { void confirmShift(shift); }}>Подтвердить выход</Button></div> : null}
        </div>;
      })}
      {!loading && preview && preview.shifts.length === 0 ? <EmptyState title="Плановых смен на сегодня нет" description="Для объектов без графика доступна прежняя форма посещаемости." /> : null}
      {facts.length ? <section className={styles.section} aria-label="Сохранённые факты смен">
        <h4 className="ui-section-title">Сохранённые факты</h4>
        <Alert tone="info">День с подтверждёнными сменами нельзя заменить прежней дневной отметкой. Один контур оплачивается один раз за день; суммы разных контуров объединяет сервер. Месячная модель не умножается на число смен.</Alert>
        {facts.map((fact) => <div key={fact.id}>
          <strong>{names.get(fact.employeeId) ?? 'Сотрудник из сохранённого назначения'}</strong> · {shiftTime(fact.startsAt)} — {shiftTime(fact.endsAt)} · {fact.status === 'confirmed' ? 'Подтверждено' : 'Отменено'}
          <div className="ui-text-muted">Снимок ставки за выход: {fact.dailyRateSnapshot === null ? 'не задан' : `${fact.dailyRateSnapshot.toLocaleString('ru-RU')} ₽`}. Это ставка факта, не сумма выплаты и не дополнительный итог дня.</div>
          {fact.cancelReason ? <div>{fact.status === 'confirmed' ? 'Последняя отмена' : 'Причина отмены'}: {fact.cancelReason}</div> : null}
          {fact.status === 'confirmed' && fact.operationDate === moscowToday() && canConfirm ? <div><Button disabled={!!pending || loading || !!error} onClick={() => { setCancelTarget(fact); setCancelReason(''); setCancelError(null); }}>Отменить выход</Button></div> : null}
        </div>)}
      </section> : null}
    </section>
  </Surface>;
}
