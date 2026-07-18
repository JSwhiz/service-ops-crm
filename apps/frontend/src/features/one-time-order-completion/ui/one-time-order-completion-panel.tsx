'use client';

import React, { useMemo, useRef, useState } from 'react';

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
import { ApiError } from '@/shared/api/fetcher';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  getOneTimeOrderPaymentDestinationLabel,
  getOneTimeOrderPaymentMethodLabel,
  getOneTimeOrderPaymentZeroReasonLabel,
} from '@/shared/lib/one-time-order-presentation';

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

interface PaymentDraft {
  key: string;
  recipientUserId: string;
  amount: string;
  paymentMethod: OneTimeOrderPaymentMethod;
  paymentDestination: OneTimeOrderPaymentDestination;
  zeroReason: OneTimeOrderPaymentZeroReason | '';
  comment: string;
}

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function createPaymentDraft(item: OneTimeOrderItem): PaymentDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    recipientUserId: item.managers[0]?.userId ?? '',
    amount: '',
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    zeroReason: '',
    comment: '',
  };
}

function normalizeMethodChange(
  draft: PaymentDraft,
  method: OneTimeOrderPaymentMethod,
  item: OneTimeOrderItem,
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
      recipientUserId:
        draft.recipientUserId || item.managers[0]?.userId || '',
    };
  }

  return { ...draft, paymentMethod: method };
}

function isDraftValid(draft: PaymentDraft): boolean {
  const amount = Number(draft.amount);

  return (
    draft.amount.trim() !== '' &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    (draft.paymentDestination !== 'manager_accountability' ||
      Boolean(draft.recipientUserId)) &&
    (amount !== 0 || Boolean(draft.zeroReason)) &&
    (draft.paymentMethod !== 'other' || Boolean(draft.comment.trim()))
  );
}

