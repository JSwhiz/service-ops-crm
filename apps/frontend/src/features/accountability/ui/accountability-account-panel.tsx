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
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import type { ActiveRegistryFilter, AvailableRegistryFilter } from '@/shared/ui/registry-filters/registry-toolbar';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';

import { AccountabilityExpenseForm } from './accountability-expense-form';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Button, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';

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
  section,
  onSectionChange,
  movementContent,
  idPrefix,
  onSaveExpense,
  onSubmitExpense,
  onApproveExpense,
  onRejectExpense,
  onRequestClosure,
  onReverseExternalReceipt,
}: {
  title: string;
  view: AccountabilityAccountView;
  isOwnView: boolean;
  section: 'overview' | 'movements' | 'expenses' | 'reconciliation';
  onSectionChange: (section: 'overview' | 'movements' | 'expenses' | 'reconciliation') => void;
  movementContent?: React.ReactNode;
  idPrefix: string;
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
  onReverseExternalReceipt: (fundingId: string, reason: string) => Promise<void>;
}): React.JSX.Element {
  const [editingExpense, setEditingExpense] =
    useState<AccountabilityExpenseItem | null>(null);
  const [rejectingExpenseId, setRejectingExpenseId] = useState<string | null>(
    null,
  );
  const [expenseRejectComment, setExpenseRejectComment] = useState('');
  const [reversingFundingId, setReversingFundingId] = useState<string | null>(null);
  const [fundingReversalReason, setFundingReversalReason] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodFilterActive, setPeriodFilterActive] = useState(false);
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
  const orderFilterOptions = orderIds.map((orderId) => ({
    value: orderId,
    label: `Разовый заказ · ${orderId.slice(0, 8)}`,
  }));
  const activeLedgerFilters = ([
    activeOrderFilter ? {
      id: 'order',
      label: 'Разовый заказ',
      value: activeOrderFilter,
      options: orderFilterOptions,
      onChange: setOrderFilter,
      onRemove: () => setOrderFilter(''),
    } : null,
    periodFilterActive ? {
      id: 'period',
      label: 'Период',
      value: dateFrom || dateTo ? `${dateFrom || '…'} — ${dateTo || '…'}` : 'Любые даты',
      options: [],
      onChange: () => undefined,
      onRemove: () => {
        setDateFrom('');
        setDateTo('');
        setPeriodFilterActive(false);
      },
      customControl: (
        <div className="registry-date-range">
          <DatePicker aria-label="Дата с" max={dateTo || undefined} value={dateFrom} onChange={(nextValue) => setDateFrom(nextValue)} />
          <span>—</span>
          <DatePicker aria-label="Дата по" min={dateFrom || undefined} value={dateTo} onChange={(nextValue) => setDateTo(nextValue)} />
        </div>
      ),
    } : null,
  ].filter(Boolean) as ActiveRegistryFilter[]);
  const availableLedgerFilters = ([
    !activeOrderFilter && orderFilterOptions.length > 0 ? {
      id: 'order',
      label: 'Разовый заказ',
      options: orderFilterOptions,
      onAdd: setOrderFilter,
    } : null,
    !periodFilterActive ? {
      id: 'period',
      label: 'Период',
      options: [{ value: 'period', label: 'Выбрать даты' }],
      onAdd: () => setPeriodFilterActive(true),
    } : null,
  ].filter(Boolean) as AvailableRegistryFilter[]);
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

  const overviewCards = useMemo(
    () => [
      { label: 'Текущий остаток', value: formatMoney(view.summary.currentBalance) },
      { label: 'Прогнозный остаток', value: formatMoney(view.summary.forecastBalance) },
      { label: 'На подтверждении', value: formatMoney(submittedAmount) },
    ],
    [submittedAmount, view.summary],
  );
  const accountSections = useMemo(
    () => [
      { value: 'overview', label: 'Обзор' },
      { value: 'movements', label: 'Движения' },
      ...(!isOwnView || view.capabilities.canCreateExpense || view.expenses.length > 0
        ? [{ value: 'expenses', label: 'Расходы' }]
        : []),
      ...(!isOwnView || view.capabilities.canRequestClosure || view.closures.length > 0
        ? [{ value: 'reconciliation', label: 'Сверка и закрытие' }]
        : []),
    ],
    [isOwnView, view.capabilities.canCreateExpense, view.capabilities.canRequestClosure, view.closures.length, view.expenses.length],
  );
  const activeSection = accountSections.some((item) => item.value === section)
    ? section
    : 'overview';

  return (
    <div className="ui-stack ui-stack--lg accountability-account-panel">
      <Surface padding="md" className="hero-card accountability-account-overview" style={{ display: 'grid', gap: 16 }}>
        <div className="ui-section-header">
          <div>
            <div className="hero-title">{title}</div>
            <div className="hero-meta">
              {[getUserDisplayName(view.account.user), getUserSecondaryLabel(view.account.user)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <StatusBadge
            status={view.account.status ?? 'archived'}
          >
            {getAccountabilityAccountStatusLabel(view.account.status)}
          </StatusBadge>
        </div>

        {view.account.status === 'closing_requested' ? (
          <Surface padding="sm" style={{ background: 'var(--ui-warning-subtle)' }}>
            Новые расходы и новые выдачи денег временно заблокированы, пока идет
            сверка.
          </Surface>
        ) : null}

        {view.account.id ? null : (
          <div className="ui-text-muted">
            Активный подотчетный контур для пользователя еще не открыт.
          </div>
        )}
      </Surface>

      <WorkspaceTabs
        items={accountSections}
        value={activeSection}
        onChange={(value) => onSectionChange(value as typeof section)}
        label="Разделы подотчёта"
        idPrefix={idPrefix}
      />

      <section
        className="accountability-section-panel"
        role="tabpanel"
        id={`${idPrefix}-panel-overview`}
        aria-labelledby={`${idPrefix}-tab-overview`}
        hidden={activeSection !== 'overview'}
      >
        <Surface padding="md" style={{ display: 'grid', gap: 16 }}>
          <div className="stat-grid">
            {overviewCards.map((card) => (
              <div key={card.label} className="stat-card">
                <div className="ui-detail-label">{card.label}</div>
                <div className="stat-card__value">{card.value}</div>
              </div>
            ))}
          </div>
          <div className="accountability-overview-meta">
            <span>Черновики расходов: <strong>{view.summary.draftExpensesCount}</strong></span>
            <span>На проверке: <strong>{view.summary.submittedExpensesCount}</strong></span>
            <span>Последняя сверка: <strong>{latestClosure
              ? getAccountabilityClosureStatusLabel(latestClosure.status)
              : 'не проводилась'}</strong></span>
          </div>
          <details className="accountability-secondary-totals">
            <summary>Дополнительные финансовые итоги</summary>
            <div className="ui-detail-grid">
              <div className="ui-detail-field"><div className="ui-detail-label">Поступило всего</div><div className="ui-detail-value">{formatMoney(view.summary.totalFunding)}</div></div>
              <div className="ui-detail-field"><div className="ui-detail-label">Всего учтено в расходах</div><div className="ui-detail-value">{formatMoney(view.summary.totalRecordedExpenses)}</div></div>
              <div className="ui-detail-field"><div className="ui-detail-label">Подтверждено</div><div className="ui-detail-value">{formatMoney(view.summary.totalApprovedExpenses)}</div></div>
              <div className="ui-detail-field"><div className="ui-detail-label">Отклонено</div><div className="ui-detail-value">{formatMoney(view.summary.totalRejectedExpenses)}</div></div>
              <div className="ui-detail-field"><div className="ui-detail-label">Сверено</div><div className="ui-detail-value">{formatMoney(view.summary.totalReconciledExpenses)}</div></div>
            </div>
          </details>
          {isOwnView && view.capabilities.canRequestClosure ? (
            <div className="ui-inline">
              <Button onClick={() => void onRequestClosure()}>Отправить на сверку</Button>
            </div>
          ) : null}
        </Surface>
      </section>

      <section
        className="accountability-section-panel ui-stack ui-stack--lg"
        role="tabpanel"
        id={`${idPrefix}-panel-movements`}
        aria-labelledby={`${idPrefix}-tab-movements`}
        hidden={activeSection !== 'movements'}
      >
        {movementContent}
      {activeSection === 'movements' && (view.fundings.length > 0 || view.expenses.length > 0) ? (
        <Surface as="section" padding="md" tone="subtle" className="accountability-ledger-filters">
          <div className="ui-section-title">Фильтры финансовой истории</div>
          <div className="ui-section-subtitle">Отбор применяется к поступлениям и расходам ниже.</div>
          <RegistryToolbar showSearch={false} searchValue="" searchLabel="" searchPlaceholder="" onSearchChange={() => undefined} activeFilters={activeLedgerFilters} availableFilters={availableLedgerFilters} />
        </Surface>
      ) : null}

      {activeSection === 'movements' ? (
      <Surface padding="md" style={{ display: 'grid', gap: 16 }}>
        <div className="ui-section-header">
          <div>
            <div className="ui-section-title">Движения средств</div>
            <div className="ui-section-subtitle">
              Поступления, выдачи и сторно. Платёж по разовому заказу появляется здесь, если он зачислен именно в этот подотчёт.
            </div>
          </div>
        </div>

        {filteredFundings.length === 0 ? (
          <div className="ui-text-muted">По выбранным фильтрам поступлений нет.</div>
        ) : (
          <div className="record-list">
            {filteredFundings.map((funding) => (
              <Surface padding="sm" key={funding.id}>
                <div className="ui-section-header" style={{ paddingBottom: 0 }}>
                  <div>
                    <strong>
                      {funding.entryDirection === 'debit' ? '−' : '+'}
                      {formatMoney(funding.amount)}
                    </strong>
                    <div className="ui-text-muted">
                      {getAccountabilityFundingTypeLabel(funding.fundingType)}
                    </div>
                  </div>
                  <div className="ui-text-muted">
                    {new Date(funding.issuedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="ui-text-muted" style={{ marginTop: 6 }}>
                  Зафиксировал: {getUserDisplayName(funding.recordedBy ?? funding.issuedBy)}
                  {funding.oneTimeOrderId ? (
                    <> · <Link href={`/one-time-orders/${funding.oneTimeOrderId}`}>Открыть разовый заказ</Link></>
                  ) : null}
                </div>
                {funding.comment ? (
                  <div style={{ marginTop: 8 }}>{funding.comment}</div>
                ) : null}
                {funding.source ? (
                  <div className="ui-text-muted" style={{ marginTop: 6 }}>
                    Источник: {funding.source}
                  </div>
                ) : null}
                {funding.attachments.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <AttachmentPreviewList files={funding.attachments} emptyText="Вложения отсутствуют." />
                  </div>
                ) : null}
                {funding.reversedByFundingId ? (
                  <div className="ui-text-muted" style={{ marginTop: 8 }}>Поступление сторнировано.</div>
                ) : null}
                {view.capabilities.canReverseExternalReceipts && funding.fundingType === 'external_receipt' && !funding.reversedByFundingId ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {reversingFundingId === funding.id ? (
                      <>
                        <textarea rows={2} value={fundingReversalReason} onChange={(event) => setFundingReversalReason(event.target.value)} maxLength={500} placeholder="Причина сторнирования (обязательно)" />
                        <div className="ui-inline">
                          <Button disabled={!fundingReversalReason.trim()} onClick={() => void onReverseExternalReceipt(funding.id, fundingReversalReason.trim()).then(() => { setReversingFundingId(null); setFundingReversalReason(''); }).catch(() => undefined)}>Провести сторно</Button>
                          <Button onClick={() => { setReversingFundingId(null); setFundingReversalReason(''); }}>Отмена</Button>
                        </div>
                      </>
                    ) : (
                      <div className="ui-inline"><Button onClick={() => setReversingFundingId(funding.id)}>Сторнировать поступление</Button></div>
                    )}
                  </div>
                ) : null}
              </Surface>
            ))}
          </div>
        )}
      </Surface>
      ) : null}
      </section>

      <section
        className="accountability-section-panel ui-stack ui-stack--lg"
        role="tabpanel"
        id={`${idPrefix}-panel-expenses`}
        aria-labelledby={`${idPrefix}-tab-expenses`}
        hidden={activeSection !== 'expenses'}
      >
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

      {(view.fundings.length > 0 || view.expenses.length > 0) ? (
        <Surface as="section" padding="md" tone="subtle" className="accountability-ledger-filters">
          <div className="ui-section-title">Фильтры финансовой истории</div>
          <div className="ui-section-subtitle">Отбор применяется к поступлениям и расходам ниже.</div>
          <RegistryToolbar showSearch={false} searchValue="" searchLabel="" searchPlaceholder="" onSearchChange={() => undefined} activeFilters={activeLedgerFilters} availableFilters={availableLedgerFilters} />
        </Surface>
      ) : null}

      {activeSection === 'expenses' ? (
      <Surface padding="md" style={{ display: 'grid', gap: 16 }}>
        <div className="ui-section-header">
          <div>
            <div className="ui-section-title">Расходы</div>
            <div className="ui-section-subtitle">
              Черновик может изменить владелец. Отправленный расход ожидает решения проверяющего.
            </div>
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="ui-text-muted">По выбранным фильтрам расходов нет.</div>
        ) : (
          <div className="record-list">
            {filteredExpenses.map((expense) => (
              <Surface padding="sm" key={expense.id} style={{ display: 'grid', gap: 10 }}>
                <div className="ui-section-header" style={{ paddingBottom: 0 }}>
                  <Stack gap="sm">
                    <strong>{formatMoney(expense.amount)}</strong>
                    <div className="ui-text-muted">
                      {expense.expenseDate
                        ? new Date(`${expense.expenseDate}T00:00:00`).toLocaleDateString('ru-RU')
                        : new Date(expense.createdAt).toLocaleString('ru-RU')}{' '}
                      · {getAccountabilityExpenseCategoryLabel(expense.expenseCategory)} ·{' '}
                      {getUserDisplayName(expense.createdBy)}
                      {expense.oneTimeOrderId
                        ? ` · заказ ${expense.oneTimeOrderId.slice(0, 8)}`
                        : ''}
                    </div>
                  </Stack>
                  <StatusBadge
                    status={expense.status}
                  >
                    {getAccountabilityExpenseStatusLabel(expense.status)}
                  </StatusBadge>
                </div>

                <div style={{ whiteSpace: 'pre-wrap' }}>{expense.description}</div>

                {expense.expenseCategory === 'employee_payout' ? (
                  <div className="accountability-payout-context">
                    <strong>Выплата за разовый заказ</strong>
                    <span>Сотрудник: {expense.employeeFullName || 'не указан'}</span>
                    <span>Цикл: {expense.oneTimeOrderWorkCycle ?? 'не указан'}</span>
                    {expense.oneTimeOrderId ? (
                      <Link href={`/one-time-orders/${expense.oneTimeOrderId}`}>
                        Открыть заказ
                      </Link>
                    ) : null}
                    <span className="ui-text-muted">
                      Статус выплаты: {getAccountabilityExpenseStatusLabel(expense.status)}
                    </span>
                  </div>
                ) : null}

                {expense.rejectionComment ? (
                  <Surface padding="sm" style={{ background: 'var(--ui-danger-subtle)' }}>
                    Причина отклонения: {expense.rejectionComment}
                  </Surface>
                ) : null}

                <AttachmentPreviewList
                  files={expense.attachments}
                  emptyText="Вложения к расходу не приложены."
                />

                <div className="ui-inline">
                  {expense.capabilities.canEdit ? (
                    <Button
                      onClick={() => {
                        setEditingExpense(expense);
                      }}
                    >
                      Редактировать
                    </Button>
                  ) : null}

                  {expense.capabilities.canSubmit ? (
                    <Button
                      onClick={() => {
                        void onSubmitExpense(expense.id);
                      }}
                    >
                      Отправить
                    </Button>
                  ) : null}

                  {expense.capabilities.canApprove ? (
                    <Button
                      onClick={() => {
                        void onApproveExpense(expense.id);
                      }}
                    >
                      Подтвердить
                    </Button>
                  ) : null}

                  {expense.capabilities.canReject ? (
                    <Button
                      onClick={() => {
                        setRejectingExpenseId(expense.id);
                        setExpenseRejectComment('');
                      }}
                    >
                      Отклонить
                    </Button>
                  ) : null}
                </div>

                {rejectingExpenseId === expense.id ? (
                  <Stack gap="sm">
                    <textarea
                      rows={3}
                      value={expenseRejectComment}
                      onChange={(event) =>
                        setExpenseRejectComment(event.target.value)
                      }
                      placeholder="Укажите причину отклонения"
                    />
                    <div className="ui-inline">
                      <Button
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
                      </Button>
                      <Button
                        onClick={() => {
                          setRejectingExpenseId(null);
                          setExpenseRejectComment('');
                        }}
                      >
                        Отмена
                      </Button>
                    </div>
                  </Stack>
                ) : null}
              </Surface>
            ))}
          </div>
        )}
      </Surface>
      ) : null}
      </section>

      <section
        className="accountability-section-panel"
        role="tabpanel"
        id={`${idPrefix}-panel-reconciliation`}
        aria-labelledby={`${idPrefix}-tab-reconciliation`}
        hidden={activeSection !== 'reconciliation'}
      >
      {activeSection === 'reconciliation' ? (
      <Surface padding="md" style={{ display: 'grid', gap: 16 }}>
        <div className="ui-section-header">
          <div>
            <div className="ui-section-title">Сверка и закрытие</div>
            <div className="ui-section-subtitle">
              Все решения и комментарии по сверкам сохраняются в истории.
            </div>
          </div>
        </div>

        {view.closures.length === 0 ? (
          <div className="ui-text-muted">Попыток сверки пока не было.</div>
        ) : (
          <div className="record-list">
            {view.closures.map((closure) => (
              <ClosureCard key={closure.id} closure={closure} />
            ))}
          </div>
        )}
      </Surface>
      ) : null}
      </section>
    </div>
  );
}

