'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import type { TimesheetEntry, TimesheetOverviewEntry } from '@/entities/timesheet/model/timesheet.types';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { Drawer, useConfirm } from '@/shared/ui/overlays';
import { formatUiDate } from '@/shared/lib/format-date';
import { ApiError } from '@/shared/api/fetcher';
import { describeTimesheetValue, humanizeCellCorrectionError, isCellCorrectionRetryBlocked, validateCellCorrection } from '../model/cell-presentation';
import styles from './timesheet-cell-detail.module.css';
import timesheetStyles from '@/entities/timesheet/ui/timesheet-ui.module.css';
import { moscowToday } from '@/features/object-scheduling/ui/schedule-preview';

export interface TimesheetCellMutation {
  objectId: string;
  employeeId: string;
  dayOfMonth: number;
  dayValue: number;
  comment?: string;
}

interface TimesheetCellEditorProps {
  objectId: string;
  objectName: string;
  employeeId: string;
  employeeName: string;
  year: number;
  month: number;
  dayOfMonth: number;
  entry: TimesheetOverviewEntry | TimesheetEntry;
  finalValue: number;
  autoValue: number;
  isChangedManually: boolean;
  comment: string | null;
  canDirectEdit: boolean;
  canRequestCorrection: boolean;
  isEditableDate: boolean;
  onDirectChange: (payload: TimesheetCellMutation) => Promise<'pending' | void>;
  onRequestCorrection: (payload: Required<TimesheetCellMutation>) => Promise<void>;
  onOpenDetails?: () => void;
  mutationsBlocked?: boolean;
  refreshing?: boolean;
  dataRevision?: number;
  onRefresh?: () => void;
}

const moneyFormatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });

export function TimesheetCellEditor({
  objectId, objectName, employeeId, employeeName, year, month, dayOfMonth, entry,
  finalValue, autoValue, isChangedManually, comment, canDirectEdit: canDirectEditCapability,
  canRequestCorrection, isEditableDate, onDirectChange, onRequestCorrection, onOpenDetails,
  mutationsBlocked = false, refreshing = false, dataRevision = 0, onRefresh,
}: TimesheetCellEditorProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(finalValue));
  const [reason, setReason] = useState(comment ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [blockedAtRevision, setBlockedAtRevision] = useState<number | null>(null);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [confirmDiscard, discardDialog] = useConfirm();
  const editorInitial = useRef({ value: String(finalValue), reason: comment ?? '' });
  const date = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const canDirectEdit = canDirectEditCapability && date === moscowToday();
  const requiresRetroApproval = date < moscowToday();
  const canRestore = isChangedManually && finalValue !== autoValue && (canDirectEdit || requiresRetroApproval && canDirectEditCapability);
  const canOfferCorrection = isEditableDate && (canDirectEditCapability || canRequestCorrection);
  const retryBlocked = isCellCorrectionRetryBlocked(pendingRequest, blockedAtRevision, dataRevision);
  const canMutate = canOfferCorrection && !mutationsBlocked && !retryBlocked;

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [open]);

  const openDetails = (): void => {
    setEditing(false);
    setMessage(null);
    setSuccess(null);
    setOpen(true);
  };
  const startEditing = (): void => {
    if (!canMutate) return;
    setValue(String(finalValue));
    setReason(comment ?? '');
    editorInitial.current = { value: String(finalValue), reason: comment ?? '' };
    setMessage(null);
    setSuccess(null);
    setEditing(true);
  };
  const discardEditing = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    if (editing && (value !== editorInitial.current.value || reason !== editorInitial.current.reason) && !await confirmDiscard({ title: 'Закрыть корректировку без отправки?', consequence: 'Введённая сумма и причина будут потеряны.', confirmLabel: 'Закрыть' })) return false;
    setEditing(false); setMessage(null); return true;
  };
  const mutate = async (restore = false): Promise<void> => {
    if (savingRef.current || !canMutate || !editing) return;
    if (restore && !canRestore) return;
    const parsed = restore ? autoValue : Number(value);
    const validation = restore && canDirectEdit ? null : validateCellCorrection(restore ? String(autoValue) : value, reason, autoValue, canDirectEdit, requiresRetroApproval);
    if (validation) { setMessage(validation); return; }
    if (parsed === finalValue) { setEditing(false); return; }
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      let requiresApproval = !canDirectEdit;
      if (canDirectEdit) {
        const result = await onDirectChange({ objectId, employeeId, dayOfMonth, dayValue: parsed, comment: parsed !== autoValue ? reason.trim() : undefined });
        requiresApproval = result === 'pending';
        if (requiresApproval) setPendingRequest(true);
      } else {
        await onRequestCorrection({ objectId, employeeId, dayOfMonth, dayValue: parsed, comment: reason.trim() });
        setPendingRequest(true);
      }
      setEditing(false);
      setSuccess(requiresApproval ? 'Запрос на корректировку отправлен. Прежние деньги сохранены до согласования другим пользователем руководящего круга.' : 'Корректировка сохранена.');
    } catch (error) {
      const failure = humanizeCellCorrectionError(error instanceof ApiError ? error : null);
      setMessage(failure.message);
      if (failure.recovery === 'refresh') setBlockedAtRevision(dataRevision);
      if (failure.recovery === 'pending') setPendingRequest(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <>
    {discardDialog}
    <button ref={triggerRef} type="button" data-timesheet-cell={dayOfMonth} tabIndex={-1}
      className={`${timesheetStyles.timesheetCellTrigger}${open ? ' is-selected' : ''}${isChangedManually ? ' is-manual' : ''}${!isEditableDate ? ' is-locked' : ''}`}
      aria-label={`${objectName}, ${employeeName}, ${formatUiDate(date, { full: true })}: ${moneyFormatter.format(finalValue)}${isChangedManually ? ', ручная корректировка' : ''}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? detailId : undefined}
      onClick={openDetails} onContextMenu={(event) => { event.preventDefault(); openDetails(); }}
    >
      <strong>{finalValue === 0 ? '—' : finalValue}</strong>
      {isChangedManually ? <span className={styles.manualMarker} aria-hidden="true" /> : null}
    </button>
    {open ? <Drawer id={detailId} open={open} onOpenChange={(next) => { if (!next) void discardEditing().then((discarded) => { if (discarded) setOpen(false); }); }}
      title={editing ? 'Корректировка начисления' : 'Начисление за день'}
      description={`${objectName} · ${formatUiDate(date, { full: true })}`} busy={saving} returnFocusRef={triggerRef}
      footer={<div className={styles.actions}>
        {editing ? <>
          {canRestore ? <Button variant="ghost" disabled={saving || !canMutate} onClick={() => void mutate(true)}>{requiresRetroApproval ? 'Согласовать возврат к авторасчёту' : 'Вернуть авторасчёт'}</Button> : null}
          <Button disabled={saving} onClick={() => { void discardEditing(); }}>Отмена</Button>
          <Button variant="primary" pending={saving} disabled={!canMutate} onClick={() => void mutate()}>{canDirectEdit ? 'Сохранить корректировку' : 'Отправить запрос'}</Button>
        </> : <>
          {onOpenDetails ? <Button variant="ghost" onClick={() => { setOpen(false); onOpenDetails(); }}>История / детализация</Button> : null}
          {canOfferCorrection ? <Button disabled={!canMutate} onClick={startEditing}>{canDirectEdit ? 'Скорректировать начисление' : 'Запросить корректировку'}</Button> : null}
        </>}
      </div>}
    >
      <div className={styles.detail}>
        <h3 className={styles.employeeName} tabIndex={-1} data-dialog-initial-focus>{employeeName}</h3>
        <dl className={styles.facts}>
          <div><dt>Текущее начисление</dt><dd>{moneyFormatter.format(finalValue)}</dd></div>
          <div><dt>Автоматическое значение</dt><dd>{moneyFormatter.format(autoValue)}</dd></div>
          <div><dt>Ручное значение</dt><dd>{entry.manualValue === null ? 'Не задано' : moneyFormatter.format(entry.manualValue)}</dd></div>
          <div><dt>Факт выхода</dt><dd>{entry.hasFact ? 'Есть факт присутствия' : 'Факт присутствия не отмечен'}</dd></div>
          {entry.workedHours !== null ? <div><dt>Часы</dt><dd>{entry.workedHours}</dd></div> : null}
          {entry.difference !== 0 ? <div><dt>Отклонение от авторасчёта</dt><dd>{moneyFormatter.format(entry.difference)}</dd></div> : null}
        </dl>
        <p>{describeTimesheetValue(entry)}</p>
        {entry.calculationExplanation ? <section aria-label="Пояснение расчёта"><h3>Пояснение расчёта</h3><p>{entry.calculationExplanation}</p></section> : null}
        {comment ? <section aria-label="Причина корректировки"><h3>Причина корректировки</h3><p>{comment}</p></section> : null}
        {'updatedAt' in entry && entry.updatedAt ? <p>Последнее изменение: {formatUiDate(entry.updatedAt, { time: true, timeZone: 'Europe/Moscow' })}{entry.updatedByUserName ? ` · ${entry.updatedByUserName}` : ''}</p> : null}
        {!isEditableDate ? <p>Корректировка недоступна для закрытого или будущего периода.</p> : null}
        {!canDirectEdit && canOfferCorrection ? <p>Прошлые начисления меняются после согласования другим пользователем руководящего круга. Автор не подтверждает свою заявку.</p> : null}
        {success ? <Alert tone="success" role="status">{success}</Alert> : null}
        {message ? <Alert tone="warning" role="alert">{message}</Alert> : null}
        {mutationsBlocked ? <p role="status">Начисления обновляются или требуют обновления. Корректировка станет доступна после загрузки свежих данных.</p> : null}
        {pendingRequest ? <p>Запрос по этому дню уже ожидает согласования. Повторная отправка недоступна до проверки решения в истории.</p> : null}
        {onRefresh && (mutationsBlocked || retryBlocked) ? <Button disabled={saving || refreshing} onClick={onRefresh}>Обновить табель</Button> : null}
        {editing ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void mutate(); }}>
          <Field label="Новое начисление, ₽" required><input name="dayValue" autoComplete="off" type="number" min="0" step="1" inputMode="numeric" value={value} disabled={saving || !canMutate} onChange={(event) => setValue(event.target.value)} autoFocus /></Field>
          <Field label="Причина" required={requiresRetroApproval || Number(value) !== autoValue} description={requiresRetroApproval ? 'Обязательна для любого изменения прошлых денег, включая возврат к авторасчёту.' : Number(value) === autoValue ? 'Не требуется при возврате к авторасчёту.' : 'Объясните отклонение от автоматического значения.'}>
            <textarea name="reason" autoComplete="off" rows={3} value={reason} disabled={saving || !canMutate} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </form> : null}
      </div>
    </Drawer> : null}
  </>;
}