export function OneTimeOrderCompletionPanel({
  item,
  completions,
  onComplete,
  onReopen,
  onCorrectPayment,
}: {
  item: OneTimeOrderItem;
  completions: OneTimeOrderCompletion[];
  onComplete: (payload: CompleteOneTimeOrderPayload) => Promise<void>;
  onReopen: () => Promise<void>;
  onCorrectPayment: (
    paymentId: string,
    payload: CorrectOneTimeOrderPaymentPayload,
  ) => Promise<void>;
}): React.JSX.Element {
  const [payments, setPayments] = useState<PaymentDraft[]>([
    createPaymentDraft(item),
  ]);
  const [completionComment, setCompletionComment] = useState('');
  const [differenceReason, setDifferenceReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [serverRequiresDifferenceReason, setServerRequiresDifferenceReason] =
    useState(false);
  const inFlightRef = useRef(false);
  const retryRequestRef = useRef<{
    fingerprint: string;
    payload: CompleteOneTimeOrderPayload;
  } | null>(null);

  const previousActual = useMemo(
    () =>
      completions.reduce(
        (sum, completion) => sum + completion.visibleTotalAmount,
        0,
      ),
    [completions],
  );
  const currentActual = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const cumulativeActual = previousActual + currentActual;
  const fullPreviousTotalVisible = completions.every(
    (completion) => completion.fullTotalAmountVisible,
  );
  const hasEnteredAmounts = payments.every(
    (payment) => payment.amount.trim() !== '',
  );
  const hasDifference =
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
    setPayments((current) =>
      current.map((payment) =>
        payment.key === key ? update(payment) : payment,
      ),
    );
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
      payments: payments.map((payment, index) => ({
        recipientUserId:
          payment.paymentDestination === 'manager_accountability'
            ? payment.recipientUserId
            : null,
        amount: Number(payment.amount),
        paymentMethod: payment.paymentMethod,
        paymentDestination: payment.paymentDestination,
        zeroReason: payment.zeroReason || null,
        comment: payment.comment.trim() || null,
        differenceReason:
          index === 0 && needsDifferenceReason
            ? differenceReason.trim()
            : null,
      })),
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
      await onComplete(requestPayload);
      retryRequestRef.current = null;
      setPayments([createPaymentDraft(item)]);
      setCompletionComment('');
      setDifferenceReason('');
      setServerRequiresDifferenceReason(false);
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
        saveError instanceof Error
          ? saveError.message
          : 'Не удалось завершить заказ.',
      );
      setCanRetry(true);
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <section className="page-card order-completion-panel">
      <div className="section-header">
        <div>
          <div className="section-title">Завершение и фактические оплаты</div>
          <div className="section-subtitle">
            Каждый цикл и каждое поступление сохраняются в финансовой истории.
          </div>
        </div>
        <span className="status-pill">Цикл {item.workCycle}</span>
      </div>

      <div className="order-completion-summary">
        <Summary label="Согласованная сумма" value={item.agreedSum === null ? 'Не указана' : formatMoney(item.agreedSum)} />
        <Summary label="Получено в предыдущих циклах" value={formatMoney(previousActual)} />
        <Summary label="Текущий цикл" value={`Цикл ${item.workCycle}`} />
      </div>

      {!fullPreviousTotalVisible ? (
        <div className="page-muted">
          Часть предыдущих поступлений скрыта. Итоговая сумма будет проверена
          сервером.
        </div>
      ) : null}

      {item.capabilities.canComplete ? (
        <div className="order-completion-form">
          {payments.map((payment, index) => (
            <PaymentFields
              key={payment.key}
              title={`Получение №${index + 1}`}
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

          <button
            type="button"
            className="button-quiet"
            onClick={() =>
              setPayments((current) => [...current, createPaymentDraft(item)])
            }
          >
            Добавить еще получателя
          </button>

          <label className="order-completion-wide-field">
            <span>Комментарий к завершению</span>
            <textarea
              rows={3}
              value={completionComment}
              onChange={(event) => setCompletionComment(event.target.value)}
              placeholder="Например, повторная поездка или дополнительная услуга"
            />
          </label>

          {needsDifferenceReason ? (
            <div className="order-completion-warning">
              <strong>Комментарий к расхождению общей суммы</strong>
              {fullPreviousTotalVisible ? (
                <div>
                  После этого цикла: {formatMoney(cumulativeActual)}. Укажите причину
                  расхождения.
                </div>
              ) : (
                <div>
                  Сервер обнаружил расхождение с согласованной суммой без раскрытия
                  скрытых поступлений.
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

          {error ? <div className="form-error">{error}</div> : null}
          <div className="action-row">
            <button
              type="button"
              disabled={isSaving || !canSubmit}
              onClick={() => void submit()}
            >
              {isSaving
                ? 'Завершаем...'
                : canRetry
                  ? 'Повторить завершение'
                  : 'Завершить заказ'}
            </button>
          </div>
        </div>
      ) : item.capabilities.canReopen ? (
        <div className="order-completion-closed-state">
          <div>
            <strong>Текущий цикл завершен.</strong>
            <div className="page-muted">
              Для повторной поездки откройте новый цикл. Старые поступления сохранятся.
            </div>
          </div>
          <button
            type="button"
            disabled={isReopening}
            onClick={() => {
              void (async () => {
                setIsReopening(true);
                setError(null);
                try {
                  await onReopen();
                } catch (reopenError) {
                  setError(
                    reopenError instanceof Error
                      ? reopenError.message
                      : 'Не удалось переоткрыть заказ.',
                  );
                } finally {
                  setIsReopening(false);
                }
              })();
            }}
          >
            {isReopening ? 'Открываем...' : 'Открыть новый цикл'}
          </button>
        </div>
      ) : null}

      {error && !item.capabilities.canComplete ? (
        <div className="form-error">{error}</div>
      ) : null}

      <CompletionHistory
        item={item}
        completions={completions}
        onCorrectPayment={onCorrectPayment}
      />
    </section>
  );
}

function PaymentFields({
  title,
  draft,
  item,
  canRemove,
  onChange,
  onRemove,
}: {
  title: string;
  draft: PaymentDraft;
  item: OneTimeOrderItem;
  canRemove: boolean;
  onChange: (update: (draft: PaymentDraft) => PaymentDraft) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const amount = Number(draft.amount);
  const isZero = draft.amount !== '' && Number.isFinite(amount) && amount === 0;

  return (
    <div className="order-payment-card">
      <div className="section-header">
        <strong>{title}</strong>
        {canRemove ? (
          <button type="button" className="button-quiet" onClick={onRemove}>
            Убрать
          </button>
        ) : null}
      </div>
      <div className="field-grid">
        {draft.paymentDestination === 'manager_accountability' ? (
          <label>
            <span>Кто получил</span>
            <select
              value={draft.recipientUserId}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  recipientUserId: event.target.value,
                }))
              }
            >
              <option value="">Выберите менеджера</option>
              {item.managers.map((manager) => (
                <option key={manager.userId} value={manager.userId}>
                  {manager.fullName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label>
          <span>Способ</span>
          <select
            value={draft.paymentMethod}
            onChange={(event) =>
              onChange((current) =>
                normalizeMethodChange(
                  current,
                  event.target.value as OneTimeOrderPaymentMethod,
                  item,
                ),
              )
            }
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {getOneTimeOrderPaymentMethodLabel(method)}
              </option>
            ))}
          </select>
        </label>

        {draft.paymentMethod === 'other' ? (
          <label>
            <span>Назначение денег</span>
            <select
              value={draft.paymentDestination}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  paymentDestination: event.target
                    .value as OneTimeOrderPaymentDestination,
                  recipientUserId:
                    event.target.value === 'organization'
                      ? ''
                      : current.recipientUserId ||
                        item.managers[0]?.userId ||
                        '',
                }))
              }
            >
              <option value="manager_accountability">Личный подотчет менеджера</option>
              <option value="organization">Организация</option>
            </select>
          </label>
        ) : null}

        <label>
          <span>Фактически получено</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.amount}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                amount: event.target.value,
                zeroReason: Number(event.target.value) === 0
                  ? current.zeroReason
                  : '',
              }))
            }
            placeholder="0.00"
          />
        </label>

        {isZero ? (
          <label>
            <span>Причина нулевой суммы</span>
            <select
              value={draft.zeroReason}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  zeroReason: event.target
                    .value as OneTimeOrderPaymentZeroReason,
                }))
              }
            >
              <option value="">Выберите причину</option>
              {ZERO_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {getOneTimeOrderPaymentZeroReasonLabel(reason)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="order-completion-wide-field">
          <span>Комментарий</span>
          <input
            value={draft.comment}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                comment: event.target.value,
              }))
            }
            placeholder={draft.paymentMethod === 'other' ? 'Обязательный комментарий' : 'Необязательно'}
          />
        </label>
      </div>

      {draft.paymentDestination === 'organization' ? (
        <div className="order-payment-note">
          Сумма сохранится в финансовой истории заказа, но не попадет в личный
          подотчет менеджера.
        </div>
      ) : null}
    </div>
  );
}

