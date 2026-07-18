'use client';

import React, { useEffect, useState } from 'react';

import type {
  AccountabilityExpenseCategory,
  OneTimeOrderAccountabilityView,
} from '@/entities/accountability/model/accountability.types';
import type { OneTimeOrderCompletion } from '@/entities/one-time-order/model/one-time-order.types';
import {
  getAccountabilityExpenseCategoryLabel,
  getAccountabilityExpenseStatusLabel,
  getAccountabilityFundingTypeLabel,
} from '@/shared/lib/accountability-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

const CATEGORY_OPTIONS: Array<{
  value: AccountabilityExpenseCategory;
  label: string;
}> = [
  { value: 'consumables', label: 'Расходные материалы' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'transport', label: 'Транспорт' },
  { value: 'services', label: 'Услуги' },
  { value: 'other', label: 'Другое' },
];

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

export function OneTimeOrderAccountabilityPanel({
  view,
  completions,
  orderStatus,
  onCreateExpense,
}: {
  view: OneTimeOrderAccountabilityView;
  completions: OneTimeOrderCompletion[];
  orderStatus: string;
  onCreateExpense: (payload: {
    amount: number;
    description: string;
    oneTimeOrderCompletionId: string | null;
    expenseCategory: AccountabilityExpenseCategory;
    expenseDate: string;
    files: File[];
    submitAfterSave: boolean;
  }) => Promise<void>;
}): React.JSX.Element {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseCategory, setExpenseCategory] =
    useState<AccountabilityExpenseCategory>('consumables');
  const [expenseDate, setExpenseDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [completionSelection, setCompletionSelection] = useState('');
  const completionOptionsKey = completions
    .map((completion) => `${completion.id}:${completion.workCycle}`)
    .join('|');

  useEffect(() => {
    if (completions.length > 1) {
      setCompletionSelection('');
      return;
    }

    if (orderStatus === 'completed' && completions.length === 1) {
      setCompletionSelection(completions[0]!.id);
      return;
    }

    setCompletionSelection('order_only');
  }, [completionOptionsKey, completions, orderStatus]);

  const save = async (submitAfterSave: boolean): Promise<void> => {
    const normalizedAmount = Number(amount);
    const normalizedDescription = description.trim();

    if (
      !Number.isFinite(normalizedAmount) ||
      normalizedAmount <= 0 ||
      !normalizedDescription ||
      !expenseDate ||
      !completionSelection ||
      (submitAfterSave && files.length === 0)
    ) {
      return;
    }

    setIsSaving(true);
    try {
      await onCreateExpense({
        amount: normalizedAmount,
        description: normalizedDescription,
        oneTimeOrderCompletionId:
          completionSelection === 'order_only' ? null : completionSelection,
        expenseCategory,
        expenseDate,
        files,
        submitAfterSave,
      });
      setAmount('');
      setDescription('');
      setFiles([]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-card" style={{ display: 'grid', gap: 18 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Подотчет по заказу</div>
          <div className="section-subtitle">
            Поступления и расходы показываются только в разрешенном backend scope.
          </div>
        </div>
        <span className="status-pill">
          {view.visibilityScope === 'administrative'
            ? 'Административный просмотр'
            : 'Мой подотчет'}
        </span>
      </div>

      {view.capabilities.canCreateExpense ? (
        <div className="record-card" style={{ display: 'grid', gap: 14 }}>
          <div>
            <strong>Добавить расход по заказу</strong>
            <div className="page-muted">
              Для отправки на проверку приложите чек или документ.
            </div>
          </div>
          <div className="field-grid">
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Сумма</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Дата расхода</span>
              <input
                type="date"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Категория</span>
              <select
                value={expenseCategory}
                onChange={(event) =>
                  setExpenseCategory(
                    event.target.value as AccountabilityExpenseCategory,
                  )
                }
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {completions.length > 0 ? (
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Цикл заказа</span>
                <select
                  value={completionSelection}
                  onChange={(event) =>
                    setCompletionSelection(event.target.value)
                  }
                >
                  {completions.length > 1 ? (
                    <option value="">Выберите цикл</option>
                  ) : null}
                  {orderStatus !== 'completed' ? (
                    <option value="order_only">
                      Текущий цикл, до завершения
                    </option>
                  ) : null}
                  {completions.map((completion) => (
                    <option key={completion.id} value={completion.id}>
                      Цикл {completion.workCycle}
                      {completion.completionSource === 'legacy_unknown'
                        ? ' · исторический'
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
              <span>Описание</span>
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Кратко опишите расход"
              />
            </label>
          </div>
          <MediaActionPicker
            disabled={isSaving}
            onPick={async (file) => setFiles((current) => [...current, file])}
          />
          <PendingMediaList
            files={files}
            onRemove={(index) =>
              setFiles((current) =>
                current.filter((_, currentIndex) => currentIndex !== index),
              )
            }
            emptyText="Чек или документ еще не приложен."
          />
          <div className="action-row">
            <button
              type="button"
              disabled={isSaving || !completionSelection}
              onClick={() => void save(false)}
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              disabled={
                isSaving || !completionSelection || files.length === 0
              }
              onClick={() => void save(true)}
            >
              Отправить на проверку
            </button>
          </div>
        </div>
      ) : null}

      {view.accounts.length === 0 ? (
        <div className="page-muted">
          Поступлений и расходов по этому заказу пока нет.
        </div>
      ) : (
        <div className="page-stack">
          {view.accounts.map((account) => {
            const confirmedExpenses =
              account.summary.totalApprovedExpenses +
              account.summary.totalReconciledExpenses;
            const submittedAmount = account.expenses
              .filter((expense) => expense.status === 'submitted')
              .reduce((sum, expense) => sum + expense.amount, 0);

            return (
              <div key={account.accountId} className="record-card">
                <div className="section-header">
                  <strong>{getUserDisplayName(account.user)}</strong>
                  <span
                    className="status-pill"
                    data-status={account.accountStatus}
                  >
                    {account.accountStatus}
                  </span>
                </div>
                <div className="stat-grid">
                  <SummaryItem
                    label="Получено"
                    value={formatMoney(account.summary.totalCredits)}
                  />
                  <SummaryItem
                    label="Подтвержденные траты"
                    value={formatMoney(confirmedExpenses)}
                  />
                  <SummaryItem
                    label="Текущий остаток"
                    value={formatMoney(account.summary.currentBalance)}
                  />
                  <SummaryItem
                    label="На подтверждении"
                    value={formatMoney(submittedAmount)}
                  />
                  <SummaryItem
                    label="Прогнозный остаток"
                    value={formatMoney(account.summary.forecastBalance)}
                  />
                </div>

                {account.fundings.length > 0 ? (
                  <div className="record-list local-scroll local-scroll--sm">
                    {account.fundings.map((funding) => (
                      <div key={funding.id} className="detail-field">
                        <div className="detail-value">
                          {funding.entryDirection === 'debit' ? '−' : '+'}
                          {formatMoney(funding.amount)}
                        </div>
                        <div className="detail-label">
                          {getAccountabilityFundingTypeLabel(funding.fundingType)} ·{' '}
                          {new Date(funding.issuedAt).toLocaleString('ru-RU')}
                          {funding.comment ? ` · ${funding.comment}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {account.expenses.length > 0 ? (
                  <div className="record-list local-scroll local-scroll--sm">
                    {account.expenses.map((expense) => (
                      <div key={expense.id} className="detail-field">
                        <div
                          className="section-header"
                          style={{ paddingBottom: 0 }}
                        >
                          <div>
                            <div className="detail-value">
                              {formatMoney(expense.amount)}
                            </div>
                            <div className="detail-label">
                              {getAccountabilityExpenseCategoryLabel(
                                expense.expenseCategory,
                              )}
                              {expense.expenseDate
                                ? ` · ${new Date(`${expense.expenseDate}T00:00:00`).toLocaleDateString('ru-RU')}`
                                : ''}
                              {expense.oneTimeOrderCompletionId
                                ? ` · Цикл ${completions.find((completion) => completion.id === expense.oneTimeOrderCompletionId)?.workCycle ?? 'не найден'}`
                                : ' · Без привязки к циклу'}
                            </div>
                          </div>
                          <span
                            className="status-pill"
                            data-status={expense.status}
                          >
                            {getAccountabilityExpenseStatusLabel(expense.status)}
                          </span>
                        </div>
                        <div>{expense.description}</div>
                        <AttachmentPreviewList
                          files={expense.attachments}
                          emptyText="Документ не приложен."
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="stat-card">
      <div className="detail-label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </div>
  );
}
