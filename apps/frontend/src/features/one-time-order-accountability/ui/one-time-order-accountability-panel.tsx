'use client';

import React, { useEffect, useState } from 'react';

import type {
  AccountabilityExpenseCategory,
  OneTimeOrderAccountabilityView,
} from '@/entities/accountability/model/accountability.types';
import type { OneTimeWorkforceEmployee } from '@/entities/one-time-order/api/one-time-order-workforce-client';
import type { OneTimeOrderCompletion } from '@/entities/one-time-order/model/one-time-order.types';
import {
  getAccountabilityAccountStatusLabel,
  getAccountabilityExpenseCategoryLabel,
  getAccountabilityExpenseStatusLabel,
  getAccountabilityFundingTypeLabel,
} from '@/shared/lib/accountability-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, Badge, Button, StatusBadge, Surface } from '@/shared/ui/foundation';

const CATEGORY_OPTIONS: Array<{
  value: AccountabilityExpenseCategory;
  label: string;
}> = [
  { value: 'consumables', label: 'Расходные материалы' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'transport', label: 'Транспорт' },
  { value: 'services', label: 'Услуги' },
  { value: 'other', label: 'Другое' },
  { value: 'employee_payout', label: 'Выплата сотруднику' },
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
  workforce,
  workCycle,
  onCreateExpense,
}: {
  view: OneTimeOrderAccountabilityView;
  completions: OneTimeOrderCompletion[];
  orderStatus: string;
  workforce: OneTimeWorkforceEmployee[];
  workCycle: number;
  onCreateExpense: (payload: {
    amount: number;
    description: string;
    oneTimeOrderCompletionId: string | null;
    employeeId: string | null;
    oneTimeOrderWorkCycle: number | null;
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completionSelection, setCompletionSelection] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const isEmployeePayout = expenseCategory === 'employee_payout';
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
      (!isEmployeePayout && !completionSelection) ||
      (isEmployeePayout && !employeeId) ||
      (submitAfterSave && !isEmployeePayout && files.length === 0)
    ) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await onCreateExpense({
        amount: normalizedAmount,
        description: normalizedDescription,
        oneTimeOrderCompletionId:
          isEmployeePayout || completionSelection === 'order_only'
            ? null
            : completionSelection,
        employeeId: isEmployeePayout ? employeeId : null,
        oneTimeOrderWorkCycle: isEmployeePayout ? workCycle : null,
        expenseCategory,
        expenseDate,
        files,
        submitAfterSave,
      });
      setAmount('');
      setDescription('');
      setFiles([]);
      setEmployeeId('');
    } catch {
      setSaveError('Не удалось сохранить расход. Проверьте список расходов перед повторной отправкой.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Surface padding="md" style={{ display: 'grid', gap: 18 }}>
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Подотчёт по заказу</div>
          <div className="ui-section-subtitle">
            Здесь учитываются деньги менеджера и расходы, оформленные по этому заказу.
          </div>
        </div>
        <Badge>
          {view.visibilityScope === 'administrative'
            ? 'Все доступные счета'
            : 'Мой подотчёт'}
        </Badge>
      </div>

      {view.capabilities.canCreateExpense ? (
        <Surface padding="sm" style={{ display: 'grid', gap: 14 }}>
          <div>
            <strong>Добавить расход по заказу</strong>
            <div className="ui-text-muted">
            {isEmployeePayout
              ? 'Фото и чек необязательны. Выплата учитывается отдельно от начисления табеля после подтверждения расхода.'
              : 'Для отправки на проверку приложите чек или документ.'}
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
              <DatePicker value={expenseDate} onChange={(nextValue) => setExpenseDate(nextValue)} />
            </label>
            <SearchableSelect
                label="Категория"
                value={expenseCategory}
                options={CATEGORY_OPTIONS.filter(
                  (option) =>
                    option.value !== 'employee_payout' ||
                    view.capabilities.canCreateEmployeePayout,
                ).map((option) => ({ value: option.value, label: option.label }))}
                searchable={false}
                clearable={false}
                onChange={(value) => setExpenseCategory(value as AccountabilityExpenseCategory)}
            />
            {isEmployeePayout ? (
              <SearchableSelect
                label="Сотрудник"
                value={employeeId}
                options={workforce.map((employee) => ({
                  value: employee.employeeId,
                  label: employee.fullName,
                  description: employee.isActive ? employee.position ?? undefined : 'Состав прошлого периода',
                }))}
                placeholder="Выберите сотрудника заказа"
                searchPlaceholder="Найти сотрудника"
                emptyText="В этом цикле сотрудников нет"
                clearable={false}
                onChange={setEmployeeId}
              />
            ) : null}
            {!isEmployeePayout && completions.length > 0 ? (
              <SearchableSelect
                  label="Цикл заказа"
                  value={completionSelection}
                  options={[
                    ...(orderStatus !== 'completed' ? [{ value: 'order_only', label: 'Текущий цикл, до завершения' }] : []),
                    ...completions.map((completion) => ({
                      value: completion.id,
                      label: `Цикл ${completion.workCycle}${completion.completionSource === 'legacy_unknown' ? ' · исторический' : ''}`,
                    })),
                  ]}
                  placeholder="Выберите цикл"
                  searchable={false}
                  clearable={false}
                  onChange={setCompletionSelection}
              />
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
            emptyText={isEmployeePayout ? 'Фото или чек можно добавить по желанию.' : 'Чек или документ еще не приложен.'}
          />
          {saveError ? <Alert tone="danger" role="alert">{saveError}</Alert> : null}
          <div className="ui-inline">
            <Button
              disabled={isSaving || (!isEmployeePayout && !completionSelection)}
              onClick={() => void save(false)}
            >
              Сохранить черновик
            </Button>
            <Button
              disabled={
                isSaving ||
                (!isEmployeePayout && !completionSelection) ||
                (!isEmployeePayout && files.length === 0)
              }
              onClick={() => void save(true)}
            >
              Отправить на проверку
            </Button>
          </div>
        </Surface>
      ) : null}

      {view.accounts.length === 0 ? (
        <div className="ui-text-muted">
          Поступлений и расходов по этому заказу пока нет.
        </div>
      ) : (
        <div className="ui-stack ui-stack--lg">
          {view.accounts.map((account) => {
            const confirmedExpenses =
              account.summary.totalApprovedExpenses +
              account.summary.totalReconciledExpenses;
            const submittedAmount = account.expenses
              .filter((expense) => expense.status === 'submitted')
              .reduce((sum, expense) => sum + expense.amount, 0);

            return (
              <Surface padding="sm" key={account.accountId}>
                <div className="ui-section-header">
                  <strong>{getUserDisplayName(account.user)}</strong>
                  <StatusBadge
                    status={account.accountStatus}
                  >
                    {getAccountabilityAccountStatusLabel(account.accountStatus)}
                  </StatusBadge>
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
                    label="На проверке"
                    value={formatMoney(submittedAmount)}
                  />
                  <SummaryItem
                    label="Прогнозный остаток"
                    value={formatMoney(account.summary.forecastBalance)}
                  />
                </div>
                <div className="ui-text-muted">
                  Текущий остаток учитывает проведённые поступления и подтверждённые расходы. Прогноз дополнительно вычитает расходы, отправленные на проверку.
                </div>

                {account.fundings.length > 0 ? (
                  <div className="record-list local-scroll local-scroll--sm">
                    {account.fundings.map((funding) => (
                      <div key={funding.id} className="ui-detail-field">
                        <div className="ui-detail-value">
                          {funding.entryDirection === 'debit' ? '−' : '+'}
                          {formatMoney(funding.amount)}
                        </div>
                        <div className="ui-detail-label">
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
                      <div key={expense.id} className="ui-detail-field">
                        <div
                          className="ui-section-header"
                          style={{ paddingBottom: 0 }}
                        >
                          <div>
                            <div className="ui-detail-value">
                              {formatMoney(expense.amount)}
                            </div>
                            <div className="ui-detail-label">
                              {getAccountabilityExpenseCategoryLabel(
                                expense.expenseCategory,
                              )}
                              {expense.employeeFullName
                                ? ` · ${expense.employeeFullName}`
                                : ''}
                              {expense.oneTimeOrderWorkCycle
                                ? ` · Цикл ${expense.oneTimeOrderWorkCycle}`
                                : ''}
                              {expense.expenseDate
                                ? ` · ${new Date(`${expense.expenseDate}T00:00:00`).toLocaleDateString('ru-RU')}`
                                : ''}
                              {expense.oneTimeOrderCompletionId
                                ? ` · Цикл ${completions.find((completion) => completion.id === expense.oneTimeOrderCompletionId)?.workCycle ?? 'не найден'}`
                                : ' · Без привязки к циклу'}
                            </div>
                          </div>
                          <StatusBadge
                            status={expense.status}
                          >
                            {getAccountabilityExpenseStatusLabel(expense.status)}
                          </StatusBadge>
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
              </Surface>
            );
          })}
        </div>
      )}
    </Surface>
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
      <div className="ui-detail-label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </div>
  );
}