function CompletionHistory({
  item,
  completions,
  onCorrectPayment,
}: {
  item: OneTimeOrderItem;
  completions: OneTimeOrderCompletion[];
  onCorrectPayment: (
    paymentId: string,
    payload: CorrectOneTimeOrderPaymentPayload,
  ) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="order-completion-history">
      <div>
        <div className="section-title">История циклов</div>
        <div className="section-subtitle">
          Исходные поступления, сторнирования и исправленные записи не удаляются.
        </div>
      </div>
      {completions.length === 0 ? (
        <div className="page-muted">
          {item.status === 'completed'
            ? 'Заказ был завершен до введения истории циклов. Точная дата и пользователь завершения отсутствуют.'
            : 'Завершенных циклов пока нет.'}
        </div>
      ) : (
        <div className="record-list local-scroll local-scroll--lg">
          {completions.map((completion) => (
            <div key={completion.id} className="order-completion-cycle">
              <div className="section-header">
                <div>
                  <strong>Цикл {completion.workCycle}</strong>
                  <div className="page-muted">
                    {completion.completionSource === 'legacy_unknown' ||
                    !completion.completedAt ||
                    !completion.completedBy
                      ? 'Историческое завершение: точная дата и пользователь отсутствуют'
                      : `${new Date(completion.completedAt).toLocaleString('ru-RU')} · ${getUserDisplayName(completion.completedBy)}`}
                  </div>
                </div>
                <span className="status-pill" data-status={completion.status}>
                  {completion.status === 'active' ? 'Текущий' : 'Завершен'}
                </span>
              </div>
              {completion.completionComment ? (
                <div>{completion.completionComment}</div>
              ) : null}
              <div className="order-payment-history-list">
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
      <div className="order-payment-history-row" data-payment-status="restricted">
        <div className="page-muted">
          Финансовые сведения доступны только получателю и ответственному за
          подотчет.
        </div>
      </div>
    );
  }

  const isReversal = payment.status === 'reversal';
  const entryLabel = isReversal
    ? 'Сторнирование'
    : payment.correctedFromPaymentId
      ? 'Исправленное поступление'
      : 'Поступление';

  return (
    <div className="order-payment-history-row" data-payment-status={payment.status}>
      <div className="order-payment-history-main">
        <div>
          <strong>{entryLabel}</strong>
          <div className="page-muted">
            {payment.recipient
              ? getUserDisplayName(payment.recipient)
              : getOneTimeOrderPaymentDestinationLabel(payment.paymentDestination)}
            {' · '}
            {getOneTimeOrderPaymentMethodLabel(payment.paymentMethod)}
          </div>
        </div>
        <strong className="order-payment-history-amount">
          {isReversal ? '−' : '+'}{formatMoney(payment.amount)}
        </strong>
      </div>
      <div className="page-muted">
        {payment.paymentDestination === 'manager_accountability' &&
        payment.amount > 0
          ? isReversal
            ? 'Подотчет уменьшен сторнированием'
            : payment.correctedFromPaymentId
              ? 'Исправленное поступление в подотчет создано'
              : 'Поступление в подотчет создано'
          : 'Сохранено в истории заказа без личного подотчета'}
      </div>
      {payment.zeroReason ? (
        <div className="page-muted">
          Причина нулевой суммы:{' '}
          {getOneTimeOrderPaymentZeroReasonLabel(payment.zeroReason)}
        </div>
      ) : null}
      {payment.differenceReason ? (
        <div className="page-muted">Расхождение: {payment.differenceReason}</div>
      ) : null}
      {payment.comment ? <div>{payment.comment}</div> : null}
      {payment.status === 'reversed' ? (
        <span className="status-pill" data-status="rejected">Сторнировано</span>
      ) : null}
      {item.capabilities.canCorrectPayments && payment.status === 'active' ? (
        <div className="action-row">
          <button
            type="button"
            className="button-quiet"
            onClick={() => setIsCorrecting((current) => !current)}
          >
            Исправить поступление
          </button>
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
    recipientUserId: payment.recipient?.id ?? '',
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod,
    paymentDestination: payment.paymentDestination,
    zeroReason: payment.zeroReason ?? '',
    comment: payment.comment ?? '',
  });
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="order-payment-correction">
      <PaymentFields
        title="Исправленное поступление"
        draft={draft}
        item={item}
        canRemove={false}
        onChange={(update) => setDraft((current) => update(current))}
        onRemove={() => undefined}
      />
      <label className="order-completion-wide-field">
        <span>Причина исправления</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Обязательное основание для сторнирования"
        />
      </label>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="action-row">
        <button
          type="button"
          disabled={isSaving || !isDraftValid(draft) || !reason.trim()}
          onClick={() => {
            void (async () => {
              setIsSaving(true);
              setError(null);
              try {
                await onSubmit({
                  correctedAmount: Number(draft.amount),
                  paymentMethod: draft.paymentMethod,
                  paymentDestination: draft.paymentDestination,
                  recipientUserId:
                    draft.paymentDestination === 'manager_accountability'
                      ? draft.recipientUserId
                      : null,
                  zeroReason: draft.zeroReason || null,
                  comment: draft.comment.trim() || null,
                  reason: reason.trim(),
                });
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
          {isSaving ? 'Сохраняем...' : 'Сторнировать и записать исправление'}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="stat-card">
      <div className="detail-label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </div>
  );
}
