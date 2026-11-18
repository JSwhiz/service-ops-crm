'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

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
import { useAuth } from '@/shared/auth/use-auth';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import {
  Alert,
  Badge,
  Button,
  Field,
  StatusBadge,
  Surface,
} from '@/shared/ui/foundation';
import { getExpenseCycleLabel } from '../model/expense-cycle-label';

import { Dialog } from '@/shared/ui/overlays/overlays';
import { getExpenseMoneyBreakdown } from '@/features/accountability/model/expense-money-breakdown';
import { createExpenseDraftRequest } from '@/features/accountability/model/expense-draft-request';
import styles from '@/features/accountability/ui/accountability-ui.module.css';

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
    clientRequestId: string;
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
  const { user } = useAuth();
  const formId = useId();
  const ownAccount = view.accounts.find(
    (account) => account.user.id === user?.id,
  );
  const [open, setOpen] = useState(false);
  const request = useRef(createExpenseDraftRequest());
  const saveLock = useRef(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseCategory, setExpenseCategory] =
    useState<AccountabilityExpenseCategory>('consumables');
  const [expenseDate, setExpenseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completionSelection, setCompletionSelection] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const enteredAmount = Number(amount);
  const previewAmount =
    Number.isFinite(enteredAmount) && enteredAmount > 0 ? enteredAmount : null;
  const isEmployeePayout = expenseCategory === 'employee_payout';
  const canSaveDraft =
    view.capabilities.canCreateExpense &&
    (!isEmployeePayout || view.capabilities.canCreateEmployeePayout);
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
    if (
      !canSaveDraft ||
      saveLock.current ||
      (submitAfterSave && !view.capabilities.canSubmitExpense)
    )
      return;
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

    saveLock.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onCreateExpense({
        clientRequestId: request.current.getId(),
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
      request.current.complete();
      setOpen(false);
      setAmount('');
      setDescription('');
      setFiles([]);
      setEmployeeId('');
    } catch {
      setSaveError(
        'Не удалось подтвердить сохранение. Проверьте список расходов перед повторной попыткой. Если данные уже сохранены, восстановите исходные значения: изменённый черновик не создаст второй расход.',
      );
    } finally {
      saveLock.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Surface padding="md" style={{ display: 'grid', gap: 18 }}>
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Подотчёт по заказу</div>
          <div className="ui-section-subtitle">
            Здесь учитываются деньги менеджера и расходы, оформленные по этому
            заказу.
          </div>
        </div>
        <Badge>
          {view.visibilityScope === 'administrative'
            ? 'Все доступные счета'
            : 'Мой подотчёт'}
        </Badge>
      </div>

      {!canSaveDraft ? (
        <Alert tone="info">
          Создание расхода сейчас недоступно. Нужны право на создание, активный
          собственный подотчёт и доступ к этому заказу. Если счёт ещё не открыт,
          обратитесь к пользователю с правом выдачи средств. Введённый черновик
          сохранён; после восстановления доступа отправьте его вручную.
        </Alert>
      ) : null}
      <AccessSnapshotBoundary blocked={!canSaveDraft}>
        <div className="ui-inline">
          <Button variant="primary" onClick={() => setOpen(true)}>
            {amount || description || files.length
              ? 'Продолжить расход'
              : 'Добавить расход'}
          </Button>
          {view.capabilities.canCreateEmployeePayout &&
          !amount &&
          !description &&
          files.length === 0 ? (
            <Button
              onClick={() => {
                setExpenseCategory('employee_payout');
                setOpen(true);
              }}
            >
              Выплата сотруднику
            </Button>
          ) : null}
        </div>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={isEmployeePayout ? 'Выплата сотруднику' : 'Расход по заказу'}
          size="regular"
          busy={isSaving}
          footer={
            <div className="ui-inline">
              <Button
                form={formId}
                type="submit"
                name="intent"
                value="draft"
                disabled={
                  isSaving ||
                  !canSaveDraft ||
                  (!isEmployeePayout && !completionSelection)
                }
              >
                Сохранить черновик
              </Button>
              <Button
                form={formId}
                type="submit"
                name="intent"
                value="submit"
                variant="primary"
                disabled={
                  isSaving ||
                  !canSaveDraft ||
                  !view.capabilities.canSubmitExpense ||
                  (!isEmployeePayout && !completionSelection) ||
                  (!isEmployeePayout && files.length === 0)
                }
              >
                Отправить на проверку
              </Button>
            </div>
          }
        >
          <form
            id={formId}
            noValidate
            className="ui-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const submitAfterSave =
                (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  'value',
                ) === 'submit';
              void save(submitAfterSave);
            }}
          >
            <Surface padding="sm" tone="subtle">
              <div className="ui-detail-grid">
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Плательщик</div>
                  <div className="ui-detail-value">
                    {getUserDisplayName(ownAccount?.user ?? user)}
                  </div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Источник</div>
                  <div className="ui-detail-value">Мой подотчёт</div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">
                    Подтверждённый остаток
                  </div>
                  <div className="ui-detail-value">
                    {ownAccount
                      ? formatMoney(ownAccount.summary.currentBalance)
                      : 'Нет доступных данных об остатке'}
                  </div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">
                    Прогноз после отправки
                  </div>
                  <div className="ui-detail-value">
                    {!ownAccount
                      ? 'Нет доступных данных об остатке'
                      : previewAmount === null
                        ? 'Укажите сумму'
                        : formatMoney(
                            ownAccount.summary.forecastBalance - previewAmount,
                          )}
                  </div>
                </div>
              </div>
              <p className="ui-text-muted">
                Черновик не меняет остаток. После отправки сумма попадёт на
                проверку, а после подтверждения уменьшит проведённый остаток.
              </p>
            </Surface>
            <div>
              <strong>
                {isEmployeePayout ? 'Фактическая выплата' : 'Новый расход'}
              </strong>
              <div className="ui-text-muted">
                {isEmployeePayout
                  ? 'Фото и чек необязательны. Выплата учитывается отдельно от начисления табеля после подтверждения расхода.'
                  : 'Для отправки на проверку приложите чек или документ.'}
              </div>
            </div>
            <div className={styles.expenseFormGrid}>
              <Field label="Сумма, ₽" required>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              <Field label="Дата расхода" required>
                <DatePicker
                  value={expenseDate}
                  onChange={(nextValue) => setExpenseDate(nextValue)}
                />
              </Field>
              <SearchableSelect
                label="Категория"
                value={expenseCategory}
                options={CATEGORY_OPTIONS.filter(
                  (option) =>
                    option.value !== 'employee_payout' ||
                    view.capabilities.canCreateEmployeePayout,
                ).map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                searchable={false}
                clearable={false}
                onChange={(value) =>
                  setExpenseCategory(value as AccountabilityExpenseCategory)
                }
              />
              {isEmployeePayout ? (
                <SearchableSelect
                  label="Сотрудник"
                  value={employeeId}
                  options={workforce.map((employee) => ({
                    value: employee.employeeId,
                    label: employee.fullName,
                    description: employee.isActive
                      ? (employee.position ?? undefined)
                      : 'Состав прошлого периода',
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
                    ...(orderStatus !== 'completed'
                      ? [
                          {
                            value: 'order_only',
                            label: 'Текущий цикл, до завершения',
                          },
                        ]
                      : []),
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
              <Field
                label="Описание"
                required
                className={styles.expenseFormWide}
              >
                <textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Кратко опишите расход"
                />
              </Field>
            </div>
            <MediaActionPicker
              disabled={isSaving || !view.capabilities.canCreateExpense}
              onPick={async (file) => setFiles((current) => [...current, file])}
            />
            <PendingMediaList
              files={files}
              onRemove={(index) =>
                setFiles((current) =>
                  current.filter((_, currentIndex) => currentIndex !== index),
                )
              }
              emptyText={
                isEmployeePayout
                  ? 'Фото или чек можно добавить по желанию.'
                  : 'Чек или документ еще не приложен.'
              }
            />
            {saveError ? (
              <Alert tone="danger" role="alert">
                {saveError}
              </Alert>
            ) : null}
          </form>
        </Dialog>
      </AccessSnapshotBoundary>

      {view.accounts.length === 0 ? (
        <div className="ui-text-muted">
          По этому заказу пока нет доступных поступлений и расходов. Отсутствие
          записей не означает нулевой остаток подотчёта.
        </div>
      ) : (
        <div className="ui-stack ui-stack--lg">
          {view.accounts.map((account) => {
            const confirmedExpenses =
              account.summary.totalApprovedExpenses +
              account.summary.totalReconciledExpenses;
            const { confirmedPayouts, submittedAmount, draftAmount } =
              getExpenseMoneyBreakdown(account.expenses);

            return (
              <Surface padding="sm" key={account.accountId}>
                <div className="ui-section-header">
                  <strong>{getUserDisplayName(account.user)}</strong>
                  <StatusBadge status={account.accountStatus}>
                    {getAccountabilityAccountStatusLabel(account.accountStatus)}
                  </StatusBadge>
                </div>
                <div className={styles.moneySummary}>
                  <dl className={styles.moneyPrimary}>
                    <div>
                      <dt>Поступило</dt>
                      <dd>{formatMoney(account.summary.totalCredits)}</dd>
                    </div>
                    <div>
                      <dt>Остаток</dt>
                      <dd>{formatMoney(account.summary.currentBalance)}</dd>
                    </div>
                    <div>
                      <dt>Прогноз</dt>
                      <dd>{formatMoney(account.summary.forecastBalance)}</dd>
                    </div>
                  </dl>
                  <dl className={styles.moneySecondary}>
                    <div>
                      <dt>Выплачено сотрудникам</dt>
                      <dd>{formatMoney(confirmedPayouts)}</dd>
                    </div>
                    <div>
                      <dt>Прочие подтверждённые расходы</dt>
                      <dd>
                        {formatMoney(confirmedExpenses - confirmedPayouts)}
                      </dd>
                    </div>
                    <div>
                      <dt>На проверке</dt>
                      <dd>{formatMoney(submittedAmount)}</dd>
                    </div>
                    <div>
                      <dt>Черновики</dt>
                      <dd>{formatMoney(draftAmount)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="ui-text-muted">
                  Остаток — подтверждённые операции. Прогноз — с расходами на
                  проверке.
                </div>
                <details className={styles.moneyPolicy}>
                  <summary>Как считаются суммы</summary>
                  <p>
                    Остаток учитывает проведённые поступления и списания,
                    подтверждённые и сверенные расходы. Прогноз дополнительно
                    вычитает только расходы на проверке. Черновики не уменьшают
                    прогноз. Выплаты учитываются после подтверждения или сверки;
                    начисления табеля не являются выплатой.
                  </p>
                </details>

                {account.fundings.length > 0 ? (
                  <div className="record-list local-scroll local-scroll--sm">
                    {account.fundings.map((funding) => (
                      <div key={funding.id} className="ui-detail-field">
                        <div className="ui-detail-value">
                          {funding.entryDirection === 'debit' ? '−' : '+'}
                          {formatMoney(funding.amount)}
                        </div>
                        <div className="ui-detail-label">
                          {getAccountabilityFundingTypeLabel(
                            funding.fundingType,
                          )}{' '}
                          · {new Date(funding.issuedAt).toLocaleString('ru-RU')}
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
                              {` · ${getExpenseCycleLabel(expense, completions)}`}
                              {expense.expenseDate
                                ? ` · ${new Date(`${expense.expenseDate}T00:00:00`).toLocaleDateString('ru-RU')}`
                                : ''}
                            </div>
                          </div>
                          <StatusBadge status={expense.status}>
                            {getAccountabilityExpenseStatusLabel(
                              expense.status,
                            )}
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
