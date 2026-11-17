'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError, fetcher, postCommittedWrite } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { usePageExitGuard } from '@/shared/lib/use-page-exit-guard';
import styles from './equipment-order-actions.module.css';

interface OrderEquipmentOptions {
  availableUnits: Array<{ id: string; inventoryNumber: string; name: string }>;
  returnableUnitIds: string[];
  canAssign: boolean;
}

export function EquipmentOrderActions({ orderId, units, onRefresh, onSavedWithoutAccess }: {
  orderId: string;
  units: EquipmentUnit[];
  onRefresh: () => Promise<void>;
  onSavedWithoutAccess?: () => void;
}): React.JSX.Element {
  const { user } = useAuth();
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  const accessRevision = useAccessRevision();
  const formId = useId();
  const [options, setOptions] = useState<OrderEquipmentOptions | null>(null);
  const [mode, setMode] = useState<'assign' | 'return' | null>(null);
  const [unitId, setUnitId] = useState('');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const readRequest = useRef(0);
  const optionsGeneration = useRef<number | null>(null);
  const acknowledgedWithoutAccess = useRef(false);
  const draft = useRef({ mode, unitId });
  draft.current = { mode, unitId };
  const currentScope = useRef({ orderId, accessRevision });
  currentScope.current = { orderId, accessRevision };
  const [confirm, confirmDialog] = useConfirm();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readRequest.current += 1; };
  }, []);
  const refreshOptions = useCallback(async (explicitRecovery = false): Promise<boolean> => {
    if (acknowledgedWithoutAccess.current) return false;
    const request = ++readRequest.current;
    const generation = getAccessGeneration();
    const isCurrent = () => mounted.current && request === readRequest.current &&
      currentScope.current.orderId === orderId && currentScope.current.accessRevision === accessRevision &&
      isAccessGenerationCurrent(generation) && !acknowledgedWithoutAccess.current;
    optionsGeneration.current = null;
    setOptions(null);
    setCheckingAccess(true);
    try {
      const result = await fetcher<OrderEquipmentOptions>(`/equipment/scoped/one-time-orders/${orderId}/options`, { method: 'GET' });
      if (!isCurrent()) return false;
      optionsGeneration.current = generation;
      setOptions(result);
      setReadError(null);
      if (explicitRecovery) {
        const selection = draft.current;
        const restored = !selection.mode || (selection.mode === 'assign'
          ? result.canAssign && result.availableUnits.some(unit => unit.id === selection.unitId)
          : result.returnableUnitIds.includes(selection.unitId));
        if (restored) setError(null);
        else setReadError('Действие пока недоступно для выбранного оборудования. Черновик сохранён в форме.');
      }
      return true;
    } catch (cause) {
      if (isCurrent()) setReadError(getErrorMessage(cause, 'Не удалось загрузить действия с оборудованием.'));
      return false;
    } finally {
      if (mounted.current && request === readRequest.current) setCheckingAccess(false);
    }
  }, [orderId, accessRevision]);
  useEffect(() => {
    readRequest.current += 1;
    optionsGeneration.current = null;
    setOptions(null);
    setCheckingAccess(false);
    if (!submitting.current) void refreshOptions();
    return () => { readRequest.current += 1; };
  }, [units, refreshOptions]);
  useOpenAccessRefresh(mode !== null);
  const dirty = Boolean(mode && (unitId || comment));
  usePageExitGuard(dirty && !saved, confirm);
  const close = async (): Promise<void> => {
    if (submitting.current) return;
    if (dirty && !saved && !(await confirm({ title: 'Закрыть форму?',
      consequence: uncertain ? 'Сервер мог записать движение. Проверьте оборудование заказа перед новой операцией.' : 'Введённые данные не сохранятся.', confirmLabel: 'Закрыть форму' }))) return;
    setMode(null);
  };
  const open = (next: 'assign' | 'return') => {
    if (checkingAccess || submitting.current || optionsGeneration.current !== getAccessGeneration()) return;
    setMode(next); setUnitId(''); setComment(''); setError(null); setSuccess(null); setSaved(false); setUncertain(false);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || uncertain || checkingAccess || !mode || !unitId || acknowledgedWithoutAccess.current) return;
    if (!saved && (optionsGeneration.current !== getAccessGeneration() || !choices.some(choice => choice.value === unitId))) return;
    const session = getAccessSessionGeneration();
    const actorId = user?.id;
    const canAcknowledgeAtRoot = () => Boolean(actorId) && currentActor.current === actorId &&
      currentScope.current.orderId === orderId && session === getAccessSessionGeneration();
    const isCurrent = () => mounted.current && canAcknowledgeAtRoot();
    submitting.current = true;
    readRequest.current += 1;
    setPending(true); setError(null); setReadError(null);
    let committed = saved;
    try {
      if (!committed) {
        const result = await postCommittedWrite<{ id: string; movementId: string; status: string }>(`/equipment/scoped/units/${unitId}/one-time-orders/${orderId}/${mode === 'assign' ? 'assign' : 'return'}`, {
          body: JSON.stringify({ ...(comment.trim() ? { comment: comment.trim() } : {}) }),
        });
        if (!canAcknowledgeAtRoot()) return;
        committed = true;
        // Root acknowledgement survives the row being removed by a fresh deny.
        // Local state and protected reads still require the child to be mounted.
        if (isSavedWithoutAccess(result) || !mounted.current) {
          acknowledgedWithoutAccess.current = true;
          readRequest.current += 1;
          optionsGeneration.current = null;
          if (mounted.current) {
            setSaved(true);
            setOptions(null); setMode(null); setUnitId(''); setComment('');
            setSuccess('Действие сохранено. Доступ к данным изменился.');
          }
          onSavedWithoutAccess?.();
          return;
        }
        setSaved(true);
      }
      if (!isCurrent()) return;
      await onRefresh();
      if (!isCurrent()) return;
      if (!(await refreshOptions())) return;
      if (!isCurrent()) return;
      setMode(null);
      setSuccess(mode === 'assign' ? 'Оборудование закреплено за заказом.' : 'Оборудование возвращено на склад.');
    } catch (cause) {
      if (!isCurrent() || acknowledgedWithoutAccess.current) return;
      readRequest.current += 1;
      optionsGeneration.current = null;
      setOptions(null);
      if (!committed && (!(cause instanceof ApiError) || cause.statusCode === 0 || cause.statusCode >= 500 || cause.statusCode === 409)) setUncertain(true);
      setError(getErrorMessage(cause, committed ? 'Движение записано, но обновить список не удалось. Повторите обновление.' : 'Не удалось записать движение оборудования.'));
    } finally {
      submitting.current = false;
      if (isCurrent()) setPending(false);
    }
  };
  const checkAccess = () => { if (!submitting.current && !checkingAccess) void refreshOptions(true); };
  const refreshUncertain = async () => {
    if (submitting.current || checkingAccess) return;
    const session = getAccessSessionGeneration();
    submitting.current = true; setPending(true);
    try {
      await onRefresh();
      if (mounted.current && session === getAccessSessionGeneration()) await refreshOptions();
    } catch (cause) {
      if (mounted.current && session === getAccessSessionGeneration()) setReadError(getErrorMessage(cause, 'Не удалось обновить оборудование.'));
    } finally {
      submitting.current = false;
      if (mounted.current && session === getAccessSessionGeneration()) setPending(false);
    }
  };
  const optionsFresh = optionsGeneration.current === getAccessGeneration();
  const currentOptions = optionsFresh ? options : null;
  const choices = mode === 'assign'
    ? currentOptions?.availableUnits.map(unit => ({ value: unit.id, label: `${unit.name} · ${unit.inventoryNumber}` })) ?? []
    : units.filter(unit => currentOptions?.returnableUnitIds.includes(unit.id)).map(unit => ({ value: unit.id, label: `${unit.catalogItem.name} · ${unit.inventoryNumber}` }));
  return <>
    {confirmDialog}
    <div className={styles.actions}>
      {currentOptions?.canAssign ? <Button disabled={pending || checkingAccess} onClick={() => open('assign')}>Закрепить оборудование</Button> : null}
      {currentOptions?.returnableUnitIds.length ? <Button disabled={pending || checkingAccess} onClick={() => open('return')}>Вернуть оборудование</Button> : null}
    </div>
    {success ? <Alert tone="success" role="status">{success}</Alert> : null}
    {!mode && (error || readError) ? <Alert tone="danger" role="alert">{error ?? readError}<Button disabled={pending || checkingAccess} onClick={checkAccess}>Обновить доступ</Button></Alert> : null}
    <Dialog open={mode !== null} onOpenChange={next => { if (!next) void close(); }} busy={pending || checkingAccess}
      title={mode === 'assign' ? 'Закрепить оборудование за заказом' : 'Вернуть оборудование на склад'}
      description="Действие сохраняет местонахождение единицы и запись в истории оборудования."
      footer={<div className={styles.actions}>
        {!options && !saved && !uncertain ? <Button disabled={pending || checkingAccess} onClick={checkAccess}>Проверить доступ</Button> : null}
        {uncertain ? <Button disabled={pending || checkingAccess} onClick={() => void refreshUncertain()}>Обновить оборудование</Button> : null}
        <Button disabled={pending} onClick={() => void close()}>Закрыть</Button>
        {!uncertain ? <Button type="submit" form={formId} variant="primary" pending={pending} disabled={checkingAccess || (!saved && !optionsFresh) || !unitId || (!saved && (!options || !choices.some(choice => choice.value === unitId)))}>{saved ? 'Обновить список' : mode === 'assign' ? 'Закрепить' : 'Вернуть на склад'}</Button> : null}
      </div>}>
      <form id={formId} onSubmit={event => void submit(event)} className={styles.form}>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        {readError ? <Alert tone="danger" role="alert">{readError}</Alert> : null}
        {saved ? <Alert tone="info">Движение уже записано. Повторное нажатие только обновит список.</Alert> : null}
        {uncertain ? <Alert tone="warning">Результат операции нужно проверить. Закройте форму и обновите оборудование заказа перед следующим действием.</Alert> : null}
        <SearchableSelect label="Оборудование" value={unitId} options={choices} onChange={setUnitId} placeholder="Выберите оборудование" searchable clearable={false} viewportAware disabled={pending || saved || uncertain} />
        <Field label="Комментарий"><textarea rows={3} value={comment} onChange={event => setComment(event.target.value)} disabled={pending || saved || uncertain} /></Field>
      </form>
    </Dialog>
  </>;
}
