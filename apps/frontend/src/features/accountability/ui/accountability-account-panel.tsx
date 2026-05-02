'use client';

import React, { useMemo, useState } from 'react';

import type {
  AccountabilityAccountView,
  AccountabilityClosureItem,
  AccountabilityExpenseItem,
} from '@/entities/accountability/model/accountability.types';
import {
  getAccountabilityAccountStatusLabel,
  getAccountabilityClosureStatusLabel,
  getAccountabilityExpenseStatusLabel,
} from '@/shared/lib/accountability-presentation';
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
  onApproveClosure,
  onRejectClosure,
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
  onApproveClosure: (closureId: string) => Promise<void>;
  onRejectClosure: (closureId: string, comment: string) => Promise<void>;
}): React.JSX.Element {
  const [editingExpense, setEditingExpense] =
    useState<AccountabilityExpenseItem | null>(null);
  const [rejectingExpenseId, setRejectingExpenseId] = useState<string | null>(
    null,
  );
  const [expenseRejectComment, setExpenseRejectComment] = useState('');
  const [rejectingClosureId, setRejectingClosureId] = useState<string | null>(
    null,
  );
  const [closureRejectComment, setClosureRejectComment] = useState('');
  const latestClosure = view.closures[0] ?? null;

  const summaryCards = useMemo(
    () => [
      { label: 'Текущий остаток', value: formatMoney(view.summary.currentBalance) },
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
    [view.summary],
  );

  return (
    <div className="page-stack">
      <div className="page-card hero-card" style={{ display: 'grid', gap: 18 }}>
        <div className="section-header">
          <div>
            <div className="hero-title">{title}</div>
            <div className="hero-meta">
              {view.account.user.fullName} · {view.account.user.login}
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

      <div className="page-card" style={{ display: 'grid', gap: 16 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Выдачи денег</div>
            <div className="section-subtitle">
              Пополнения подотчетного контура пользователя.
            </div>
          </div>
        </div>

        {view.fundings.length === 0 ? (
          <div className="page-muted">Выдач денег пока нет.</div>
        ) : (
          <div className="record-list local-scroll local-scroll--sm">
            {view.fundings.map((funding) => (
              <div key={funding.id} className="record-card">
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <strong>{formatMoney(funding.amount)}</strong>
                  <div className="page-muted">
                    {new Date(funding.issuedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="page-muted" style={{ marginTop: 6 }}>
                  Выдал: {funding.issuedBy.fullName}
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

        {view.expenses.length === 0 ? (
          <div className="page-muted">Расходов пока нет.</div>
        ) : (
          <div className="record-list local-scroll local-scroll--lg">
            {view.expenses.map((expense) => (
              <div key={expense.id} className="record-card" style={{ display: 'grid', gap: 10 }}>
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong>{formatMoney(expense.amount)}</strong>
                    <div className="page-muted">
                      {new Date(expense.createdAt).toLocaleString('ru-RU')} ·{' '}
                      {expense.createdBy.fullName}
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
              <ClosureCard
                key={closure.id}
                closure={closure}
                rejectingClosureId={rejectingClosureId}
                closureRejectComment={closureRejectComment}
                onChangeRejectComment={setClosureRejectComment}
                onStartReject={(item) => {
                  setRejectingClosureId(item.id);
                  setClosureRejectComment('');
                }}
                onCancelReject={() => {
                  setRejectingClosureId(null);
                  setClosureRejectComment('');
                }}
                onApproveClosure={onApproveClosure}
                onRejectClosure={onRejectClosure}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClosureCard({
  closure,
  rejectingClosureId,
  closureRejectComment,
  onChangeRejectComment,
  onStartReject,
  onCancelReject,
  onApproveClosure,
  onRejectClosure,
}: {
  closure: AccountabilityClosureItem;
  rejectingClosureId: string | null;
  closureRejectComment: string;
  onChangeRejectComment: (value: string) => void;
  onStartReject: (item: AccountabilityClosureItem) => void;
  onCancelReject: () => void;
  onApproveClosure: (closureId: string) => Promise<void>;
  onRejectClosure: (closureId: string, comment: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="record-card" style={{ display: 'grid', gap: 10 }}>
      <div className="section-header" style={{ paddingBottom: 0 }}>
        <div>
          <strong>
            {new Date(closure.requestedAt).toLocaleString('ru-RU')}
          </strong>
          <div className="page-muted">
            Запросил: {closure.requestedBy.fullName}
          </div>
        </div>
        <span className="status-pill" data-status={closure.status}>
          {getAccountabilityClosureStatusLabel(closure.status)}
        </span>
      </div>

      {closure.comment ? <div>{closure.comment}</div> : null}

      <div className="page-muted">
        {closure.approvedBy
          ? `Подтвердил: ${closure.approvedBy.fullName}`
          : closure.rejectedBy
            ? `Отклонил: ${closure.rejectedBy.fullName}`
            : 'Ожидает решения руководства'}
      </div>

      <div className="action-row">
        {closure.capabilities.canApprove ? (
          <button
            type="button"
            onClick={() => {
              void onApproveClosure(closure.id);
            }}
          >
            Подтвердить сверку
          </button>
        ) : null}

        {closure.capabilities.canReject ? (
          <button
            type="button"
            onClick={() => {
              onStartReject(closure);
            }}
          >
            Отклонить сверку
          </button>
        ) : null}
      </div>

      {rejectingClosureId === closure.id ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <textarea
            rows={3}
            value={closureRejectComment}
            onChange={(event) => onChangeRejectComment(event.target.value)}
            placeholder="Укажите причину отклонения сверки"
          />
          <div className="action-row">
            <button
              type="button"
              onClick={() => {
                void onRejectClosure(closure.id, closureRejectComment).finally(
                  onCancelReject,
                );
              }}
            >
              Подтвердить отклонение
            </button>
            <button type="button" onClick={onCancelReject}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
