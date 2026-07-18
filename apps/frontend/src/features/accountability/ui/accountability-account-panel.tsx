'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

import type {
  AccountabilityAccountView,
  AccountabilityClosureItem,
  AccountabilityExpenseItem,
} from '@/entities/accountability/model/accountability.types';
import {
  getAccountabilityAccountStatusLabel,
  getAccountabilityClosureStatusLabel,
  getAccountabilityExpenseCategoryLabel,
  getAccountabilityExpenseStatusLabel,
  getAccountabilityFundingTypeLabel,
} from '@/shared/lib/accountability-presentation';
import { getUserDisplayName, getUserSecondaryLabel } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

import { AccountabilityExpenseForm } from './accountability-expense-form';

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

export function AccountabilityAccountPanel({
  title,
  view,
  isOwnView,
  onSaveExpense,
  onSubmitExpense,
  onApproveExpense,
  onRejectExpense,
  onRequestClosure,
}: {
  title: string;
  view: AccountabilityAccountView;
  isOwnView: boolean;
  onSaveExpense: (payload: {
    expenseId?: string;
    amount: number;
    description: string;
    files: File[];
    submitAfterSave: boolean;
  }) => Promise<void>;
  onSubmitExpense: (expenseId: string) => Promise<void>;
  onApproveExpense: (expenseId: string) => Promise<void>;
  onRejectExpense: (expenseId: string, comment: string) => Promise<void>;
  onRequestClosure: () => Promise<void>;
}): React.JSX.Element {
  const [editingExpense, setEditingExpense] =
    useState<AccountabilityExpenseItem | null>(null);
  const [rejectingExpenseId, setRejectingExpenseId] = useState<string | null>(
    null,
  );
  const [expenseRejectComment, setExpenseRejectComment] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const latestClosure = view.closures[0] ?? null;

  const orderIds = useMemo(
    () =>
      [...new Set(
        [...view.fundings, ...view.expenses]
          .map((entry) => entry.oneTimeOrderId)
          .filter((id): id is string => Boolean(id)),
      )],
    [view.expenses, view.fundings],
  );
  const activeOrderFilter = orderIds.includes(orderFilter) ? orderFilter : '';
  const isWithinDates = (value: string): boolean => {
    const date = value.slice(0, 10);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  };
  const filteredFundings = useMemo(
    () =>
      view.fundings.filter(
        (funding) =>
          (!activeOrderFilter ||
            funding.oneTimeOrderId === activeOrderFilter) &&
          isWithinDates(funding.issuedAt),
      ),
    [activeOrderFilter, dateFrom, dateTo, view.fundings],
  );
  const filteredExpenses = useMemo(
    () =>
      view.expenses.filter(
        (expense) =>
          (!activeOrderFilter ||
            expense.oneTimeOrderId === activeOrderFilter) &&
          isWithinDates(expense.expenseDate ?? expense.createdAt),
      ),
    [activeOrderFilter, dateFrom, dateTo, view.expenses],
  );
  const submittedAmount = useMemo(
    () =>
      view.expenses
        .filter((expense) => expense.status === 'submitted')
        .reduce((sum, expense) => sum + expense.amount, 0),
    [view.expenses],
  );

  const summaryCards = useMemo(
    () => [
      { label: 'Текущий остаток', value: formatMoney(view.summary.currentBalance) },
      { label: 'Прогнозный остаток', value: formatMoney(view.summary.forecastBalance) },
      { label: 'На подтверждении', value: formatMoney(submittedAmount) },
      { label: 'Выдано всего', value: formatMoney(view.summary.totalFunding) },
      {
        label: 'Занесено расходов',
        value: formatMoney(view.summary.totalRecordedExpenses),
      },
      {
        label: 'Подтверждено',
        value: formatMoney(view.summary.totalApprovedExpenses),
      },
      {
        label: 'Отклонено',
        value: formatMoney(view.summary.totalRejectedExpenses),
      },
      {
        label: 'Сверено',
        value: formatMoney(view.summary.totalReconciledExpenses),
      },
    ],
    [submittedAmount, view.summary],
  );

  return (
    <div className="page-stack">
      <div className="page-card hero-card" style={{ display: 'grid', gap: 18 }}>
        <div className="section-header">
          <div>
            <div className="hero-title">{title}</div>
            <div className="hero-meta">
              {[getUserDisplayName(view.account.user), getUserSecondaryLabel(view.account.user)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <span
            className="status-pill"
            data-status={view.account.status ?? 'archived'}
          >
            {getAccountabilityAccountStatusLabel(view.account.status)}
          </span>
        </div>

        {view.account.status === 'closing_requested' ? (
          <div className="record-card" style={{ background: '#fffbeb' }}>
            Новые расходы и новые выдачи денег временно заблокированы, пока идет
            сверка.
          </div>
        ) : null}

        {view.account.id ? null : (
          <div className="page-muted">
            Активный подотчетный контур для пользователя еще не открыт.
          </div>
        )}

        <div className="stat-grid">
          {summaryCards.map((card) => (
            <div key={card.label} className="stat-card">
              <div className="detail-label">{card.label}</div>
              <div className="stat-card__value">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="detail-grid">
          <div className="detail-field">
            <div className="detail-label">Draft расходов</div>
            <div className="detail-value">{view.summary.draftExpensesCount}</div>
          </div>
          <div className="detail-field">
            <div className="detail-label">Submitted расходов</div>
            <div className="detail-value">
              {view.summary.submittedExpensesCount}
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-label">Последняя сверка</div>
            <div className="detail-value">
              {latestClosure
                ? getAccountabilityClosureStatusLabel(latestClosure.status)
                : 'Сверки еще не было'}
            </div>
          </div>
        </div>

        {isOwnView && view.capabilities.canRequestClosure ? (
          <div className="action-row">
            <button
              type="button"
              onClick={() => {
                void onRequestClosure();
              }}
            >
              Отправить на сверку
            </button>
          </div>
        ) : null}
      </div>

      {isOwnView ? (
        <AccountabilityExpenseForm
          initialExpense={editingExpense}
          canCreate={view.capabilities.canCreateExpense || Boolean(editingExpense)}
          onSave={async (payload) => {
            await onSaveExpense(payload);
            setEditingExpense(null);
          }}
          onCancelEdit={() => {
            setEditingExpense(null);
          }}
        />
      ) : null}

      {view.fundings.length > 0 || view.expenses.length > 0 ? (
        <div className="page-card page-card--subtle accountability-ledger-filters">
          <div>
            <div className="section-title">Фильтры финансовой истории</div>
            <div className="section-subtitle">
              Отбор применяется к поступлениям и расходам ниже.
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>Разовый заказ</span>
              <select
                value={activeOrderFilter}
                onChange={(event) => setOrderFilter(event.target.value)}
              >
                <option value="">Все заказы и ручные операции</option>
                {orderIds.map((orderId) => (
                  <option key={orderId} value={orderId}>
                    Разовый заказ · {orderId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Дата с</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              <span>Дата по</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="page-card" style={{ display: 'grid', gap: 16 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Выдачи денег</div>
            <div className="section-subtitle">
              Пополнения подотчетного контура пользователя.
            </div>
          </div>
        </div>

        {filteredFundings.length === 0 ? (
          <div className="page-muted">По выбранным фильтрам поступлений нет.</div>
        ) : (
          <div className="record-list local-scroll local-scroll--sm">
            {filteredFundings.map((funding) => (
              <div key={funding.id} className="record-card">
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div>
                    <strong>
                      {funding.entryDirection === 'debit' ? '−' : '+'}
                      {formatMoney(funding.amount)}
                    </strong>
                    <div className="page-muted">
                      {getAccountabilityFundingTypeLabel(funding.fundingType)}
                    </div>
                  </div>
                  <div className="page-muted">
                    {new Date(funding.issuedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="page-muted" style={{ marginTop: 6 }}>
                  Зафиксировал: {getUserDisplayName(funding.recordedBy ?? funding.issuedBy)}
                  {funding.oneTimeOrderId
                    ? ` · заказ ${funding.oneTimeOrderId.slice(0, 8)}`
                    : ''}
                </div>
                {funding.comment ? (
                  <div style={{ marginTop: 8 }}>{funding.comment}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="page-card" style={{ display: 'grid', gap: 16 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Расходы</div>
            <div className="section-subtitle">
              Draft редактирует только владелец. Submitted решает reviewer.
            </div>
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="page-muted">По выбранным фильтрам расходов нет.</div>
        ) : (
          <div className="record-list local-scroll local-scroll--lg">
            {filteredExpenses.map((expense) => (
              <div key={expense.id} className="record-card" style={{ display: 'grid', gap: 10 }}>
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong>{formatMoney(expense.amount)}</strong>
                    <div className="page-muted">
                      {expense.expenseDate
                        ? new Date(`${expense.expenseDate}T00:00:00`).toLocaleDateString('ru-RU')
                        : new Date(expense.createdAt).toLocaleString('ru-RU')}{' '}
                      · {getAccountabilityExpenseCategoryLabel(expense.expenseCategory)} ·{' '}
                      {getUserDisplayName(expense.createdBy)}
                      {expense.oneTimeOrderId
                        ? ` · заказ ${expense.oneTimeOrderId.slice(0, 8)}`
                        : ''}
                    </div>
                  </div>
                  <span
                    className="status-pill"
                    data-status={expense.status}
                  >
                    {getAccountabilityExpenseStatusLabel(expense.status)}
                  </span>
                </div>

                <div style={{ whiteSpace: 'pre-wrap' }}>{expense.description}</div>

                {expense.rejectionComment ? (
                  <div className="record-card" style={{ background: '#fef2f2' }}>
                    Причина отклонения: {expense.rejectionComment}
                  </div>
                ) : null}

                <AttachmentPreviewList
                  files={expense.attachments}
                  emptyText="Вложения к расходу не приложены."
                />

                <div className="action-row">
                  {expense.capabilities.canEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExpense(expense);
                      }}
                    >
                      Редактировать
                    </button>
                  ) : null}

                  {expense.capabilities.canSubmit ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onSubmitExpense(expense.id);
                      }}
                    >
                      Отправить
                    </button>
                  ) : null}

                  {expense.capabilities.canApprove ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onApproveExpense(expense.id);
                      }}
                    >
                      Подтвердить
                    </button>
                  ) : null}

                  {expense.capabilities.canReject ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingExpenseId(expense.id);
                        setExpenseRejectComment('');
                      }}
                    >
                      Отклонить
                    </button>
                  ) : null}
                </div>

                {rejectingExpenseId === expense.id ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <textarea
                      rows={3}
                      value={expenseRejectComment}
                      onChange={(event) =>
                        setExpenseRejectComment(event.target.value)
                      }
                      placeholder="Укажите причину отклонения"
                    />
                    <div className="action-row">
                      <button
                        type="button"
                        onClick={() => {
                          void onRejectExpense(expense.id, expenseRejectComment).finally(
                            () => {
                              setRejectingExpenseId(null);
                              setExpenseRejectComment('');
                            },
                          );
                        }}
                      >
                        Подтвердить отклонение
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingExpenseId(null);
                          setExpenseRejectComment('');
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="page-card" style={{ display: 'grid', gap: 16 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Сверка и закрытие</div>
            <div className="section-subtitle">
              Closure attempts хранятся отдельно и не теряют историю.
            </div>
          </div>
        </div>

        {view.closures.length === 0 ? (
          <div className="page-muted">Попыток сверки пока не было.</div>
        ) : (
          <div className="record-list local-scroll local-scroll--sm">
            {view.closures.map((closure) => (
              <ClosureCard key={closure.id} closure={closure} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClosureCard({
  closure,
}: {
  closure: AccountabilityClosureItem;
}): React.JSX.Element {
  return (
    <div className="record-card" style={{ display: 'grid', gap: 10 }}>
      <div className="section-header" style={{ paddingBottom: 0 }}>
        <div>
          <strong>
            {new Date(closure.requestedAt).toLocaleString('ru-RU')}
          </strong>
          <div className="page-muted">
            Запросил: {getUserDisplayName(closure.requestedBy)}
          </div>
        </div>
        <span className="status-pill" data-status={closure.status}>
          {getAccountabilityClosureStatusLabel(closure.status)}
        </span>
      </div>

      {closure.comment ? <div>{closure.comment}</div> : null}

      <div className="page-muted">
        {closure.approvedBy
          ? `Подтвердил: ${getUserDisplayName(closure.approvedBy)}`
          : closure.rejectedBy
            ? `Отклонил: ${getUserDisplayName(closure.rejectedBy)}`
            : 'Ожидает решения руководства'}
      </div>

      <div className="action-row">
        <Link
          href={`/approvals?sourceEntityType=accountability_closure&sourceEntityId=${closure.id}`}
        >
          Открыть согласование
        </Link>
      </div>
    </div>
  );
}
