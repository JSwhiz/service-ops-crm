'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  CompleteOneTimeOrderPayload,
  CorrectOneTimeOrderPaymentPayload,
  OneTimeOrderCompletion,
  OneTimeOrderCompletionPayment,
  OneTimeOrderItem,
  OneTimeOrderPaymentDestination,
  OneTimeOrderPaymentMethod,
  OneTimeOrderPaymentZeroReason,
  VisibleOneTimeOrderCompletionPayment,
} from '@/entities/one-time-order/model/one-time-order.types';
import { listOneTimeOrderPaymentRecipientCandidates } from '@/entities/user/api/user-client';
import { ApiError } from '@/shared/api/fetcher';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { commitAndStartRefresh } from '@/features/one-time-order-completion/model/commit-and-refresh';
import {
  getOneTimeOrderPaymentDestinationLabel,
  getOneTimeOrderPaymentMethodLabel,
  getOneTimeOrderPaymentZeroReasonLabel,
  getOneTimeOrderStatusLabel,
} from '@/shared/lib/one-time-order-presentation';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { Alert, Button, StatusBadge, Surface } from '@/shared/ui/foundation';
import { ChevronDownIcon } from '@/shared/ui/icons/icons';
import { useConfirm } from '@/shared/ui/overlays';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

const PAYMENT_METHODS: OneTimeOrderPaymentMethod[] = [
  'cash',
  'personal_card_transfer',
  'organization_transfer',
  'other',
];
const ZERO_REASONS: OneTimeOrderPaymentZeroReason[] = [
  'payment_later',
  'paid_directly_to_organization',
  'free_order',
  'customer_did_not_pay',
  'other',
];

type PaymentMode = 'paid' | 'no_payment';

interface PaymentDraft {
  key: string;
  mode: PaymentMode;
  recipientUserId: string;
  amount: string;
  paymentMethod: OneTimeOrderPaymentMethod | '';
  paymentDestination: OneTimeOrderPaymentDestination | '';
  zeroReason: OneTimeOrderPaymentZeroReason | '';
  comment: string;
}

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function createPaymentDraft(): PaymentDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    mode: 'paid',
    recipientUserId: '',
    amount: '',
    paymentMethod: '',
    paymentDestination: '',
    zeroReason: '',
    comment: '',
  };
}

function setPaymentMode(draft: PaymentDraft, mode: PaymentMode): PaymentDraft {
  if (mode === 'no_payment') {
    return {
      ...draft,
      mode,
      recipientUserId: '',
      amount: '0',
      paymentMethod: '',
      paymentDestination: '',
    };
  }

  return {
    ...draft,
    mode,
    amount: '',
    zeroReason: '',
  };
}

function normalizeMethodChange(
  draft: PaymentDraft,
  method: OneTimeOrderPaymentMethod,
): PaymentDraft {
  if (method === 'organization_transfer') {
    return {
      ...draft,
      paymentMethod: method,
      paymentDestination: 'organization',
      recipientUserId: '',
    };
  }

  if (method === 'cash' || method === 'personal_card_transfer') {
    return {
      ...draft,
      paymentMethod: method,
      paymentDestination: 'manager_accountability',
    };
  }

  return {
    ...draft,
    paymentMethod: method,
    paymentDestination: '',
    recipientUserId: '',
  };
}

function isDraftValid(draft: PaymentDraft): boolean {
  if (draft.mode === 'no_payment') {
    return (
      Boolean(draft.zeroReason) &&
      (draft.zeroReason !== 'other' || Boolean(draft.comment.trim()))
    );
  }

  const amount = Number(draft.amount);
  return (
    draft.amount.trim() !== '' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    Boolean(draft.paymentMethod) &&
    Boolean(draft.paymentDestination) &&
    (draft.paymentDestination !== 'manager_accountability' ||
      Boolean(draft.recipientUserId)) &&
    (draft.paymentMethod !== 'other' || Boolean(draft.comment.trim()))
  );
}

