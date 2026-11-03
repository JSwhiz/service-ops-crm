'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cancelScheduledShift, confirmScheduledShift, getShiftAttendance, getStaffingPositions, previewSchedule } from '@/entities/object/api/object-scheduling-client';
import type { ExpectedShift, SchedulePreview, ShiftAttendance } from '@/entities/object/model/object-scheduling.types';
import { Alert, Button, EmptyState, Field, LoadingState, Surface } from '@/shared/ui/foundation';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Dialog, ReasonDialog, useConfirm } from '@/shared/ui/overlays';
import { Select } from '@/shared/ui/searchable-select/select';
import { confirmedShiftEmployeeIds, type ShiftDayState } from '../model/shift-day-state';
import { moscowToday, shiftTime } from './schedule-preview';
import styles from './object-scheduling.module.css';
import { getObjectCompensation } from '@/entities/object/api/object-compensation-client';
import type { AdjustmentKind, CompensationMutationResult, ObjectCompensation } from '@/entities/object/model/object-compensation.types';
import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import { CompensationAdjustmentDialog } from '@/features/object-compensation/ui/compensation-adjustment-dialog';
import { OverflowMenu } from '@/shared/ui/overflow-menu/overflow-menu';

function eventKey(shift: ExpectedShift): string {
  return [shift.positionId, shift.revisionId, shift.groupKey, shift.timeRangeKey, shift.employeeId, shift.operationDate].join(':');
}
const ignoreDayState = (): void => {};
const ignoreChange = async (): Promise<void> => {};

