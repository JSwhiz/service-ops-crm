'use client';

import React, { useEffect, useMemo, useState } from 'react';

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

  if (!canAccessAccountability) {
    return (
      <>
        <PageTitle title="Подотчет" />
        <div className="page-card">У вас нет доступа к модулю подотчета.</div>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Подотчет" />

      <div className="page-stack workspace-page accountability-workspace">
        {actionError ? (
          <div className="page-card" style={{ color: '#b91c1c' }}>
            {actionError}
          </div>
        ) : null}

        {canOpenOwnLedger && ownLoading ? (
          <div className="page-card">Загрузка вашего подотчета...</div>
        ) : canOpenOwnLedger && ownError ? (
          <div className="page-card" style={{ color: '#b91c1c' }}>
            {ownError}
          </div>
        ) : canOpenOwnLedger && ownView ? (
          <>
          {canRecordExternalReceipt ? (
            <section className="page-card workspace-surface" style={{ display: 'grid', gap: 16 }}>
              <div className="section-header">
                <div>
                  <div className="section-title">Свободное поступление</div>
                  <div className="section-subtitle">
                    Зафиксируйте деньги, полученные вне разовых заказов. Поступление сразу войдёт в остаток и будет доступно для сверки.
                  </div>
                </div>
              </div>
              <div className="field-grid">
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Сумма</span>
                  <input type="number" min="0.01" step="0.01" value={externalAmount} onChange={(event) => setExternalAmount(event.target.value)} placeholder="0,00" />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Откуда поступили деньги</span>
                  <input value={externalSource} onChange={(event) => setExternalSource(event.target.value)} maxLength={200} placeholder="Например, возврат или деньги от клиента" />
                </label>
                <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                  <span>Комментарий <span aria-hidden="true">*</span></span>
                  <textarea rows={3} value={externalComment} onChange={(event) => setExternalComment(event.target.value)} maxLength={500} placeholder="Укажите основание поступления" />
                </label>
                <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                  <span>Подтверждающий файл <span className="page-muted">(необязательно)</span></span>
                  <input className="accountability-file-input" type="file" multiple onChange={(event) => setExternalFiles(Array.from(event.target.files ?? []))} />
                </label>
              </div>
              {pendingReceiptAttachments ? (
                <div className="page-card page-card--subtle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span>Поступление уже записано. Не удалось прикрепить файлы.</span>
                  <button type="button" disabled={isRecordingExternal} onClick={() => void (async () => {
                    if (!pendingReceiptAttachments) return;
                    setIsRecordingExternal(true);
                    try {
                      await Promise.all(pendingReceiptAttachments.files.map((file) => uploadFileToEntity({ entityType: 'accountability_funding', entityId: pendingReceiptAttachments.id, file })));
                      setPendingReceiptAttachments(null);
                      await reloadOwnView();
                    } catch {
                      setActionError('Поступление уже учтено, но файл не прикреплён. Повторите прикрепление.');
                    } finally { setIsRecordingExternal(false); }
                  })()}>Повторить прикрепление</button>
                </div>
              ) : null}
              <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" disabled={isRecordingExternal || pendingReceiptAttachments !== null || !Number.isFinite(Number(externalAmount)) || Number(externalAmount) <= 0 || !externalSource.trim() || !externalComment.trim() || ownView.account.status === 'closing_requested'} onClick={() => void (async () => {
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
                        setActionError('Поступление уже записано и включено в остаток, но файл не прикреплён. Повторите прикрепление ниже.');
                      }
                    }
                    await reloadOwnView();
                  } catch (error) {
                    setActionError(getErrorMessage(error, 'Не удалось записать поступление.'));
                  } finally { setIsRecordingExternal(false); }
                })()}>{isRecordingExternal ? 'Сохраняем...' : 'Зафиксировать поступление'}</button>
              </div>
            </section>
          ) : null}
          <AccountabilityAccountPanel
            title="Мой подотчет"
            view={ownView}
            isOwnView
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

        {canReviewAccountability ? (
          <div className="page-card workspace-surface accountability-review" style={{ display: 'grid', gap: 18 }}>
            <div className="section-header">
              <div>
                <div className="section-title">Сверка и выдача денег</div>
                <div className="section-subtitle">
                  Просматривайте остатки сотрудников и выдавайте средства из одного места.
                </div>
              </div>
            </div>

            <div className="field-grid">
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Пользователь</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                >
                  {userOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {[getUserDisplayName(option), getUserSecondaryLabel(option)]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
              </label>

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
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-label">Выбранный пользователь</div>
                  <div className="detail-value">
                    {getUserDisplayName(selectedUser)}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Статус контура</div>
                  <div className="detail-value">
                    {reviewView
                      ? getAccountabilityAccountStatusLabel(reviewView.account.status)
                      : '—'}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Текущий остаток</div>
                  <div className="detail-value">
                    {reviewView ? formatMoney(reviewView.summary.currentBalance) : '—'}
                  </div>
                </div>
              </div>
            ) : null}

            {canIssueAccountabilityFunds ? (
              <div className="action-row">
                <button
                  type="button"
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
                </button>
              </div>
            ) : null}

            <div className="page-card page-card--subtle" style={{ display: 'grid', gap: 12 }}>
              <div className="section-title" style={{ fontSize: 16 }}>
                Активные подотчетные контуры
              </div>

              {accountItems.length === 0 ? (
                <div className="page-muted">
                  Пока нет пользователей с открытым или ранее использованным подотчетом.
                </div>
              ) : (
                <div className="record-list local-scroll local-scroll--sm">
                  {accountItems.map((item) => (
                    <button
                      key={item.accountId}
                      type="button"
                      className="record-card"
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
                      <div className="section-header" style={{ paddingBottom: 0 }}>
                        <strong>{getUserDisplayName(item.user)}</strong>
                        <span className="status-pill" data-status={item.status}>
                          {getAccountabilityAccountStatusLabel(item.status)}
                        </span>
                      </div>
                      {getUserSecondaryLabel(item.user) ? (
                        <div className="page-muted">
                          {getUserSecondaryLabel(item.user)}
                        </div>
                      ) : null}
                      <div className="detail-grid">
                        <div className="detail-field">
                          <div className="detail-label">Остаток</div>
                          <div className="detail-value">
                            {formatMoney(item.summary.currentBalance)}
                          </div>
                        </div>
                        <div className="detail-field">
                          <div className="detail-label">Пополнено</div>
                          <div className="detail-value">
                            {formatMoney(item.summary.totalFunding)}
                          </div>
                        </div>
                        <div className="detail-field">
                          <div className="detail-label">На проверке</div>
                          <div className="detail-value">
                            {item.summary.submittedExpensesCount}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {canReviewAccountability ? (
          reviewLoading ? (
            <div className="page-card">Загрузка review-экрана...</div>
          ) : reviewError ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {reviewError}
            </div>
          ) : reviewView ? (
            <AccountabilityAccountPanel
              title={
                selectedUser
                  ? `Подотчет пользователя: ${getUserDisplayName(selectedUser)}`
                  : 'Подотчет пользователя'
              }
              view={reviewView}
              isOwnView={false}
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
      </div>
    </>
  );
}