export function OneTimeOrderCompletionPanel({
  item,
  completions,
  onComplete,
  onRefresh,
  onDraftChange,
  onReopen,
  onCorrectPayment,
  openFormSignal = 0,
}: {
  item: OneTimeOrderItem;
  completions: OneTimeOrderCompletion[];
  onComplete: (payload: CompleteOneTimeOrderPayload) => Promise<void>;
  onRefresh: () => Promise<boolean>;
  onDraftChange?: (dirty: boolean) => void;
  onReopen: () => Promise<void>;
  onCorrectPayment: (
    paymentId: string,
    payload: CorrectOneTimeOrderPaymentPayload,
  ) => Promise<void>;
  openFormSignal?: number;
}): React.JSX.Element {
  const [payments, setPayments] = useState<PaymentDraft[]>([
    createPaymentDraft(),
  ]);
  const [completionComment, setCompletionComment] = useState('');
  const [differenceReason, setDifferenceReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isCompletionFormOpen, setIsCompletionFormOpen] = useState(false);
  const [isCompletionRefreshNeeded, setIsCompletionRefreshNeeded] = useState(false);
  const [isRefreshingAfterCompletion, setIsRefreshingAfterCompletion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [serverRequiresDifferenceReason, setServerRequiresDifferenceReason] =
    useState(false);
  const inFlightRef = useRef(false);
  const retryRequestRef = useRef<{
    fingerprint: string;
    payload: CompleteOneTimeOrderPayload;
  } | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const isDraftDirty = Boolean(
    completionComment ||
    differenceReason ||
    payments.length !== 1 ||
    payments.some((payment) =>
      payment.mode !== 'paid' ||
      payment.amount !== '' ||
      payment.recipientUserId !== '' ||
      payment.paymentMethod !== '' ||
      payment.paymentDestination !== '' ||
      payment.zeroReason !== '' ||
      payment.comment !== ''
    ),
  );

  useEffect(() => {
    onDraftChange?.(isDraftDirty);
  }, [isDraftDirty, onDraftChange]);

  const refreshAfterCompletion = async (): Promise<void> => {
    setIsRefreshingAfterCompletion(true);
    try {
      const refreshed = await onRefresh();
      setIsCompletionRefreshNeeded(!refreshed);
    } catch {
      setIsCompletionRefreshNeeded(true);
    } finally {
      setIsRefreshingAfterCompletion(false);
    }
  };

  useEffect(() => {
    if (openFormSignal > 0 && item.capabilities.canComplete) {
      setIsCompletionFormOpen(true);
    }
  }, [openFormSignal, item.capabilities.canComplete]);

  const currentCompletedStage = item.status === 'completed'
    ? completions.find((completion) => completion.workCycle === item.workCycle && completion.status === 'active') ?? null
    : null;
  const previousCompletions = currentCompletedStage
    ? completions.filter((completion) => completion.id !== currentCompletedStage.id)
    : completions;
  const previousActual = useMemo(
    () =>
      previousCompletions.reduce(
        (sum, completion) => sum + completion.visibleTotalAmount,
        0,
      ),
    [previousCompletions],
  );
  const currentActual = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const enteredPaidAmounts = payments
    .filter((payment) => payment.mode === 'paid' && payment.amount.trim() !== '')
    .map((payment) => Number(payment.amount));
  const hasInvalidDraftAmount = enteredPaidAmounts.some((amount) => !Number.isFinite(amount) || amount <= 0);
  const hasUnfilledDraftAmount = payments.some((payment) => payment.mode === 'paid' && payment.amount.trim() === '');
  const enteredDraftTotal = enteredPaidAmounts.reduce((sum, amount) => sum + amount, 0);
  const cumulativeActual = previousActual + currentActual;
  const fullPreviousTotalVisible = previousCompletions.every(
    (completion) => completion.fullTotalAmountVisible,
  );
  const hasEnteredAmounts = payments.every(
    (payment) => payment.mode === 'no_payment' || payment.amount.trim() !== '',
  );
  const isExplicitNoPayment =
    payments.length === 1 && payments[0]?.mode === 'no_payment';
  const hasDifference =
    !isExplicitNoPayment &&
    hasEnteredAmounts &&
    fullPreviousTotalVisible &&
    item.agreedSum !== null &&
    Math.abs(cumulativeActual - item.agreedSum) >= 0.005;
  const needsDifferenceReason = hasDifference || serverRequiresDifferenceReason;
  const canSubmit =
    payments.length > 0 &&
    payments.every(isDraftValid) &&
    (!needsDifferenceReason || Boolean(differenceReason.trim()));

  const updatePayment = (
    key: string,
    update: (draft: PaymentDraft) => PaymentDraft,
  ): void => {
    setPayments((current) => {
      const next = current.map((payment) =>
        payment.key === key ? update(payment) : payment,
      );
      const noPayment = next.find((payment) => payment.mode === 'no_payment');
      return noPayment ? [noPayment] : next;
    });
  };

  const submit = async (): Promise<void> => {
    if (inFlightRef.current) {
      return;
    }

    if (!canSubmit) {
      setError('Заполните обязательные поля получения и причину расхождения.');
      return;
    }

    const basePayload = {
      workCycle: item.workCycle,
      completionComment: completionComment.trim() || undefined,
      payments: payments.map(
        (payment, index): CompleteOneTimeOrderPayload['payments'][number] => {
          const shared = {
            comment: payment.comment.trim() || null,
            differenceReason:
              index === 0 && needsDifferenceReason
                ? differenceReason.trim()
                : null,
          };

          if (payment.mode === 'no_payment') {
            return {
              ...shared,
              recipientUserId: null,
              amount: 0,
              paymentMethod: null,
              paymentDestination: null,
              zeroReason: payment.zeroReason || null,
            };
          }

          return {
            ...shared,
            recipientUserId:
              payment.paymentDestination === 'manager_accountability'
                ? payment.recipientUserId
                : null,
            amount: Number(payment.amount),
            paymentMethod: payment.paymentMethod || null,
            paymentDestination: payment.paymentDestination || null,
            zeroReason: null,
          };
        },
      ),
    };
    const fingerprint = JSON.stringify(basePayload);
    const previousRequest = retryRequestRef.current;
    const requestPayload: CompleteOneTimeOrderPayload =
      previousRequest?.fingerprint === fingerprint
        ? previousRequest.payload
        : {
            ...basePayload,
            clientRequestId: crypto.randomUUID(),
          };
    retryRequestRef.current = { fingerprint, payload: requestPayload };
    inFlightRef.current = true;
    setIsSaving(true);
    setCanRetry(false);
    setError(null);
    try {
      const { refreshResult } = await commitAndStartRefresh(
        () => onComplete(requestPayload),
        () => {
          retryRequestRef.current = null;
          setPayments([createPaymentDraft()]);
          setCompletionComment('');
          setDifferenceReason('');
          setServerRequiresDifferenceReason(false);
          setIsCompletionFormOpen(false);
          setCanRetry(false);
          setIsCompletionRefreshNeeded(true);
        },
        onRefresh,
      );
      void refreshResult.then((refreshed) => {
        setIsCompletionRefreshNeeded(!refreshed);
      });
    } catch (saveError) {
      if (
        saveError instanceof ApiError &&
        saveError.code === 'ACTUAL_AMOUNT_DIFFERENCE_REASON_REQUIRED'
      ) {
        retryRequestRef.current = null;
        setServerRequiresDifferenceReason(true);
        setCanRetry(false);
        setError('Укажите причину расхождения фактической и согласованной суммы.');
        return;
      }
      setError(
        'Не удалось завершить заказ. Введённые данные сохранены; проверьте карточку и повторите действие.',
      );
      setCanRetry(true);
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Surface as="section" padding="md" id="order-completion" className={orderStyles.orderCompletionPanel}>
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Оплата и завершение</div>
          <details className={orderStyles.orderCompletionHelp}>
            <summary>Как начинается новый этап?</summary>
            <div>Новый этап начинается, когда завершённый заказ снова открывают для работы. Предыдущие поступления сохраняются.</div>
          </details>
        </div>
        <div className={orderStyles.orderCompletionStageHeading}>
          <strong>Этап работ №{item.workCycle}</strong>
          <StatusBadge status={item.status}>{getOneTimeOrderStatusLabel(item.status)}</StatusBadge>
        </div>
      </div>

      <div className={orderStyles.orderCompletionSummary}>
        <Summary label="Стоимость заказа" value={item.agreedSum === null ? 'Не указана' : formatMoney(item.agreedSum)} detail="Согласованная сумма, не факт оплаты" />
        <Summary
          label={currentCompletedStage ? 'Получено в текущем этапе' : 'Получено за предыдущие этапы'}
          value={formatMoney(currentCompletedStage?.visibleTotalAmount ?? previousActual)}
          detail={currentCompletedStage && !currentCompletedStage.fullTotalAmountVisible || !currentCompletedStage && !fullPreviousTotalVisible ? 'Показана только доступная для просмотра часть' : undefined}
        />
      </div>

      {!fullPreviousTotalVisible || Boolean(currentCompletedStage && !currentCompletedStage.fullTotalAmountVisible) ? (
        <div className="ui-text-muted">
          Часть сведений о поступлениях недоступна для просмотра; показанная сумма не является полным итогом.
        </div>
      ) : null}

      {isCompletionRefreshNeeded ? (
        <Alert
          tone={isRefreshingAfterCompletion ? 'info' : 'warning'}
          role={isRefreshingAfterCompletion ? 'status' : 'alert'}
          action={isRefreshingAfterCompletion ? undefined : (
            <Button onClick={() => void refreshAfterCompletion()}>Обновить</Button>
          )}
        >
          {isRefreshingAfterCompletion
            ? 'Заказ завершён. Обновляем данные карточки…'
            : 'Заказ завершён, но не удалось обновить данные карточки. Повторите обновление; завершение заказа не будет отправлено повторно.'}
        </Alert>
      ) : null}

      {item.capabilities.canComplete && !isCompletionRefreshNeeded ? (
        <div className={orderStyles.orderCompletionDisclosure}>
          {!isCompletionFormOpen ? (
            <Button className={orderStyles.orderCompletionPrimaryAction} id="order-completion-trigger" variant="primary" onClick={() => setIsCompletionFormOpen(true)}>Завершить заказ</Button>
          ) : (
          <div className={orderStyles.orderCompletionForm}>
          <div className="ui-section-header">
            <strong>Поступления при завершении этапа №{item.workCycle}</strong>
            <Button variant="ghost" onClick={() => setIsCompletionFormOpen(false)}>Свернуть форму</Button>
          </div>
          {payments.map((payment, index) => (
            <PaymentFields
              key={payment.key}
              title={`Поступление ${index + 1}`}
              draft={payment}
              item={item}
              canRemove={payments.length > 1}
              onChange={(update) => updatePayment(payment.key, update)}
              onRemove={() =>
                setPayments((current) =>
                  current.filter((entry) => entry.key !== payment.key),
                )
              }
            />
          ))}

          {!isExplicitNoPayment ? (
            <Button
              className={orderStyles.orderAddPayment}

              onClick={() =>
                setPayments((current) => [...current, createPaymentDraft()])
              }
            >
              Добавить поступление
            </Button>
          ) : null}

          <label className={orderStyles.orderCompletionWideField}>
            <span>Комментарий к завершению</span>
            <textarea
              rows={3}
              value={completionComment}
              onChange={(event) => setCompletionComment(event.target.value)}
              placeholder="Например, повторная поездка или дополнительная услуга"
            />
          </label>

          {needsDifferenceReason ? (
            <div className={orderStyles.orderCompletionWarning}>
              <strong>Комментарий к расхождению общей суммы</strong>
              {fullPreviousTotalVisible ? (
                <div>
                  После этого этапа: {formatMoney(cumulativeActual)}. Укажите причину
                  расхождения.
                </div>
              ) : (
                <div>
                  Укажите причину расхождения. Часть сведений о поступлениях недоступна для просмотра.
                </div>
              )}
              <textarea
                rows={2}
                value={differenceReason}
                onChange={(event) => setDifferenceReason(event.target.value)}
                placeholder="Причина расхождения"
              />
            </div>
          ) : null}

          {!isExplicitNoPayment && enteredPaidAmounts.length > 0 ? (
            <div className={orderStyles.orderCompletionDraftTotal} role="status">
              {hasInvalidDraftAmount ? (
                'Проверьте введённые суммы поступлений — итог не рассчитан.'
              ) : (
                <>
                  Будет записано при завершении{hasUnfilledDraftAmount ? ' по заполненным строкам' : ''}: {formatMoney(enteredDraftTotal)}
                  {hasUnfilledDraftAmount ? <span className="ui-text-muted">. Заполните суммы в оставшихся строках — итог изменится.</span> : null}
                </>
              )}
            </div>
          ) : null}

          {error ? <div className="form-error">{error}</div> : null}
          <div className="ui-inline">
            <Button
              variant="primary"
              disabled={isSaving || !canSubmit}
              onClick={() => void submit()}
            >
              {isSaving ? 'Подтверждаем…' : canRetry ? 'Повторить завершение' : 'Подтвердить завершение'}
            </Button>
            <Button disabled={isSaving} onClick={() => void (async () => {
              const hasDraft = completionComment.trim() || differenceReason.trim() || payments.some((payment) => payment.mode === 'no_payment' || payment.amount.trim() || payment.recipientUserId || payment.comment.trim() || payment.zeroReason || payment.paymentMethod || payment.paymentDestination);
              if (hasDraft && !(await confirm({ title: 'Отменить завершение заказа?', consequence: 'Введённые поступления и комментарии будут очищены.', confirmLabel: 'Отменить и очистить', tone: 'danger' }))) return;
              setPayments([createPaymentDraft()]); setCompletionComment(''); setDifferenceReason('');
              setServerRequiresDifferenceReason(false); setCanRetry(false); setError(null); retryRequestRef.current = null;
              setIsCompletionFormOpen(false);
            })()}>Отмена</Button>
          </div>
          </div>
          )}
        </div>
      ) : item.capabilities.canReopen ? (
        <div className={orderStyles.orderCompletionClosedState}>
          <div>
            <strong>Этап работ №{item.workCycle} завершён.</strong>
            <div className="ui-text-muted">
            Для продолжения работ можно открыть новый этап. Предыдущие поступления и история сохранятся.
            </div>
          </div>
          <Button
            id="order-reopen-trigger"
            disabled={isReopening}
            onClick={() => void confirm({
              title: 'Возобновить работу?',
              consequence: 'Заказ снова перейдёт в работу. Предыдущие поступления и история сохранятся.',
              confirmLabel: 'Возобновить работу',
            }).then((accepted) => {
              if (!accepted) return;
              void (async () => {
                setIsReopening(true);
                setError(null);
                try {
                  await onReopen();
                } catch {
                  setError(
                    'Не удалось возобновить работу. Обновите карточку и повторите действие.',
                  );
                } finally {
                  setIsReopening(false);
                }
              })();
            })}
          >
            {isReopening ? 'Возобновляем…' : 'Возобновить работу'}
          </Button>
        </div>
      ) : null}

      {error && !item.capabilities.canComplete ? (
        <div className="form-error">{error}</div>
      ) : null}

      <CompletionHistory
        item={item}
        completions={completions}
        currentCompletedStageId={currentCompletedStage?.id ?? null}
        onCorrectPayment={onCorrectPayment}
      />
      {confirmDialog}
    </Surface>
  );
}

function PaymentFields({
  title,
  draft,
  item,
  canRemove,
  selectedRecipient = null,
  onChange,
  onRemove,
}: {
  title: string;
  draft: PaymentDraft;
  item: OneTimeOrderItem;
  canRemove: boolean;
  selectedRecipient?: { id: string; login: string; fullName: string } | null;
  onChange: (update: (draft: PaymentDraft) => PaymentDraft) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className={orderStyles.orderPaymentCard}>
      <div className="ui-section-header">
        <strong>{title}</strong>
        {canRemove ? (
          <Button onClick={onRemove}>
            Убрать
          </Button>
        ) : null}
      </div>

      <div className={orderStyles.orderPaymentModeOptions} role="group" aria-label="Состояние оплаты">
        <label className={orderStyles.orderPaymentModeOption}>
          <input
            type="radio"
            name={`payment-mode-${draft.key}`}
            checked={draft.mode === 'paid'}
            onChange={() =>
              onChange((current) => setPaymentMode(current, 'paid'))
            }
          />{' '}
          Деньги получены
        </label>
        <label className={orderStyles.orderPaymentModeOption}>
          <input
            type="radio"
            name={`payment-mode-${draft.key}`}
            checked={draft.mode === 'no_payment'}
            onChange={() =>
              onChange((current) => setPaymentMode(current, 'no_payment'))
            }
          />{' '}
          Деньги не получены
        </label>
      </div>

      {draft.mode === 'no_payment' ? (
        <div className="field-grid">
          <SearchableSelect
              label="Причина"
              value={draft.zeroReason}
              options={ZERO_REASONS.map((reason) => ({ value: reason, label: getOneTimeOrderPaymentZeroReasonLabel(reason) }))}
              placeholder="Выберите причину"
              searchable={false}
              clearable={false}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  zeroReason: value as OneTimeOrderPaymentZeroReason | '',
                }))
              }
          />

          <label className={orderStyles.orderCompletionWideField}>
            <span>Комментарий</span>
            <input
              value={draft.comment}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  comment: event.target.value,
                }))
              }
              placeholder={
                draft.zeroReason === 'other'
                  ? 'Обязательный комментарий'
                  : 'Необязательно'
              }
            />
          </label>

          <div className={orderStyles.orderPaymentNote}>
            Заказ закрывается без записи о получении денег; личный подотчёт не пополняется.
          </div>
        </div>
      ) : (
        <div className="field-grid">
          <label>
            <span>Полученная сумма</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={draft.amount}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              placeholder="0.00"
            />
          </label>

          <SearchableSelect
              label="Способ оплаты"
              value={draft.paymentMethod}
              options={PAYMENT_METHODS.map((method) => ({ value: method, label: getOneTimeOrderPaymentMethodLabel(method) }))}
              placeholder="Выберите способ"
              searchable={false}
              clearable={false}
              onChange={(value) =>
                onChange((current) =>
                  normalizeMethodChange(
                    current,
                    value as OneTimeOrderPaymentMethod,
                  ),
                )
              }
          />

          {draft.paymentMethod === 'other' ? (
            <SearchableSelect
                label="Назначение денег"
                value={draft.paymentDestination}
                options={[
                  { value: 'manager_accountability', label: 'Личный подотчёт' },
                  { value: 'organization', label: 'Организация' },
                ]}
                placeholder="Выберите назначение"
                searchable={false}
                clearable={false}
                onChange={(value) =>
                  onChange((current) => ({
                    ...current,
                    paymentDestination: value as OneTimeOrderPaymentDestination | '',
                    recipientUserId:
                      value === 'organization'
                        ? ''
                        : current.recipientUserId,
                  }))
                }
            />
          ) : null}

          {draft.paymentDestination === 'manager_accountability' ? (
            <SearchableSelect
              label="Кто получил деньги"
              value={draft.recipientUserId}
              options={[]}
              selectedOption={
                selectedRecipient
                  ? {
                      value: selectedRecipient.id,
                      label: `${selectedRecipient.fullName} · @${selectedRecipient.login}`,
                      searchText: `${selectedRecipient.fullName} ${selectedRecipient.login}`,
                    }
                  : null
              }
              placeholder="Выберите получателя"
              searchPlaceholder="ФИО или логин"
              emptyText="Подходящие пользователи не найдены"
              asyncSearch={async (query) =>
                (
                  await listOneTimeOrderPaymentRecipientCandidates(
                    item.id,
                    query,
                  )
                ).map((user) => ({
                  value: user.id,
                  label: `${user.fullName} · @${user.login}`,
                  searchText: `${user.fullName} ${user.login}`,
                }))
              }
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  recipientUserId: value,
                }))
              }
            />
          ) : null}

          <label className={orderStyles.orderCompletionWideField}>
            <span>Комментарий</span>
            <input
              value={draft.comment}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  comment: event.target.value,
                }))
              }
              placeholder={
                draft.paymentMethod === 'other'
                  ? 'Обязательный комментарий'
                  : 'Необязательно'
              }
            />
          </label>

          {draft.paymentDestination === 'organization' ? (
            <div className={orderStyles.orderPaymentNote}>
              Деньги сохранятся в истории заказа. Личный подотчёт менеджера не изменится.
            </div>
          ) : null}
          {draft.paymentDestination === 'manager_accountability' ? (
            <div className={orderStyles.orderPaymentNote}>
              Поступление будет учтено в подотчёте выбранного получателя.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CompletionHistory({
  item,
  completions,
  currentCompletedStageId,
  onCorrectPayment,
}: {
  item: OneTimeOrderItem;
  completions: OneTimeOrderCompletion[];
  currentCompletedStageId: string | null;
  onCorrectPayment: (
    paymentId: string,
    payload: CorrectOneTimeOrderPaymentPayload,
  ) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className={orderStyles.orderCompletionHistory}>
      <div>
                <div className="ui-section-title">Предыдущие этапы</div>
        <div className="ui-section-subtitle">
          Исправления сохраняются отдельными записями — история оплат остаётся доступна.
        </div>
      </div>
      {completions.length === 0 ? (
        <div className="ui-text-muted">
          {item.status === 'completed'
            ? 'Заказ завершили до начала ведения истории завершений. Дата и автор этой записи недоступны.'
            : 'Завершённых этапов пока нет.'}
        </div>
      ) : (
        <div className="record-list">
          {completions.map((completion) => (
            <details key={completion.id} className={orderStyles.orderCompletionCycle}>
              <summary className={orderStyles.orderCompletionStageSummary}>
                <span>
                  <strong>{completion.id === currentCompletedStageId ? `Текущая запись завершения · этап работ №${completion.workCycle}` : `Этап работ №${completion.workCycle}`}</strong>
                  <span className="ui-text-muted">
                    {completion.completionSource === 'legacy_unknown' || !completion.completedAt || !completion.completedBy
                      ? 'Дата и автор для прежней записи недоступны'
                      : `${new Date(completion.completedAt).toLocaleString('ru-RU')} · ${getUserDisplayName(completion.completedBy)}`}
                  </span>
                </span>
                <ChevronDownIcon />
              </summary>
              <div className={orderStyles.orderCompletionStageBody}>
              {!completion.fullTotalAmountVisible ? <div className="ui-text-muted">Показаны только записи, доступные для просмотра; полный итог этапа недоступен.</div> : null}
              {completion.completionComment ? (
                <div>{completion.completionComment}</div>
              ) : null}
              <div className={orderStyles.orderPaymentHistoryList}>
                {completion.payments.map((payment) => (
                  <PaymentHistoryRow
                    key={payment.id}
                    item={item}
                    payment={payment}
                    onCorrectPayment={onCorrectPayment}
                  />
                ))}
              </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentHistoryRow({
  item,
  payment,
  onCorrectPayment,
}: {
  item: OneTimeOrderItem;
  payment: OneTimeOrderCompletionPayment;
  onCorrectPayment: (
    paymentId: string,
    payload: CorrectOneTimeOrderPaymentPayload,
  ) => Promise<void>;
}): React.JSX.Element {
  const [isCorrecting, setIsCorrecting] = useState(false);

  if (payment.detailsRestricted) {
    return (
      <div className={orderStyles.orderPaymentHistoryRow} data-payment-status="restricted">
        <div className="ui-text-muted">
          Финансовые сведения доступны только получателю и ответственному за
          подотчет.
        </div>
      </div>
    );
  }

  const isReversal = payment.status === 'reversal';
  const isNoPayment = payment.amount === 0 && Boolean(payment.zeroReason);
  const entryLabel = isNoPayment
    ? 'Без оплаты'
    : isReversal
      ? 'Сторнирование'
      : payment.correctedFromPaymentId
        ? 'Исправленное поступление'
        : 'Поступление';

  return (
    <div className={orderStyles.orderPaymentHistoryRow} data-payment-status={payment.status}>
      <div className={orderStyles.orderPaymentHistoryMain}>
        <div>
          <strong>{entryLabel}</strong>
          <div className="ui-text-muted">
            {isNoPayment
              ? `Причина: ${getOneTimeOrderPaymentZeroReasonLabel(payment.zeroReason!)}`
              : `${
                  payment.recipient
                    ? getUserDisplayName(payment.recipient)
                    : payment.paymentDestination
                      ? getOneTimeOrderPaymentDestinationLabel(
                          payment.paymentDestination,
                        )
                      : 'Назначение не указано'
                } · ${
                  payment.paymentMethod
                    ? getOneTimeOrderPaymentMethodLabel(payment.paymentMethod)
                    : 'Способ не указан'
                }`}
          </div>
        </div>
        <strong className={orderStyles.orderPaymentHistoryAmount}>
          {isNoPayment
            ? 'Без поступления'
            : `${isReversal ? '−' : '+'}${formatMoney(payment.amount)}`}
        </strong>
      </div>
      <div className="ui-text-muted">
        {isNoPayment
          ? 'Зафиксировано отсутствие фактического поступления; личный подотчёт не создавался'
          : payment.paymentDestination === 'manager_accountability' &&
              payment.amount > 0
            ? isReversal
              ? 'Подотчёт уменьшен сторнированием'
              : payment.correctedFromPaymentId
                ? 'Исправленное поступление в подотчёт создано'
                : 'Поступление в подотчёт создано'
            : 'Сохранено в истории заказа без личного подотчёта'}
      </div>
      {payment.zeroReason && !isNoPayment ? (
        <div className="ui-text-muted">
          Причина нулевой суммы:{' '}
          {getOneTimeOrderPaymentZeroReasonLabel(payment.zeroReason)}
        </div>
      ) : null}
      {payment.differenceReason ? (
        <div className="ui-text-muted">Расхождение: {payment.differenceReason}</div>
      ) : null}
      {payment.comment ? <div>{payment.comment}</div> : null}
      {payment.status === 'reversed' ? (
        <StatusBadge status="rejected">Сторнировано</StatusBadge>
      ) : null}
      {item.capabilities.canCorrectPayments && payment.status === 'active' ? (
        <div className="ui-inline">
          <Button

            onClick={() => setIsCorrecting((current) => !current)}
          >
            Исправить поступление
          </Button>
        </div>
      ) : null}
      {isCorrecting ? (
        <PaymentCorrectionForm
          item={item}
          payment={payment}
          onCancel={() => setIsCorrecting(false)}
          onSubmit={async (payload) => {
            await onCorrectPayment(payment.id, payload);
            setIsCorrecting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PaymentCorrectionForm({
  item,
  payment,
  onCancel,
  onSubmit,
}: {
  item: OneTimeOrderItem;
  payment: VisibleOneTimeOrderCompletionPayment;
  onCancel: () => void;
  onSubmit: (payload: CorrectOneTimeOrderPaymentPayload) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState<PaymentDraft>({
    key: payment.id,
    mode: payment.amount === 0 && payment.zeroReason ? 'no_payment' : 'paid',
    recipientUserId: payment.recipient?.id ?? '',
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod ?? '',
    paymentDestination: payment.paymentDestination ?? '',
    zeroReason: payment.zeroReason ?? '',
    comment: payment.comment ?? '',
  });
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={orderStyles.orderPaymentCorrection}>
      <PaymentFields
        title="Исправленное поступление"
        draft={draft}
        item={item}
        canRemove={false}
        selectedRecipient={payment.recipient}
        onChange={(update) => setDraft((current) => update(current))}
        onRemove={() => undefined}
      />
      <label className={orderStyles.orderCompletionWideField}>
        <span>Причина исправления</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Почему нужно изменить эту запись об оплате"
        />
      </label>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="ui-inline">
        <Button
          disabled={isSaving || !isDraftValid(draft) || !reason.trim()}
          onClick={() => {
            void (async () => {
              setIsSaving(true);
              setError(null);
              try {
                await onSubmit(
                  draft.mode === 'no_payment'
                    ? {
                        correctedAmount: 0,
                        paymentMethod: null,
                        paymentDestination: null,
                        recipientUserId: null,
                        zeroReason: draft.zeroReason || null,
                        comment: draft.comment.trim() || null,
                        reason: reason.trim(),
                      }
                    : {
                        correctedAmount: Number(draft.amount),
                        paymentMethod: draft.paymentMethod || null,
                        paymentDestination: draft.paymentDestination || null,
                        recipientUserId:
                          draft.paymentDestination === 'manager_accountability'
                            ? draft.recipientUserId
                            : null,
                        zeroReason: null,
                        comment: draft.comment.trim() || null,
                        reason: reason.trim(),
                      },
                );
              } catch (saveError) {
                setError(
                  saveError instanceof Error
                    ? saveError.message
                    : 'Не удалось исправить поступление.',
                );
              } finally {
                setIsSaving(false);
              }
            })();
          }}
        >
          {isSaving ? 'Сохраняем...' : 'Сохранить исправление'}
        </Button>
        <Button onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }): React.JSX.Element {
  return (
    <div className="stat-card">
      <div className="ui-detail-label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {detail ? <div className="ui-text-muted">{detail}</div> : null}
    </div>
  );
}