export function TodayShiftsPanel({ objectId, employees, onChanged = ignoreChange, onDayStateChange = ignoreDayState }: {
  objectId: string; employees: ObjectEmployeeOption[]; onChanged?: () => Promise<void>; onDayStateChange?: (state: ShiftDayState) => void;
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
  const [compensation, setCompensation] = useState<ObjectCompensation['capabilities'] | null>(null);
  const [compensationError, setCompensationError] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState<{ kind: AdjustmentKind; fact?: ShiftAttendance } | null>(null);
  const [result, setResult] = useState<CompensationMutationResult | null>(null);
  const [replacementShift, setReplacementShift] = useState<ExpectedShift | null>(null);
  const [substitutionId, setSubstitutionId] = useState('');
  const [confirmDiscard, discardDialog] = useConfirm();
  const requests = useRef(new Map<string, string>());
  const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
  const closeReplacement = async (): Promise<void> => {
    if (pending) return;
    if (substitutionId && !await confirmDiscard({ title: 'Закрыть подтверждение подмены?', consequence: 'Выбранная подмена не будет подтверждена.', confirmLabel: 'Закрыть' })) return;
    setReplacementShift(null);
  };
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setFactsChecked(false);
    setCompensation(null); setCompensationError(null);
    const today = moscowToday();
    void Promise.allSettled([
      getStaffingPositions(objectId), previewSchedule(objectId, { from: today, to: today }), getShiftAttendance(objectId, today, today), getObjectCompensation(objectId),
    ]).then(([positions, planned, confirmed, pay]) => {
      if (!active) return;
      setCanConfirm(positions.status === 'fulfilled' && positions.value.capabilities.confirmAttendance);
      if (pay.status === 'fulfilled') setCompensation(pay.value.capabilities);
      else setCompensationError(getErrorMessage(pay.reason, 'Действия с начислениями недоступны до обновления.'));
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
  const confirmShift = async (shift: ExpectedShift, replacement?: { replacementEmployeeId: string; substitutionId: string }): Promise<void> => {
    if (pending || loading || error) return;
    const key = `${eventKey(shift)}${replacement ? `:${replacement.substitutionId}` : ''}`;
    const requestKey = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestKey);
    setPending(key); setError(null);
    try {
      const saved = await confirmScheduledShift(objectId, shift, requestKey, replacement);
      if ('adjustmentId' in saved) { setResult(saved); setReplacementShift(null); return; }
      setFacts((previous) => [...previous.filter((fact) => fact.id !== saved.id), saved]);
      setReplacementShift(null);
      try { await onChanged(); } catch { setError('Выход записан, но сведения объекта не обновлены. Обновите данные.'); }
    } catch (caught) { setError(getErrorMessage(caught, 'Не удалось подтвердить выход.')); }
    finally { setPending(null); }
  };
  const cancelShift = async (reason: string): Promise<void> => {
    if (pending || !cancelTarget || cancelTarget.operationDate !== moscowToday() || !reason.trim()) return;
    setPending(`cancel:${cancelTarget.id}`); setCancelError(null);
    try {
      const saved = await cancelScheduledShift(objectId, cancelTarget.id, { expectedVersion: cancelTarget.version, reason: reason.trim() });
      if ('adjustmentId' in saved) { setResult(saved); setCancelTarget(null); return; }
      requests.current.delete(eventKey(cancelTarget));
      // A replacement confirmation used the primary's identity plus substitution.
      // Reconfirmation after cancellation must receive a new idempotency key.
      const slotPrefix = [cancelTarget.positionId, cancelTarget.revisionId, cancelTarget.groupKey, cancelTarget.timeRangeKey].join(':') + ':';
      for (const key of requests.current.keys()) if (key.startsWith(slotPrefix)) requests.current.delete(key);
      setFacts((previous) => previous.map((fact) => fact.id === saved.id ? saved : fact));
      setCancelTarget(null); setCancelReason('');
      try { await onChanged(); } catch { setError('Отмена записана, но сведения объекта не обновлены. Обновите данные.'); }
    } catch (caught) { setCancelError(getErrorMessage(caught, 'Не удалось отменить выход.')); }
    finally { setPending(null); }
  };
  return <Surface padding="md">
    {discardDialog}
    <ReasonDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && !pending) setCancelTarget(null); }}
      title="Отменить подтверждённый выход?" description="Факт сохранится в истории с автором и причиной отмены. Дневной итог обновит сервер; ручная корректировка табеля сохранится."
      reason={cancelReason} onReasonChange={setCancelReason} reasonRequired confirmLabel="Отменить выход" pending={!!pending} error={cancelError}
      onConfirm={(reason) => { void cancelShift(reason); }} />
    <section className={styles.content} aria-label="Плановые и подтверждённые смены" aria-busy={loading}>
      <div className="ui-section-header"><h3 className="ui-section-title">Смены сегодня</h3><Button disabled={!!pending || loading} onClick={() => setRefresh((value) => value + 1)}>Обновить</Button></div>
      <p className="ui-text-muted">План по графику показан отдельно от факта. Подтверждение создаёт выход и передаёт его в действующий табель; выплата этим действием не создаётся.</p>
      {compensationError ? <Alert tone="warning">{compensationError}</Alert> : null}
      {result ? <Alert tone={result.status === 'applied' ? 'success' : 'info'} role="status">{result.status === 'pending' ? 'Запрос ожидает согласования другим пользователем руководящего круга. Прежние деньги сохранены.' : result.status === 'applied' ? 'Изменение начисления применено.' : result.status === 'rejected' ? 'Запрос отклонён.' : 'Запрос отменён.'} {result.approvalRequestId ? <a href={`/approvals?${new URLSearchParams({ sourceEntityType: 'object_compensation_adjustment', sourceEntityId: result.adjustmentId })}`}>Открыть согласование</a> : null}</Alert> : null}
      <div className="ui-inline">
        {compensation?.requestExtraWork ? <Button disabled={!!pending || loading || !!error} onClick={() => setAdjustment({ kind: 'extra_work' })}>Добавить допработу</Button> : null}
        {compensation?.requestAdjustment ? <OverflowMenu triggerLabel="Другие действия с начислениями" items={[
          { key: 'override', label: 'Изменить цену выхода', disabled: !!pending || loading || !!error, onSelect: () => setAdjustment({ kind: 'shift_override' }) },
          { key: 'replacement', label: 'Оплатить подмену вместо основного', disabled: !!pending || loading || !!error, onSelect: () => setAdjustment({ kind: 'replacement' }) },
          { key: 'holiday', label: 'Исключение оплаты праздника', disabled: !!pending || loading || !!error, onSelect: () => setAdjustment({ kind: 'holiday_exception' }) },
        ]} /> : null}
      </div>
      {loading ? <LoadingState label="Загрузка смен" /> : null}
      {error ? <Alert tone="danger">{error} Введённые и сохранённые данные остаются на месте. Обновите сведения перед следующим действием.</Alert> : null}
      {preview?.warnings.length ? <Alert tone="warning" title="Обратите внимание на график">
        <ul className={styles.warnings}>{preview.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>
      </Alert> : null}
      {preview?.shifts.map((shift) => {
        const key = eventKey(shift);
        const fact = facts.find((item) => item.status === 'confirmed' && item.positionId === shift.positionId && item.revisionId === shift.revisionId && item.groupKey === shift.groupKey && item.timeRangeKey === shift.timeRangeKey && item.operationDate === shift.operationDate);
        const replaced = fact && fact.employeeId !== shift.employeeId;
        return <div className={styles.section} key={key}>
          <strong>{names.get(shift.employeeId) ?? 'Сотрудник из сохранённого назначения'}</strong>
          <span>{shiftTime(shift.startsAt)} — {shiftTime(shift.endsAt)} · {fact ? 'Выход подтверждён' : 'Ожидается по графику'}</span>
          {replaced ? <p>Вместо основного вышел: {names.get(fact.employeeId) ?? 'Имя сменщика недоступно'}. Оплата по исходным условиям переносится сменщику; основной повторно не подтверждается.</p> : null}
          {!fact && canConfirm ? <div className="ui-inline"><Button disabled={!!pending || loading || !!error} pending={pending === key} onClick={() => { void confirmShift(shift); }}>Подтвердить выход</Button><Button disabled={!!pending || loading || !!error} onClick={() => { setReplacementShift(shift); setSubstitutionId(''); }}>Подтвердить подмену</Button></div> : null}
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
    <Dialog open={!!replacementShift} onOpenChange={(open) => { if (!open) void closeReplacement(); }} title="Подтвердить выход сменщика" busy={!!pending}
      description="Сменщик получает оплату вместо основного по сохранённым условиям его смены. Факт основному не создаётся."
      footer={<div className="ui-inline"><Button disabled={!!pending} onClick={() => { void closeReplacement(); }}>Отмена</Button><Button variant="primary" pending={!!pending} disabled={!substitutionId || loading || !!error} onClick={() => {
        if (!replacementShift) return;
        const substitution = employees.find((e) => e.id === replacementShift.employeeId)?.activeSubstitutions.find((s) => s.id === substitutionId && s.role === 'primary');
        if (substitution) void confirmShift(replacementShift, { substitutionId: substitution.id, replacementEmployeeId: substitution.counterpartEmployeeId });
      }}>Подтвердить подмену</Button></div>}>
      {replacementShift ? <div className={styles.content}>
        <p tabIndex={-1} data-dialog-initial-focus>Основной сотрудник: {names.get(replacementShift.employeeId) ?? 'Имя недоступно'} · {shiftTime(replacementShift.startsAt)}–{shiftTime(replacementShift.endsAt)}</p>
        <Field label="Сменщик из кадровой подмены" required><Select name="substitutionId" value={substitutionId} disabled={!!pending} onChange={(e) => setSubstitutionId(e.target.value)}><option value="">Выберите подмену</option>{employees.find((e) => e.id === replacementShift.employeeId)?.activeSubstitutions.filter((s) => s.role === 'primary' && ['planned', 'active'].includes(s.status) && s.startDate.slice(0, 10) <= replacementShift.operationDate && (!s.endDate || s.endDate.slice(0, 10) >= replacementShift.operationDate)).map((s) => <option key={s.id} value={s.id}>{s.counterpartEmployeeName}</option>)}</Select></Field>
        <p className="ui-text-muted">Если подходящего назначения нет, сначала оформите кадровую подмену в карточке сотрудника. Сервер проверит покрытие всей смены, доступность и отсутствие второго оплачиваемого выхода.</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div> : null}
    </Dialog>
    {adjustment ? <CompensationAdjustmentDialog objectId={objectId} kind={adjustment.kind} initialFact={adjustment.fact} employees={employees} onClose={() => setAdjustment(null)} onSaved={(saved) => { setAdjustment(null); setResult(saved); setRefresh((value) => value + 1); void onChanged().catch(() => setError('Изменение записано, но сведения объекта не обновлены. Обновите данные.')); }} /> : null}
  </Surface>;
}
