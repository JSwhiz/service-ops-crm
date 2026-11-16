'use client';

import React, { useId, useRef, useState } from 'react';

import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { getOneTimeOrderInventory } from '@/entities/inventory/api/inventory-client';
import { ApiError } from '@/shared/api/fetcher';
import { getErrorMessage } from '@/shared/lib/error-message';
import { usePageExitGuard } from '@/shared/lib/use-page-exit-guard';
import { formatInventoryQuantity } from '@/shared/lib/inventory-presentation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Dialog, useConfirm } from '@/shared/ui/overlays';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

import styles from './one-time-order-inventory-issue-form.module.css';

export interface OrderInventoryIssueInput {
  inventoryItemId: string;
  quantity: number;
  comment?: string;
  requestId: string;
}

/** A successful stock movement is never repeated when only its photos failed. */
export function OneTimeOrderInventoryIssueForm({
  orderId,
  availableItems,
  onIssue,
  onAttachEvidence,
  onRefresh,
}: {
  orderId: string;
  availableItems: InventoryItem[];
  onIssue: (input: OrderInventoryIssueInput, hasPendingPhotos: boolean) => Promise<string | null>;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [movementId, setMovementId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [accessRestored, setAccessRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const selected = availableItems.find((item) => item.id === itemId);
  const locked = pending || isCheckingAccess || movementId !== null || uncertain;
  const dirty = Boolean(itemId || comment.trim() || files.length || quantity !== '1');
  usePageExitGuard(open && dirty, confirm);

  const close = async (): Promise<void> => {
    if (submitting.current || isCheckingAccess) return;
    if (dirty && !(await confirm({
      title: movementId ? 'Закрыть отгрузку?' : 'Закрыть форму отгрузки?',
      consequence: movementId
        ? 'Отгрузка уже записана. Если фото не загрузились, их можно добавить в журнале движений.'
        : uncertain
          ? 'Сервер мог записать отгрузку. Перед новой операцией проверьте журнал движений заказа.'
          : 'Введённые данные и выбранные фото не сохранятся.',
      confirmLabel: 'Закрыть форму',
    }))) return;
    setOpen(false);
  };

  const checkIssueAccess = async (): Promise<void> => {
    if (isCheckingAccess || !accessDenied || !itemId) return;
    setIsCheckingAccess(true);
    try {
      const inventory = await getOneTimeOrderInventory(orderId);
      if (inventory.capabilities.canIssueInventoryToOrder && inventory.availableItems.some((item) => item.id === itemId)) {
        setAccessDenied(false);
        setAccessRestored(true);
        setError(null);
      } else {
        setError('Отгрузка в этот заказ пока недоступна для выбранного расходника. Черновик остался в форме.');
      }
    } catch (cause) {
      setError(cause instanceof ApiError && [403, 404].includes(cause.statusCode)
        ? 'Доступ к отгрузке пока закрыт. Черновик остался в форме.'
        : 'Не удалось проверить доступ. Черновик остался в форме. Повторите проверку.');
    } finally {
      setIsCheckingAccess(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting.current || isCheckingAccess || accessDenied) return;
    const amount = Number(quantity);
    if (!movementId && (!selected || !Number.isFinite(amount) || amount < 0.001)) {
      setError('Выберите расходник и укажите количество не меньше 0,001.');
      formRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    setAccessRestored(false);
    let savedId = movementId;
    try {
      if (!savedId) {
        requestId.current ??= crypto.randomUUID();
        savedId = await onIssue({
          inventoryItemId: itemId,
          quantity: amount,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          requestId: requestId.current,
        }, files.length > 0);
        if (!savedId) return;
        setMovementId(savedId);
        setUncertain(false);
      }
      if (files.length) {
        await onAttachEvidence(savedId, files);
        setFiles([]);
      }
      await onRefresh();
      setOpen(false);
      setSuccess(true);
    } catch (cause) {
      if (!savedId && cause instanceof ApiError && cause.statusCode === 403) {
        setAccessDenied(true);
        setError('Недостаточно прав, чтобы отгрузить расходники в этот заказ. Введённые данные остались в форме. Уточните доступ у учредителя.');
        return;
      }
      // Keep the identical request ID and payload after a lost response. The
      // server checks idempotency; a retry must not create another movement.
      if (!savedId && (!(cause instanceof ApiError) || cause.statusCode === 0 || cause.statusCode >= 500 || cause.code === 'ACCESS_VERSION_CHANGED')) {
        setUncertain(true);
      }
      setError(getErrorMessage(cause, 'Не удалось завершить отгрузку. Проверьте журнал движений и повторите попытку.'));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <>
      {confirmDialog}
      <Button className={styles.trigger} icon={<PlusIcon />} onClick={() => {
        setItemId(''); setQuantity('1'); setComment(''); setFiles([]);
        setMovementId(null); setUncertain(false); setAccessDenied(false); setAccessRestored(false); setError(null); setSuccess(false);
        requestId.current = null;
        setOpen(true);
      }}>Отгрузить расходники</Button>
      {success ? <Alert tone="success" role="status">Отгрузка записана. Журнал движений обновлён.</Alert> : null}
      <Dialog
        open={open}
        onOpenChange={(next) => { if (!next) void close(); }}
        title="Отгрузить расходники на заказ"
        description="Расходники будут выданы с центрального склада только на этот заказ."
        size="regular"
        busy={pending || isCheckingAccess}
        footer={<div className={styles.actions}>
          <Button disabled={pending || isCheckingAccess} onClick={() => void close()}>Отмена</Button>
          {accessDenied ? (
            <Button type="button" pending={isCheckingAccess} pendingLabel="Проверяем доступ…" onClick={() => void checkIssueAccess()}>Проверить доступ</Button>
          ) : null}
          <Button variant="primary" type="submit" form={formId} pending={pending} disabled={accessDenied || isCheckingAccess}>
            {movementId ? 'Завершить сохранение' : uncertain ? 'Проверить и повторить' : 'Записать отгрузку'}
          </Button>
        </div>}
      >
        <form ref={formRef} id={formId} className={styles.form} onSubmit={(event) => void submit(event)}>
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {accessRestored ? <Alert tone="success" role="status">Доступ к отгрузке восстановлен. Чтобы записать её, нажмите «Записать отгрузку».</Alert> : null}
          {movementId ? <Alert tone="info">Отгрузка уже записана. Повторное нажатие сохранит только оставшиеся фото и обновит журнал.</Alert> : null}
          {uncertain && !movementId ? <Alert tone="warning">Ответ сервера не получен. Данные зафиксированы для безопасной повторной проверки этой же операции.</Alert> : null}
          <SearchableSelect
            label="Расходник"
            value={itemId}
            options={availableItems.map((item) => ({
              value: item.id,
              label: `${item.name} · остаток ${formatInventoryQuantity(item.currentStock, item.unit)}`,
              searchText: `${item.name} ${item.category}`,
            }))}
            onChange={setItemId}
            placeholder="Выберите расходник"
            searchPlaceholder="Название расходника…"
            searchable clearable={false} viewportAware disabled={locked}
          />
          <div className={styles.quantity}>
            <Field label={selected ? `Количество, ${selected.unit}` : 'Количество'} required>
              <input name="quantity" type="number" inputMode="decimal" min="0.001" step="0.001" value={quantity} disabled={locked} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <div className="ui-text-muted">
              {selected ? `На складе: ${formatInventoryQuantity(selected.currentStock, selected.unit)}. Остаток проверяется при сохранении.` : 'Сначала выберите расходник.'}
            </div>
          </div>
          <Field label="Комментарий">
            <textarea name="comment" rows={2} value={comment} disabled={locked} onChange={(event) => setComment(event.target.value)} placeholder="Куда и для каких работ выдаются расходники…" />
          </Field>
          <div className={styles.evidence}>
            <strong>Фото подтверждения</strong>
            <MediaActionPicker allowGenericFile={false} disabled={pending} onPick={async (file) => { setFiles((current) => [...current, file]); }} />
            <PendingMediaList files={files} iconActions onRemove={pending ? undefined : (index) => setFiles((current) => current.filter((_, position) => position !== index))} emptyText="Фото пока не выбраны. Статус подтверждения будет показан в журнале движений." />
          </div>
        </form>
      </Dialog>
    </>
  );
}
