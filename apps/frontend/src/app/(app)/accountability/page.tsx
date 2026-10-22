'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  approveAccountabilityExpense,
  createAccountabilityExpense,
  getAccountabilityAccountByUserId,
  getMyAccountability,
  issueAccountabilityFunding,
  listAccountabilityAccounts,
  listAccountabilityUsers,
  recordExternalAccountabilityReceipt,
  reverseExternalAccountabilityReceipt,
  rejectAccountabilityExpense,
  requestAccountabilityClosure,
  submitAccountabilityExpense,
  updateAccountabilityExpense,
} from '@/entities/accountability/api/accountability-client';
import type {
  AccountabilityAccountListItem,
  AccountabilityAccountView,
  AccountabilityUserSummary,
} from '@/entities/accountability/model/accountability.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import { AccountabilityAccountPanel } from '@/features/accountability/ui/accountability-account-panel';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccountabilityAccountStatusLabel } from '@/shared/lib/accountability-presentation';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { Alert, Button, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import accountabilityStyles from '@/features/accountability/ui/accountability-ui.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

export default function AccountabilityPage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canAccessAccountability =
    user?.capabilities?.canAccessAccountability ?? false;
  const canViewOwnAccountability =
    user?.capabilities?.canViewOwnAccountability ?? false;
  const canRecordExternalReceipt =
    user?.capabilities?.canRecordExternalReceipt ?? false;
  const canOpenOwnLedger = canViewOwnAccountability || canRecordExternalReceipt;
  const canReviewAccountability =
    user?.capabilities?.canReviewAccountability ?? false;
  const canIssueAccountabilityFunds =
    user?.capabilities?.canIssueAccountabilityFunds ?? false;
  const workspaceSections = useMemo(
    () => [
      ...(canOpenOwnLedger ? [{ value: 'mine', label: 'Мой подотчёт' }] : []),
      ...(canReviewAccountability
        ? [{ value: 'accounts', label: 'Счета сотрудников' }]
        : []),
    ],
    [canOpenOwnLedger, canReviewAccountability],
  );
  const requestedWorkspaceSection = searchParams.get('section') ?? '';
  const activeWorkspaceSection = workspaceSections.some(
    (item) => item.value === requestedWorkspaceSection,
  )
    ? requestedWorkspaceSection
    : workspaceSections[0]?.value ?? '';
  const accountSectionValues = ['overview', 'movements', 'expenses', 'reconciliation'] as const;
  const requestedAccountSection = searchParams.get('accountSection') ?? 'overview';
  const activeAccountSection = accountSectionValues.includes(
    requestedAccountSection as (typeof accountSectionValues)[number],
  )
    ? (requestedAccountSection as (typeof accountSectionValues)[number])
    : 'overview';
  const updateQuery = (key: string, value: string): void => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    router.push(`?${next.toString()}`, { scroll: false });
  };
  const changeWorkspaceSection = (section: string): void => {
    updateQuery('section', section);
  };
  const changeAccountSection = (
    section: 'overview' | 'movements' | 'expenses' | 'reconciliation',
  ): void => {
    updateQuery('accountSection', section);
  };

  const [ownView, setOwnView] = useState<AccountabilityAccountView | null>(null);
  const [ownLoading, setOwnLoading] = useState(true);
  const [ownError, setOwnError] = useState<string | null>(null);

  const [accountItems, setAccountItems] = useState<AccountabilityAccountListItem[]>(
    [],
  );
  const [userOptions, setUserOptions] = useState<AccountabilityUserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [reviewView, setReviewView] = useState<AccountabilityAccountView | null>(
    null,
  );
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [fundingAmount, setFundingAmount] = useState('');
  const [fundingComment, setFundingComment] = useState('');
  const [isIssuingFunding, setIsIssuingFunding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [externalAmount, setExternalAmount] = useState('');
  const [externalSource, setExternalSource] = useState('');
  const [externalComment, setExternalComment] = useState('');
  const [externalFiles, setExternalFiles] = useState<File[]>([]);
  const [isRecordingExternal, setIsRecordingExternal] = useState(false);
  const [pendingReceiptAttachments, setPendingReceiptAttachments] = useState<{
    id: string;
    files: File[];
  } | null>(null);

  const selectedUser = useMemo(
    () => userOptions.find((item) => item.id === selectedUserId) ?? null,
    [selectedUserId, userOptions],
  );

  const reloadOwnView = async (): Promise<void> => {
    if (!canOpenOwnLedger) {
      setOwnView(null);
      setOwnError(null);
      setOwnLoading(false);
      return;
    }

    setOwnLoading(true);
    setOwnError(null);

    try {
      const response = await getMyAccountability();
      setOwnView(response);
    } catch (error) {
      setOwnView(null);
      setOwnError(
        getErrorMessage(error, 'Не удалось загрузить ваш подотчетный контур.'),
      );
    } finally {
      setOwnLoading(false);
    }
  };

  const reloadReviewDirectory = async (
    preferredUserId?: string,
  ): Promise<void> => {
    if (!canReviewAccountability) {
      setAccountItems([]);
      setUserOptions([]);
      setSelectedUserId('');
      return;
    }

    try {
      const [accounts, users] = await Promise.all([
        listAccountabilityAccounts(),
        listAccountabilityUsers(),
      ]);

      setAccountItems(accounts);
      setUserOptions(users);
      setSelectedUserId((current) => {
        const isAllowed = (candidate: string | undefined): candidate is string =>
          Boolean(candidate) && users.some((userItem) => userItem.id === candidate);

        if (isAllowed(preferredUserId)) {
          return preferredUserId;
        }

        if (isAllowed(current)) {
          return current;
        }

        if (isAllowed(accounts[0]?.user.id)) {
          return accounts[0].user.id;
        }

        if (isAllowed(user?.id)) {
          return user.id;
        }

        return users[0]?.id ?? '';
      });
    } catch (error) {
      setReviewError(
        getErrorMessage(error, 'Не удалось загрузить список подотчетных пользователей.'),
      );
    }
  };

  const reloadReviewView = async (userId: string): Promise<void> => {
    if (!canReviewAccountability || !userId) {
      setReviewView(null);
      setReviewError(null);
      setReviewLoading(false);
      return;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const response = await getAccountabilityAccountByUserId(userId);
      setReviewView(response);
    } catch (error) {
      setReviewView(null);
      setReviewError(
        getErrorMessage(error, 'Не удалось загрузить подотчетный контур пользователя.'),
      );
    } finally {
      setReviewLoading(false);
    }
  };

  const reloadAfterAccountChange = async (affectedUserId: string): Promise<void> => {
    await reloadOwnView();

    if (!canReviewAccountability) {
      return;
    }

    await reloadReviewDirectory(affectedUserId);
    await reloadReviewView(affectedUserId);
  };

  useEffect(() => {
    void reloadOwnView();
  }, [canOpenOwnLedger]);

  useEffect(() => {
    void reloadReviewDirectory();
  }, [canReviewAccountability, user?.id]);

  useEffect(() => {
    if (!canReviewAccountability || !selectedUserId) {
      setReviewView(null);
      setReviewError(null);
      setReviewLoading(false);
      return;
    }

    void reloadReviewView(selectedUserId);
  }, [canReviewAccountability, selectedUserId]);

  const externalReceiptForm = canRecordExternalReceipt && ownView ? (
    <Surface as="section" padding="md" style={{ display: 'grid', gap: 16 }}>
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Сообщить о поступлении</div>
          <div className="ui-section-subtitle">
            Деньги, полученные вне разовых заказов, сразу войдут в ваш остаток. Укажите источник и обязательный комментарий.
          </div>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>Сумма</span>
          <input type="number" min="0.01" step="0.01" value={externalAmount} onChange={(event) => setExternalAmount(event.target.value)} placeholder="0,00" />
        </label>
        <label>
          <span>Источник поступления</span>
          <input value={externalSource} onChange={(event) => setExternalSource(event.target.value)} maxLength={200} placeholder="Например, возврат или деньги от клиента" />
        </label>
        <label className="accountability-full-field">
          <span>Комментарий <span aria-hidden="true">*</span></span>
          <textarea rows={3} value={externalComment} onChange={(event) => setExternalComment(event.target.value)} maxLength={500} placeholder="Укажите основание поступления" />
        </label>
        <label className="accountability-full-field">
          <span>Подтверждающий файл <span className="ui-text-muted">(необязательно)</span></span>
          <input className={accountabilityStyles.accountabilityFileInput} type="file" multiple onChange={(event) => setExternalFiles(Array.from(event.target.files ?? []))} />
        </label>
      </div>
      {pendingReceiptAttachments ? (
        <Surface padding="md" tone="subtle" className="accountability-receipt-retry">
          <span>Поступление уже учтено, но файл не прикреплён.</span>
          <Button disabled={isRecordingExternal} onClick={() => void (async () => {
            if (!pendingReceiptAttachments) return;
            setIsRecordingExternal(true);
            try {
              await Promise.all(pendingReceiptAttachments.files.map((file) => uploadFileToEntity({ entityType: 'accountability_funding', entityId: pendingReceiptAttachments.id, file })));
              setPendingReceiptAttachments(null);
              await reloadOwnView();
            } catch {
              setActionError('Поступление уже учтено, но файл не прикреплён. Повторите прикрепление.');
            } finally { setIsRecordingExternal(false); }
          })()}>Повторить прикрепление</Button>
        </Surface>
      ) : null}
      <div className="ui-inline accountability-receipt-actions">
        <Button disabled={isRecordingExternal || pendingReceiptAttachments !== null || !Number.isFinite(Number(externalAmount)) || Number(externalAmount) <= 0 || !externalSource.trim() || !externalComment.trim() || ownView.account.status === 'closing_requested'} onClick={() => void (async () => {
          setActionError(null);
          setIsRecordingExternal(true);
          try {
            const receipt = await recordExternalAccountabilityReceipt({ amount: Number(externalAmount), source: externalSource.trim(), comment: externalComment.trim() });
            const files = externalFiles;
            setExternalAmount(''); setExternalSource(''); setExternalComment(''); setExternalFiles([]);
            if (files.length > 0) {
              try {
                await Promise.all(files.map((file) => uploadFileToEntity({ entityType: 'accountability_funding', entityId: receipt.id, file })));
              } catch {
                setPendingReceiptAttachments({ id: receipt.id, files });
                setActionError('Поступление уже записано и включено в остаток, но файл не прикреплён. Повторите прикрепление выше.');
              }
            }
            await reloadOwnView();
          } catch (error) {
            setActionError(getErrorMessage(error, 'Не удалось записать поступление.'));
          } finally { setIsRecordingExternal(false); }
        })()}>{isRecordingExternal ? 'Сохраняем...' : 'Зафиксировать поступление'}</Button>
      </div>
    </Surface>
  ) : null;

  if (!canAccessAccountability) {
    return (
      <>
        <PageTitle title="Подотчёт" />
        <Surface padding="md">У вас нет доступа к модулю подотчета.</Surface>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Подотчёт" />

      <div className={`ui-page ${accountabilityStyles.accountabilityWorkspace}`}>
        {actionError ? (
          <Alert tone="danger" role="alert">
            {actionError}
          </Alert>
        ) : null}

        {workspaceSections.length > 1 ? (
          <WorkspaceTabs
            items={workspaceSections}
            value={activeWorkspaceSection}
            onChange={changeWorkspaceSection}
            label="Рабочие разделы подотчёта"
          />
        ) : null}

        {canOpenOwnLedger ? (
        <section
          className={`ui-stack ui-stack--lg ${accountabilityStyles.accountabilityWorkspacePanel}`}
          role={workspaceSections.length > 1 ? 'tabpanel' : 'region'}
          id="workspace-panel-mine"
          aria-labelledby={workspaceSections.length > 1 ? 'workspace-tab-mine' : undefined}
          aria-label={workspaceSections.length > 1 ? undefined : 'Мой подотчёт'}
          hidden={activeWorkspaceSection !== 'mine'}
        >
        {ownLoading ? (
          <Surface padding="md">Загрузка вашего подотчета...</Surface>
        ) : ownError ? (
          <Alert tone="danger" role="alert">
            {ownError}
          </Alert>
        ) : ownView ? (
          <>
          <AccountabilityAccountPanel
            title="Мой подотчет"
            view={ownView}
            isOwnView
            section={activeAccountSection}
            onSectionChange={changeAccountSection}
            idPrefix="own-account"
            movementContent={externalReceiptForm}
            onSaveExpense={async (payload) => {
              setActionError(null);

              try {
                let savedExpense = payload.expenseId
                  ? await updateAccountabilityExpense(payload.expenseId, {
                      amount: payload.amount,
                      description: payload.description,
                    })
                  : await createAccountabilityExpense({
                      amount: payload.amount,
                      description: payload.description,
                    });

                if (payload.files.length > 0) {
                  await Promise.all(
                    payload.files.map((file) =>
                      uploadFileToEntity({
                        entityType: 'accountability_expense',
                        entityId: savedExpense.id,
                        file,
                      }),
                    ),
                  );
                }

                if (payload.submitAfterSave) {
                  savedExpense = await submitAccountabilityExpense(savedExpense.id);
                }

                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                setActionError(
                  getErrorMessage(error, 'Не удалось сохранить расход подотчета.'),
                );
                throw error;
              }
            }}
            onSubmitExpense={async (expenseId) => {
              setActionError(null);

              try {
                await submitAccountabilityExpense(expenseId);
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                setActionError(
                  getErrorMessage(error, 'Не удалось отправить расход на подтверждение.'),
                );
              }
            }}
            onApproveExpense={async (expenseId) => {
              setActionError(null);

              try {
                await approveAccountabilityExpense(expenseId);
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                setActionError(
                  getErrorMessage(error, 'Не удалось подтвердить расход.'),
                );
              }
            }}
            onRejectExpense={async (expenseId, comment) => {
              setActionError(null);

              try {
                await rejectAccountabilityExpense(expenseId, comment);
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                setActionError(
                  getErrorMessage(error, 'Не удалось отклонить расход.'),
                );
              }
            }}
            onRequestClosure={async () => {
              setActionError(null);

              try {
                await requestAccountabilityClosure();
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                setActionError(
                  getErrorMessage(error, 'Не удалось отправить подотчет на сверку.'),
                );
              }
            }}
            onReverseExternalReceipt={async (fundingId, reason) => {
              setActionError(null);
              try {
                await reverseExternalAccountabilityReceipt(fundingId, reason);
                await reloadAfterAccountChange(ownView.account.user.id);
              } catch (error) {
                setActionError(getErrorMessage(error, 'Не удалось сторнировать внешнее поступление.'));
                throw error;
              }
            }}
          />
          </>
        ) : null}
        </section>
        ) : null}
        {canReviewAccountability ? (
        <section
          className={`ui-stack ui-stack--lg ${accountabilityStyles.accountabilityWorkspacePanel}`}
          role={workspaceSections.length > 1 ? 'tabpanel' : 'region'}
          id="workspace-panel-accounts"
          aria-labelledby={workspaceSections.length > 1 ? 'workspace-tab-accounts' : undefined}
          aria-label={workspaceSections.length > 1 ? undefined : 'Счета сотрудников'}
          hidden={activeWorkspaceSection !== 'accounts'}
        >
          <Surface padding="md" className={accountabilityStyles.accountabilityReview} style={{ display: 'grid', gap: 18 }}>
            <div className="ui-section-header">
              <div>
                <div className="ui-section-title">Сверка и выдача денег</div>
                <div className="ui-section-subtitle">
                  Просматривайте остатки сотрудников и выдавайте средства из одного места.
                </div>
              </div>
            </div>

            <div className="field-grid">
              <Stack gap="sm">
                <span className="ui-detail-label">Пользователь</span>
                <SearchableSelect
                  label="Пользователь"
                  value={selectedUserId}
                  options={userOptions.map((option) => ({
                    value: option.id,
                    label: getUserDisplayName(option),
                    description: getUserSecondaryLabel(option) || undefined,
                    searchText: `${option.login} ${option.roleCodes.join(' ')}`,
                  }))}
                  onChange={setSelectedUserId}
                  placeholder="Выберите сотрудника"
                  searchPlaceholder="Найти сотрудника"
                  emptyText="Сотрудник не найден"
                  clearable={false}
                  hideLabel
                />
              </Stack>

              {canIssueAccountabilityFunds ? (
                <>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>Сумма выдачи</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={fundingAmount}
                      onChange={(event) => setFundingAmount(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                    <span>Комментарий к выдаче</span>
                    <textarea
                      rows={3}
                      value={fundingComment}
                      onChange={(event) => setFundingComment(event.target.value)}
                      placeholder="Например, аванс на хозяйственные расходы"
                    />
                  </label>
                </>
              ) : null}
            </div>

            {selectedUser ? (
              <div className="ui-detail-grid">
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Выбранный пользователь</div>
                  <div className="ui-detail-value">
                    {getUserDisplayName(selectedUser)}
                  </div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Статус контура</div>
                  <div className="ui-detail-value">
                    {reviewView
                      ? getAccountabilityAccountStatusLabel(reviewView.account.status)
                      : '—'}
                  </div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Текущий остаток</div>
                  <div className="ui-detail-value">
                    {reviewView ? formatMoney(reviewView.summary.currentBalance) : '—'}
                  </div>
                </div>
              </div>
            ) : null}

            {canIssueAccountabilityFunds ? (
              <div className="ui-inline">
                <Button
                  disabled={
                    isIssuingFunding ||
                    !selectedUserId ||
                    !Number.isFinite(Number(fundingAmount)) ||
                    Number(fundingAmount) <= 0 ||
                    reviewView?.account.status === 'closing_requested'
                  }
                  onClick={() => {
                    void (async () => {
                      setActionError(null);
                      setIsIssuingFunding(true);

                      try {
                        await issueAccountabilityFunding(selectedUserId, {
                          amount: Number(fundingAmount),
                          comment: fundingComment.trim() || undefined,
                        });
                        setFundingAmount('');
                        setFundingComment('');
                        await reloadAfterAccountChange(selectedUserId);
                      } catch (error) {
                        setActionError(
                          getErrorMessage(
                            error,
                            'Не удалось выдать подотчетные средства пользователю.',
                          ),
                        );
                      } finally {
                        setIsIssuingFunding(false);
                      }
                    })();
                  }}
                >
                  {isIssuingFunding ? 'Выдаем...' : 'Выдать деньги'}
                </Button>
              </div>
            ) : null}

            <details className={`ui-surface ui-surface--padded ui-surface--subtle ${accountabilityStyles.accountabilityAccountDirectory}`}>
              <summary className="ui-section-title">
                Все подотчётные счета <span className="ui-text-muted">({accountItems.length})</span>
              </summary>

              {accountItems.length === 0 ? (
                <div className="ui-text-muted">
                  Пока нет пользователей с открытым или ранее использованным подотчетом.
                </div>
              ) : (
                <div className="record-list">
                  {accountItems.map((item) => (
                    <button
                      key={item.accountId}
                      type="button"
                      className="ui-surface ui-surface--compact"
                      style={{
                        display: 'grid',
                        gap: 8,
                        textAlign: 'left',
                        borderColor:
                          item.user.id === selectedUserId ? 'var(--ui-accent-subtle-hover)' : undefined,
                        background:
                          item.user.id === selectedUserId ? 'var(--ui-accent-subtle)' : undefined,
                      }}
                      onClick={() => {
                        setSelectedUserId(item.user.id);
                      }}
                    >
                      <div className="ui-section-header" style={{ paddingBottom: 0 }}>
                        <strong>{getUserDisplayName(item.user)}</strong>
                        <StatusBadge status={item.status}>
                          {getAccountabilityAccountStatusLabel(item.status)}
                        </StatusBadge>
                      </div>
                      {getUserSecondaryLabel(item.user) ? (
                        <div className="ui-text-muted">
                          {getUserSecondaryLabel(item.user)}
                        </div>
                      ) : null}
                      <div className="ui-detail-grid">
                        <div className="ui-detail-field">
                          <div className="ui-detail-label">Остаток</div>
                          <div className="ui-detail-value">
                            {formatMoney(item.summary.currentBalance)}
                          </div>
                        </div>
                        <div className="ui-detail-field">
                          <div className="ui-detail-label">Пополнено</div>
                          <div className="ui-detail-value">
                            {formatMoney(item.summary.totalFunding)}
                          </div>
                        </div>
                        <div className="ui-detail-field">
                          <div className="ui-detail-label">На проверке</div>
                          <div className="ui-detail-value">
                            {item.summary.submittedExpensesCount}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </details>
          </Surface>
        {canReviewAccountability ? (
          reviewLoading ? (
            <Surface padding="md">Загрузка review-экрана...</Surface>
          ) : reviewError ? (
            <Alert tone="danger" role="alert">
              {reviewError}
            </Alert>
          ) : reviewView ? (
            <AccountabilityAccountPanel
              title={
                selectedUser
                  ? `Подотчет пользователя: ${getUserDisplayName(selectedUser)}`
                  : 'Подотчет пользователя'
              }
              view={reviewView}
              isOwnView={false}
              section={activeAccountSection}
              onSectionChange={changeAccountSection}
              idPrefix="review-account"
              onSaveExpense={async () => {
                throw new Error('Saving expense is not available in review mode');
              }}
              onSubmitExpense={async () => {
                throw new Error('Submitting expense is not available in review mode');
              }}
              onApproveExpense={async (expenseId) => {
                setActionError(null);

                try {
                  await approveAccountabilityExpense(expenseId);
                  await reloadAfterAccountChange(selectedUserId);
                } catch (error) {
                  setActionError(
                    getErrorMessage(error, 'Не удалось подтвердить расход пользователя.'),
                  );
                }
              }}
              onRejectExpense={async (expenseId, comment) => {
                setActionError(null);

                try {
                  await rejectAccountabilityExpense(expenseId, comment);
                  await reloadAfterAccountChange(selectedUserId);
                } catch (error) {
                  setActionError(
                    getErrorMessage(error, 'Не удалось отклонить расход пользователя.'),
                  );
                }
              }}
              onRequestClosure={async () => {
                throw new Error('Closure request is not available in review mode');
              }}
              onReverseExternalReceipt={async (fundingId, reason) => {
                setActionError(null);
                try {
                  await reverseExternalAccountabilityReceipt(fundingId, reason);
                  await reloadAfterAccountChange(reviewView.account.user.id);
                } catch (error) {
                  setActionError(getErrorMessage(error, 'Не удалось сторнировать внешнее поступление.'));
                  throw error;
                }
              }}
            />
          ) : null
        ) : null}
        </section>
        ) : null}
      </div>
    </>
  );
}
