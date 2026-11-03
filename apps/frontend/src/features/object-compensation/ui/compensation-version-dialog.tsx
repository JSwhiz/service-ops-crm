'use client';

import React, { useId, useRef, useState } from 'react';
import { createCompensationVersion } from '@/entities/object/api/object-compensation-client';
import type { CompensationTerms, CompensationVersion } from '@/entities/object/model/object-compensation.types';
import { ApiError } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { moscowToday } from '@/features/object-scheduling/ui/schedule-preview';
import styles from './team-compensation.module.css';
import { effectiveCompensationVersion, expectedCompensationVersion } from '../model/compensation-state';
import { focusCompensationField, reportCompensationControl } from './compensation-form-validation';

export interface CompensationLine { key: string; name: string; scope: CompensationVersion['scope']; scopeId: string }
const weekdays = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']] as const;

export function CompensationVersionDialog({ objectId, line, versions, initialTerms, onClose, onSaved }: {
  objectId: string; line: CompensationLine; versions: CompensationVersion[]; initialTerms?: CompensationTerms; onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const current = effectiveCompensationVersion(versions, line.scope, line.scopeId, moscowToday());
  const terms = current?.terms ?? initialTerms;
  const [date, setDate] = useState(moscowToday);
  const [model, setModel] = useState<CompensationTerms['ratePolicyType']>(terms?.ratePolicyType ?? 'daily_rate');
  const [amount, setAmount] = useState(terms?.baseAmount.toString() ?? '');
  const [summer, setSummer] = useState(terms?.summerAmount?.toString() ?? '');
  const [winter, setWinter] = useState(terms?.winterAmount?.toString() ?? '');
  const [schedule, setSchedule] = useState(terms?.scheduleWeekdays?.length ? 'weekdays' : terms?.scheduleCode ?? '5/2');
  const [days, setDays] = useState(terms?.scheduleWeekdays ?? []);
  const [anchor, setAnchor] = useState(terms?.scheduleCycleStartDate ?? '');
  const [paid, setPaid] = useState(terms?.paidHolidays !== false);
  const [notes, setNotes] = useState(terms?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const request = useRef({ payload: '', key: '' });
  const values = JSON.stringify([date, model, amount, summer, winter, schedule, days, anchor, paid, notes]);
  const initial = useRef(values);
  const [confirm, confirmation] = useConfirm();
  const formId = useId();
  const close = async (): Promise<void> => {
    if (lock.current) return;
    if (values !== initial.current && !await confirm({ title: 'Закрыть условия без сохранения?', consequence: 'Введённая версия условий будет потеряна.', confirmLabel: 'Закрыть' })) return;
    onClose();
  };
  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || conflict) return;
    const form = event.currentTarget;
    const invalid = (field: string, message: string): void => { setInvalidField(field); setError(message); focusCompensationField(form, field); };
    if (!date || date < moscowToday()) { invalid('effectiveFrom', 'Укажите текущую или будущую дату.'); return; }
    for (const name of ['baseAmount', 'summerAmount', 'winterAmount']) if (!reportCompensationControl(form, name)) return;
    if (schedule === 'weekdays' && !days.length) { invalid('weekdays', 'Выберите рабочие дни недели.'); return; }
    if (schedule !== 'weekdays' && schedule !== '5/2' && !anchor) { invalid('scheduleCycleStartDate', 'Укажите дату начала цикла.'); return; }
    if (!form.reportValidity()) return;
    lock.current = true; setPending(true); setError(null); setInvalidField(null);
    const payload = { scope: line.scope, scopeId: line.scopeId, effectiveFrom: date, expectedVersion: expectedCompensationVersion(versions, line.scope, line.scopeId), terms: {
      ratePolicyType: model, baseAmount: Number(amount), summerAmount: summer === '' ? null : Number(summer), winterAmount: winter === '' ? null : Number(winter),
      scheduleCode: schedule === 'weekdays' ? null : schedule, scheduleWeekdays: schedule === 'weekdays' ? days : [], scheduleCycleStartDate: schedule !== 'weekdays' && schedule !== '5/2' ? anchor : null, paidHolidays: paid, notes,
    } };
    const serialized = JSON.stringify(payload);
    if (request.current.payload !== serialized) request.current = { payload: serialized, key: crypto.randomUUID() };
    try { await createCompensationVersion(objectId, { ...payload, requestKey: request.current.key }); onSaved(); }
    catch (caught) { setError(getErrorMessage(caught, 'Не удалось сохранить версию условий.')); setConflict(caught instanceof ApiError && caught.statusCode === 409); }
    finally { lock.current = false; setPending(false); }
  };
  return <>{confirmation}<Dialog open onOpenChange={(open) => { if (!open) void close(); }} busy={pending} title={`Новые условия · ${line.name}`} size="regular"
    description="Условия действуют на выбранную дату выхода. Сохранённые начисления остаются прежними."
    footer={<div className="ui-inline"><Button disabled={pending} onClick={() => { void close(); }}>Отмена</Button><Button form={formId} type="submit" variant="primary" pending={pending} disabled={conflict}>Сохранить условия</Button></div>}>
    <form id={formId} noValidate onSubmit={(event) => { void save(event); }} className={styles.content}>
      <div className={styles.fields}>
        <div className={styles.short}><Field label="Действует с · Москва" required error={invalidField === 'effectiveFrom' ? error : undefined}><DatePicker name="effectiveFrom" value={date} min={moscowToday()} required disabled={pending} onChange={setDate} /></Field></div>
        <div className={styles.short}><Field label="Модель оплаты"><Select name="ratePolicyType" value={model} disabled={pending} onChange={(e) => setModel(e.target.value as typeof model)}><option value="daily_rate">За фактический выход</option><option value="monthly_fixed">Оклад за месяц</option></Select></Field></div>
      </div>
      <div className={styles.fields}>
        {([{ name: 'baseAmount', label: model === 'monthly_fixed' ? 'За месяц, ₽' : 'За выход, ₽', value: amount, set: setAmount, required: true }, { name: 'summerAmount', label: 'Летом, ₽', value: summer, set: setSummer }, { name: 'winterAmount', label: 'Зимой, ₽', value: winter, set: setWinter }]).map((field) => <div className={styles.amount} key={field.name}><Field label={field.label} required={field.required} description={field.required ? undefined : 'Пусто — базовая сумма.'}><input name={field.name} inputMode="numeric" autoComplete="off" type="number" min="0" max="2147483647" step="1" required={field.required} value={field.value} disabled={pending} onChange={(e) => field.set(e.target.value)} /></Field></div>)}
      </div>
      <div className={styles.fields}>
        <div className={styles.short}><Field label="График нормы"><Select name="scheduleCode" value={schedule} disabled={pending} onChange={(e) => setSchedule(e.target.value)}>{['5/2', '1/6', '2/5', '3/4', '4/3', '6/1', '7/0'].map((code) => <option key={code} value={code}>{code}</option>)}<option value="weekdays">Дни недели</option></Select></Field></div>
        {schedule !== 'weekdays' && schedule !== '5/2' ? <div className={styles.short}><Field label="Начало цикла" required error={invalidField === 'scheduleCycleStartDate' ? error : undefined}><DatePicker name="scheduleCycleStartDate" value={anchor} required disabled={pending} onChange={setAnchor} /></Field></div> : null}
      </div>
      {schedule === 'weekdays' ? <fieldset data-compensation-field="weekdays" aria-invalid={invalidField === 'weekdays' || undefined}><legend>Рабочие дни</legend><div className={styles.fields}>{weekdays.map(([code, label]) => <label key={code} className={styles.check}><input name="scheduleWeekdays" value={code} type="checkbox" checked={days.includes(code)} disabled={pending} onChange={(e) => setDays(e.target.checked ? [...days, code] : days.filter((day) => day !== code))} />{label}</label>)}</div></fieldset> : null}
      <label className={styles.check}><input name="paidHolidays" type="checkbox" checked={paid} disabled={pending} onChange={(e) => setPaid(e.target.checked)} />Оплачивать праздники без отметки присутствия</label>
      {model === 'monthly_fixed' ? <p className="ui-text-muted">Каждая половина оклада × оплачиваемые дни / норма этой половины. Для позиции используется выделенная ей часть фонда команды; она общая для групп ротации.</p> : null}
      <Field label="Примечание"><textarea name="notes" autoComplete="off" maxLength={1000} rows={3} value={notes} disabled={pending} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {conflict ? <Alert tone="warning">Сохранение отклонено. Черновик оставлен для сравнения. Закройте редактор и обновите список перед новой попыткой.</Alert> : null}
    </form>
  </Dialog></>;
}