function ClosureCard({
  closure,
}: {
  closure: AccountabilityClosureItem;
}): React.JSX.Element {
  return (
    <Surface padding="sm" style={{ display: 'grid', gap: 10 }}>
      <div className="ui-section-header" style={{ paddingBottom: 0 }}>
        <div>
          <strong>
            {new Date(closure.requestedAt).toLocaleString('ru-RU')}
          </strong>
          <div className="ui-text-muted">
            Запросил: {getUserDisplayName(closure.requestedBy)}
          </div>
        </div>
        <StatusBadge status={closure.status}>
          {getAccountabilityClosureStatusLabel(closure.status)}
        </StatusBadge>
      </div>

      {closure.comment ? <div>{closure.comment}</div> : null}

      <div className="ui-text-muted">
        {closure.approvedBy
          ? `Подтвердил: ${getUserDisplayName(closure.approvedBy)}`
          : closure.rejectedBy
            ? `Отклонил: ${getUserDisplayName(closure.rejectedBy)}`
            : 'Ожидает решения руководства'}
      </div>

      <div className="ui-inline">
        <Link
          href={`/approvals?sourceEntityType=accountability_closure&sourceEntityId=${closure.id}`}
        >
          Открыть согласование
        </Link>
      </div>
    </Surface>
  );
}
