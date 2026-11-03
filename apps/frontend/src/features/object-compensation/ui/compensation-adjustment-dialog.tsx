'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { adjustObjectCompensation } from '@/entities/object/api/object-compensation-client';
import { getPayContours, getShiftAttendance } from '@/entities/object/api/object-scheduling-client';
import type { AdjustmentKind, CompensationAdjustmentInput, CompensationMutationResult } from '@/entities/object/model/object-compensation.types';
import type { PayContour, ShiftAttendance } from '@/entities/object/model/object-scheduling.types';
import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import { ApiError } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Alert, Button, Field, LoadingState } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { moscowToday, shiftTime } from '@/features/object-scheduling/ui/schedule-preview';
import styles from './team-compensation.module.css';
import { focusCompensationField, reportCompensationControl } from './compensation-form-validation';
import { HolidayContourPicker } from './holiday-contour-picker';
import { initialHolidayContour, isHolidayContourSelected } from '../model/holiday-contour-selection';

const titles: Record<AdjustmentKind, string> = { extra_work: 'Добавить допработу', shift_override: 'Изменить цену выхода', replacement: 'Оплатить подмену вместо основного', holiday_exception: 'Исключение оплаты праздника' };

export function CompensationAdjustmentDialog({ objectId, kind, employees, initialFact, onClose, onSaved }: {
  objectId: string; kind: AdjustmentKind; employees: ObjectEmployeeOption[]; initialFact?: ShiftAttendance;
  onClose: () => void; onSaved: (result: CompensationMutationResult) => void;
}): React.JSX.Element {
  const [date, setDate] = useState(initialFact?.operationDate ?? moscowToday());
  const [employeeId, setEmployeeId] = useState(initialFact?.employeeId ?? '');
  const [attendanceId, setAttendanceId] = useState(initialFact?.id ?? '');
  const [substitutionId, setSubstitutionId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [paid, setPaid] = useState(false);
  const [contourId, setContourId] = useState<string | null | undefined>(undefined);
  const [contourEdited, setContourEdited] = useState(false);
  const [holidayContours, setHolidayContours] = useState<PayContour[] | null>(null);
  const [holidayReadError, setHolidayReadError] = useState<string | null>(null);
  const [facts, setFacts] = useState<ShiftAttendance[]>(initialFact ? [initialFact] : []);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const lock = useRef(false);
  const request = useRef({ payload: '', key: '' });
  const values = JSON.stringify([date, employeeId, attendanceId, substitutionId, amount, reason, paid, contourEdited ? { id: contourId } : null]);
  const initial = useRef(values);
  const [confirm, confirmation] = useConfirm();
  const formId = useId();
  const needsShift = kind === 'shift_override' || kind === 'replacement';
  const holidayLoading = kind === 'holiday_exception' && holidayContours === null && !holidayReadError;
  useEffect(() => {
    if (kind !== 'holiday_exception') return;
    let active = true;
    setHolidayContours(null); setHolidayReadError(null); setContourId(undefined); setContourEdited(false);
    void getPayContours(objectId).then((response) => {
      if (!active) return;
      setHolidayContours(response.contours);
      setContourId(initialHolidayContour(response.contours));
    }).catch((caught) => { if (active) setHolidayReadError(getErrorMessage(caught, 'Не удалось загрузить условия оплаты праздника.')); });
    return () => { active = false; };
  }, [objectId, kind]);
  useEffect(() => {
    if (!needsShift || !date) return;
    let active = true;
    setLoading(true); setReadError(null); setFacts([]);
    void getShiftAttendance(objectId, date, date).then((response) => { if (active) setFacts(response.attendance.filter((f) => f.status === 'confirmed')); })
      .catch((caught) => { if (active) setReadError(getErrorMessage(caught, 'Не удалось загрузить исходные выходы.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId, date, needsShift]);
  const fact = facts.find((f) => f.id === attendanceId);
  const primary = employees.find((e) => e.id === fact?.employeeId);
  const substitutions = primary?.activeSubstitutions.filter((s) => s.role === 'primary' && ['planned', 'active'].includes(s.status) && s.startDate.slice(0, 10) <= date && (!s.endDate || s.endDate.slice(0, 10) >= date)) ?? [];
  const substitution = substitutions.find((s) => s.id === substitutionId);
  const close = async (): Promise<void> => {
    if (lock.current) return;
    if (values !== initial.current && !await confirm({ title: 'Закрыть изменение начисления?', consequence: 'Введённые значения будут потеряны.', confirmLabel: 'Закрыть' })) return;
    onClose();
  };
  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || blocked || loading || readError || holidayLoading || holidayReadError) return;
    const form = event.currentTarget;
    const invalid = (field: string, message: string): void => { setInvalidField(field); setError(message); focusCompensationField(form, field); };
    if (!date || date > moscowToday()) { invalid('operationDate', 'Укажите прошедшую или текущую дату.'); return; }
    if (needsShift && !fact) { invalid('attendanceId', 'Выберите исходный подтверждённый выход.'); return; }
    if (!needsShift && !employeeId) { invalid('employeeId', 'Выберите сотрудника объекта.'); return; }
    if (kind === 'holiday_exception' && !isHolidayContourSelected(holidayContours ?? [], contourId)) { invalid('contourId', 'Выберите условие для исключения оплаты праздника.'); return; }
    if (kind === 'replacement' && !substitution) { invalid('substitutionId', 'Выберите кадровую подмену.'); return; }
    if ((kind === 'extra_work' || kind === 'shift_override') && !reportCompensationControl(form, 'amount')) return;
    if (!reason.trim()) { invalid('reason', 'Укажите основание изменения начисления.'); return; }
    if (!form.reportValidity()) return;
    const payload: Omit<CompensationAdjustmentInput, 'requestKey'> = {
      kind, operationDate: date, reason: reason.trim(),
      ...(needsShift && fact ? { attendanceId: fact.id, expectedVersion: fact.version } : { employeeId }),
      ...(kind === 'extra_work' || kind === 'shift_override' ? { amount: Number(amount) } : {}),
      ...(kind === 'replacement' && substitution ? { replacementEmployeeId: substitution.counterpartEmployeeId, substitutionId: substitution.id } : {}),
      ...(kind === 'holiday_exception' ? { paid, contourId } : {}),
    };
    const serialized = JSON.stringify(payload);
    if (request.current.payload !== serialized) request.current = { payload: serialized, key: crypto.randomUUID() };
    lock.current = true; setPending(true); setError(null); setInvalidField(null);
    try { onSaved(await adjustObjectCompensation(objectId, { ...payload, requestKey: request.current.key })); }
    catch (caught) { setError(getErrorMessage(caught, 'Результат сохранения не подтверждён. Проверьте историю начислений перед повторной отправкой.')); setBlocked(!(caught instanceof ApiError) || ![400, 422].includes(caught.statusCode)); }
    finally { lock.current = false; setPending(false); }
  };
  return <>{confirmation}<Dialog open onOpenChange={(open) => { if (!open) void close(); }} busy={pending} size="regular" title={titles[kind]}
    footer={<div className="ui-inline"><Button disabled={pending} onClick={() => { void close(); }}>Отмена</Button><Button form={formId} type="submit" variant="primary" pending={pending} disabled={blocked || loading || !!readError || holidayLoading || !!holidayReadError}>{date < moscowToday() ? 'Отправить на согласование' : 'Сохранить изменение'}</Button></div>}>
    <form id={formId} noValidate className={styles.content} onSubmit={(event) => { void save(event); }}>
      <div className={styles.short}><Field label="Дата операции · Москва" required error={invalidField === 'operationDate' ? error : undefined}><DatePicker name="operationDate" value={date} max={moscowToday()} required disabled={pending} onChange={(value) => { setDate(value); setAttendanceId(''); setSubstitutionId(''); }} /></Field></div>
      {needsShift ? <>
        {loading ? <LoadingState label="Загрузка сохранённых выходов" /> : null}
        {readError ? <Alert tone="danger">{readError} Закройте форму и обновите сведения.</Alert> : null}
        <Field label="Исходный подтверждённый выход" required error={invalidField === 'attendanceId' ? error : undefined}><Select name="attendanceId" value={attendanceId} disabled={pending || loading} onChange={(e) => { setAttendanceId(e.target.value); setSubstitutionId(''); }}><option value="">Выберите выход</option>{facts.map((f) => <option key={f.id} value={f.id}>{employees.find((e) => e.id === f.employeeId)?.fullName ?? 'Имя сотрудника недоступно'} · {shiftTime(f.startsAt)}–{shiftTime(f.endsAt)}</option>)}</Select></Field>
        {!loading && !readError && !facts.length ? <Alert tone="info">В эту дату нет подтверждённых смен графика. Исправление старой дневной отметки доступно через табель.</Alert> : null}
      </> : <Field label="Сотрудник объекта" required error={invalidField === 'employeeId' ? error : undefined}><Select name="employeeId" value={employeeId} disabled={pending} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Выберите сотрудника</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>}
      {kind === 'replacement' ? <>
        <Field label="Кадровая подмена" required error={invalidField === 'substitutionId' ? error : undefined}><Select name="substitutionId" value={substitutionId} disabled={pending} onChange={(e) => setSubstitutionId(e.target.value)}><option value="">Выберите подмену</option>{substitutions.map((s) => <option key={s.id} value={s.id}>{s.counterpartEmployeeName}</option>)}</Select></Field>
        {!substitutions.length ? <p>Подходящая кадровая подмена в доступных назначениях не найдена. Сначала оформите её в карточке сотрудника.</p> : null}
        <p>Сменщик получает оплату по сохранённым условиям исходного выхода вместо основного сотрудника. Кадровое назначение само по себе не подтверждает выход.</p>
      </> : null}
      {kind === 'extra_work' || kind === 'shift_override' ? <div className={styles.amount}><Field label={kind === 'extra_work' ? 'Добавить к начислению, ₽' : 'Новая цена выхода, ₽'} required><input name="amount" inputMode="numeric" autoComplete="off" type="number" min="0" max="2147483647" step="1" required value={amount} disabled={pending} onChange={(e) => setAmount(e.target.value)} /></Field></div> : null}
      {kind === 'shift_override' ? <p>Сохранённая цена: {fact?.dailyRateSnapshot == null ? 'недоступна' : `${fact.dailyRateSnapshot.toLocaleString('ru-RU')} ₽`}. Новая цена заменяет цену оплачиваемого выхода в этом контуре; она не прибавляется к ней.</p> : null}
      {kind === 'extra_work' ? <p>Самостоятельное дополнительное начисление с основанием. Прибавляется к сохранённым суммам; факт присутствия и второй основной выход не создаются.</p> : null}
      {kind === 'holiday_exception' ? <><HolidayContourPicker contours={holidayContours ?? []} loading={holidayLoading} readError={holidayReadError} value={contourId} onChange={(value) => { setContourId(value); setContourEdited(true); }} disabled={pending} error={invalidField === 'contourId' ? error : undefined} /><label className={styles.check}><input name="paid" type="checkbox" checked={paid} disabled={pending} onChange={(e) => setPaid(e.target.checked)} />Оплатить этот праздник</label><p>Отметка присутствия не создаётся. Если для выбранного условия расчёт недоступен, сервер объяснит причину.</p></> : null}
      <Field label="Основание" required error={invalidField === 'reason' ? error : undefined}><textarea name="reason" autoComplete="off" rows={3} maxLength={1000} required value={reason} disabled={pending} onChange={(e) => setReason(e.target.value)} /></Field>
      {date < moscowToday() ? <Alert tone="info">Прежние деньги сохраняются до согласования другим пользователем руководящего круга. Автор не может подтвердить свою заявку.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {blocked ? <Alert tone="warning">Повторная отправка заблокирована до проверки результата. Черновик сохранён. Закройте форму, проверьте историю начислений в «Бюджете и сезонах», затем обновите сведения.</Alert> : null}
    </form>
  </Dialog></>;
}
