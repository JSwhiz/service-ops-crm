'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { correctExtraWork, getCompensationExplanation } from '@/entities/object/api/object-compensation-client';
import type { CompensationAdjustment, CompensationMutationResult } from '@/entities/object/model/object-compensation.types';
import { ApiError } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { formatUiDate } from '@/shared/lib/format-date';
import { Alert, Button, Field, LoadingState } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { moscowToday } from '@/features/object-scheduling/ui/schedule-preview';
import { findExtraWorkSource } from '../model/extra-work-source';
import { focusCompensationField, reportCompensationControl } from './compensation-form-validation';
import styles from './team-compensation.module.css';

export function ExtraWorkCorrectionDialog({ objectId, adjustment, cancel, returnFocusRef, onClose, onSaved }: {
  objectId: string; adjustment: CompensationAdjustment; cancel: boolean; returnFocusRef: React.RefObject<HTMLElement>;
  onClose: () => void; onSaved: (result: CompensationMutationResult) => void;
}): React.JSX.Element {
  const [source, setSource] = useState<ReturnType<typeof findExtraWorkSource>>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const initial = useRef<{ amount: string; reason: string } | null>(null);
  const lock = useRef(false);
  const request = useRef({ payload: '', key: '' });
  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [confirm, confirmation] = useConfirm();
  const formId = useId();
  useEffect(() => {
    let active = true;
    setSource(null); setLoading(true); setReadError(null);
    const year = Number(adjustment.operationDate.slice(0, 4));
    const month = Number(adjustment.operationDate.slice(5, 7));
    void getCompensationExplanation(objectId, year, month).then((explanation) => {
      if (!active) return;
      const saved = findExtraWorkSource(explanation, adjustment.id, adjustment.operationDate);
      if (!saved) { setReadError('Текущее начисление допработы или время его изменения недоступны. Обновите сведения.'); return; }
      setSource(saved);
      if (!initial.current) {
        const value = cancel ? '0' : String(saved.amount);
        initial.current = { amount: value, reason: '' };
        setAmount(value);
      }
    }).catch((caught) => { if (active) setReadError(getErrorMessage(caught, 'Не удалось загрузить текущее начисление допработы.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId, adjustment.id, adjustment.operationDate, cancel, retry]);
  useEffect(() => { if (source) (cancel ? reasonRef.current : amountRef.current)?.focus({ preventScroll: true }); }, [source, cancel]);
  const close = async (): Promise<void> => {
    if (lock.current) return;
    const dirty = initial.current && (amount !== initial.current.amount || reason !== initial.current.reason);
    if (dirty && !await confirm({ title: 'Закрыть исправление допработы?', consequence: 'Введённая сумма и причина будут потеряны.', confirmLabel: 'Закрыть' })) return;
    onClose();
  };
  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || blocked || loading || readError || !source) return;
    const form = event.currentTarget;
    if (!reportCompensationControl(form, 'amount')) return;
    if (Number(amount) === source.amount) { setInvalidField('amount'); setError(source.amount === 0 ? 'Эта допработа уже отменена. Для восстановления задайте новую сумму.' : 'Укажите новую сумму начисления.'); focusCompensationField(form, 'amount'); return; }
    if (!reason.trim()) { setInvalidField('reason'); setError('Укажите основание исправления допработы.'); focusCompensationField(form, 'reason'); return; }
    if (!form.reportValidity()) return;
    const payload = { expectedCreditUpdatedAt: source.updatedAt, amount: Number(amount), reason: reason.trim() };
    const serialized = JSON.stringify(payload);
    if (request.current.payload !== serialized) request.current = { payload: serialized, key: crypto.randomUUID() };
    lock.current = true; setPending(true); setError(null); setInvalidField(null);
    try { onSaved(await correctExtraWork(objectId, adjustment.id, { ...payload, requestKey: request.current.key })); }
    catch (caught) {
      setError(getErrorMessage(caught, 'Результат исправления не подтверждён. Проверьте историю перед повторной отправкой.'));
      setBlocked(!(caught instanceof ApiError) || ![400, 422].includes(caught.statusCode));
    } finally { lock.current = false; setPending(false); }
  };
  return <>{confirmation}<Dialog open busy={pending} onOpenChange={(open) => { if (!open) void close(); }} returnFocusRef={returnFocusRef}
    title={cancel ? 'Отменить начисление за допработу' : 'Исправить начисление за допработу'}
    description={`${formatUiDate(adjustment.operationDate)} · основная оплата выхода останется прежней.`}
    footer={<div className="ui-inline"><Button disabled={pending} onClick={() => { void close(); }}>Закрыть</Button><Button form={formId} type="submit" variant="primary" pending={pending} disabled={blocked || loading || !!readError || !source || cancel && source.amount === 0}>{adjustment.operationDate < moscowToday() ? 'Отправить на согласование' : cancel ? 'Отменить допработу' : 'Сохранить исправление'}</Button></div>}>
    <form id={formId} noValidate className={styles.content} onSubmit={(event) => { void save(event); }}>
      {loading ? <LoadingState label="Загрузка текущего начисления" /> : null}
      {readError ? <Alert tone="warning" action={<Button onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</Button>}>{readError}</Alert> : null}
      {source ? <>
        <p tabIndex={-1} data-dialog-initial-focus>{source.employeeName} · сейчас начислено за эту допработу: {source.amount.toLocaleString('ru-RU')} ₽.</p>
        <p className="ui-text-muted">Исходное основание: {adjustment.reason}</p>
        <div className={styles.amount}><Field label="Новое начисление, ₽" required error={invalidField === 'amount' ? error : undefined} description="0 отменяет только эту допработу."><input ref={amountRef} name="amount" type="number" min="0" max="2147483647" step="1" inputMode="numeric" autoComplete="off" required readOnly={cancel} disabled={pending} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field></div>
        <Field label="Основание исправления" required error={invalidField === 'reason' ? error : undefined}><textarea ref={reasonRef} name="reason" rows={3} maxLength={1000} autoComplete="off" required disabled={pending} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        {cancel && source.amount === 0 ? <Alert tone="info">Эта допработа уже отменена.</Alert> : null}
      </> : null}
      {adjustment.operationDate < moscowToday() ? <Alert tone="info">Прежняя сумма действует до согласования другим пользователем руководящего круга. Автор не подтверждает собственное исправление.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {blocked ? <Alert tone="warning">Черновик сохранён. Повторная отправка заблокирована: закройте форму и обновите историю для проверки суммы и решения по запросу.</Alert> : null}
    </form>
  </Dialog></>;
}
