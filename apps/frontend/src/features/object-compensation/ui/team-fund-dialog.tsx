'use client';

import React, { useId, useRef, useState } from 'react';
import { createTeamFund } from '@/entities/object/api/object-compensation-client';
import type { CompensationVersion, TeamFundVersion } from '@/entities/object/model/object-compensation.types';
import type { PayContour, StaffingPosition } from '@/entities/object/model/object-scheduling.types';
import { ApiError } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Alert, Button, Field, IconButton } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Select } from '@/shared/ui/searchable-select/select';
import { moscowToday } from '@/features/object-scheduling/ui/schedule-preview';
import styles from './team-compensation.module.css';
import { effectiveCompensationVersion } from '../model/compensation-state';
import { focusCompensationField, reportCompensationControl } from './compensation-form-validation';
import { TrashIcon } from '@/shared/ui/icons/icons';

export function TeamFundDialog({ objectId, funds, versions, positions, contours, onClose, onSaved }: {
  objectId: string; funds: TeamFundVersion[]; versions: CompensationVersion[]; positions: StaffingPosition[]; contours: PayContour[]; onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const current = funds.filter((v) => v.effectiveFrom <= moscowToday()).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const [date, setDate] = useState(moscowToday);
  const [amount, setAmount] = useState(current?.monthlyAmount.toString() ?? '');
  const [reason, setReason] = useState('');
  const [allocations, setAllocations] = useState(() => current?.allocations.map((a) => ({ ...a, monthlyAmount: String(a.monthlyAmount) })) ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const request = useRef({ payload: '', key: '' });
  const values = JSON.stringify([date, amount, reason, allocations]);
  const initial = useRef(values);
  const [confirm, confirmation] = useConfirm();
  const formId = useId();
  const activePositions = positions.flatMap((p) => {
    const revision = p.revisions.filter((r) => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
    return revision && !revision.archived ? [{ id: p.id, revision }] : [];
  });
  const eligibleContours = contours.filter((c) => c.isActive && effectiveCompensationVersion(versions, 'contour', c.id, date)?.terms.ratePolicyType === 'monthly_fixed');
  const update = (index: number, field: 'positionId' | 'contourId' | 'monthlyAmount', value: string): void => setAllocations((items) => items.map((a, i) => i === index ? { ...a, [field]: value, ...(field === 'positionId' ? { contourId: '' } : {}) } : a));
  const total = allocations.reduce((sum, a) => sum + Number(a.monthlyAmount), 0);
  const close = async (): Promise<void> => {
    if (lock.current) return;
    if (values !== initial.current && !await confirm({ title: 'Закрыть распределение фонда?', consequence: 'Несохранённое распределение будет потеряно.', confirmLabel: 'Закрыть' })) return;
    onClose();
  };
  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || conflict) return;
    const form = event.currentTarget;
    const invalid = (field: string, message: string): void => { setInvalidField(field); setError(message); focusCompensationField(form, field); };
    if (!date || date < moscowToday()) { invalid('effectiveFrom', 'Укажите текущую или будущую дату.'); return; }
    if (!reportCompensationControl(form, 'monthlyAmount')) return;
    const seen = new Set<string>();
    for (const [index, allocation] of allocations.entries()) {
      const position = activePositions.find((p) => p.id === allocation.positionId);
      if (!position) { invalid(`allocation-${index}-position`, 'Выберите действующую позицию на дату фонда.'); return; }
      if (!position.revision.groups.some((g) => g.timeRanges.some((r) => r.contourId === allocation.contourId)) || !eligibleContours.some((c) => c.id === allocation.contourId)) { invalid(`allocation-${index}-condition`, 'Выберите связанное с позицией месячное условие.'); return; }
      if (!reportCompensationControl(form, `allocation-${index}-amount`)) return;
      const key = `${allocation.positionId}:${allocation.contourId}`;
      if (seen.has(key)) { invalid(`allocation-${index}-condition`, 'Распределение этой позиции и условия уже добавлено.'); return; }
      seen.add(key);
    }
    if (total > Number(amount)) { invalid('monthlyAmount', 'Распределено больше, чем задано в фонде. Проверьте суммы.'); return; }
    if (!reason.trim()) { invalid('reason', 'Укажите основание распределения.'); return; }
    if (!form.reportValidity()) return;
    const payload = { effectiveFrom: date, expectedVersion: Math.max(0, ...funds.map((f) => f.version)), monthlyAmount: Number(amount), reason: reason.trim(), allocations: allocations.map((a) => ({ ...a, monthlyAmount: Number(a.monthlyAmount) })) };
    const serialized = JSON.stringify(payload);
    if (request.current.payload !== serialized) request.current = { payload: serialized, key: crypto.randomUUID() };
    lock.current = true; setPending(true); setError(null); setInvalidField(null);
    try { await createTeamFund(objectId, { ...payload, requestKey: request.current.key }); onSaved(); }
    catch (caught) { setError(getErrorMessage(caught, 'Не удалось сохранить фонд.')); setConflict(caught instanceof ApiError && caught.statusCode === 409); }
    finally { lock.current = false; setPending(false); }
  };
  return <>{confirmation}<Dialog open onOpenChange={(open) => { if (!open) void close(); }} busy={pending} title="Фонд команды и распределение" size="wide"
    description="Одна сумма на команду объекта. Распределение по позициям общее для сменщиков и групп ротации."
    footer={<div className="ui-inline"><Button disabled={pending} onClick={() => { void close(); }}>Отмена</Button><Button form={formId} type="submit" variant="primary" pending={pending} disabled={conflict}>Сохранить фонд</Button></div>}>
    <form id={formId} noValidate onSubmit={(event) => { void save(event); }} className={styles.content}>
      <div className={styles.fields}>
        <div className={styles.short}><Field label="Действует с · Москва" required error={invalidField === 'effectiveFrom' ? error : undefined}><DatePicker name="effectiveFrom" value={date} min={moscowToday()} required disabled={pending} onChange={setDate} /></Field></div>
        <div className={styles.amount}><Field label="Фонд за месяц, ₽" required error={invalidField === 'monthlyAmount' ? error : undefined}><input name="monthlyAmount" inputMode="numeric" autoComplete="off" type="number" min="0" max="2147483647" step="1" required value={amount} disabled={pending} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      </div>
      <p className="ui-text-muted">Сначала задайте месячное условие оплаты, затем выберите его в позиции раздела «Команда». Выделенная сумма общая для её сотрудников и сменщиков. Незакрытые смены не перераспределяются.</p>
      {allocations.map((a, index) => {
        const position = activePositions.find((p) => p.id === a.positionId);
        const options = eligibleContours.filter((c) => position?.revision.groups.some((g) => g.timeRanges.some((r) => r.contourId === c.id)));
        return <div key={index} className={styles.line}>
          <Field label={`Позиция ${index + 1}`} required error={invalidField === `allocation-${index}-position` ? error : undefined}><Select name={`allocation-${index}-position`} value={a.positionId} disabled={pending} onChange={(e) => update(index, 'positionId', e.target.value)}><option value="">Выберите позицию</option>{activePositions.map((p) => <option key={p.id} value={p.id}>{p.revision.name}</option>)}</Select></Field>
          <Field label="Месячное условие" required error={invalidField === `allocation-${index}-condition` ? error : undefined}><Select name={`allocation-${index}-condition`} value={a.contourId} disabled={pending} onChange={(e) => update(index, 'contourId', e.target.value)}><option value="">Выберите условие</option>{options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className={styles.amount}><Field label="Выделено, ₽" required><input name={`allocation-${index}-amount`} inputMode="numeric" autoComplete="off" type="number" min="0" step="1" max="2147483647" required value={a.monthlyAmount} disabled={pending} onChange={(e) => update(index, 'monthlyAmount', e.target.value)} /></Field></div>
          <IconButton bordered disabled={pending} aria-label={`Убрать распределение ${index + 1}`} onClick={() => setAllocations((items) => items.filter((_, i) => i !== index))}><TrashIcon size={18} /></IconButton>
        </div>;
      })}
      <div><Button disabled={pending || allocations.length >= 100} onClick={() => setAllocations((items) => [...items, { positionId: '', contourId: '', monthlyAmount: '' }])}>Добавить распределение</Button></div>
      <p role="status">Распределено: {Number.isFinite(total) ? total.toLocaleString('ru-RU') : '—'} ₽. Остаток: {amount !== '' && Number.isFinite(total) ? (Number(amount) - total).toLocaleString('ru-RU') : '—'} ₽.</p>
      <Field label="Основание" required error={invalidField === 'reason' ? error : undefined}><textarea name="reason" autoComplete="off" rows={3} maxLength={1000} required value={reason} disabled={pending} onChange={(e) => setReason(e.target.value)} /></Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {conflict ? <Alert tone="warning">Сохранение отклонено, черновик сохранён. Закройте редактор и обновите сведения перед новой попыткой.</Alert> : null}
    </form>
  </Dialog></>;
}
