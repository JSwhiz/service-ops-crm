'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError } from '@/shared/api/fetcher';
import { getAccountabilityAccountStatusLabel } from '@/shared/lib/accountability-presentation';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { Alert, Button, EmptyState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
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
  const { user, refreshUser, capabilitiesRefreshError } = useAuth();
  const accessRevision = useAccessRevision();
  const canAccessAccountability =
    user?.capabilities?.canAccessAccountability ?? false;
  const canViewOwnAccountability =
    user?.capabilities?.canViewOwnAccountability ?? false;
  const canRecordExternalReceipt =
    user?.capabilities?.canRecordExternalReceipt ?? false;
  const canOpenOwnLedger = canViewOwnAccountability || canRecordExternalReceipt;
  // Discovery permits only navigation and server-filtered options, not access
  // to any concrete account or its funding actions.
  const canDiscoverAccountabilityReview = user?.capabilities?.canDiscoverAccountabilityReview ?? false;
  const workspaceSections = useMemo(
    () => [
      ...(canOpenOwnLedger ? [{ value: 'mine', label: 'Мой подотчёт' }] : []),
      ...(canDiscoverAccountabilityReview
        ? [{ value: 'accounts', label: 'Счета сотрудников' }]
        : []),
    ],
    [canOpenOwnLedger, canDiscoverAccountabilityReview],
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
  const [ownViewRevision, setOwnViewRevision] = useState<string | null>(null);
  const ownRequest = useRef(0);

  const [accountItems, setAccountItems] = useState<AccountabilityAccountListItem[]>(
    [],
  );
  const [userOptions, setUserOptions] = useState<AccountabilityUserSummary[]>([]);
  const [directoryRevision, setDirectoryRevision] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;
  const [reviewView, setReviewView] = useState<AccountabilityAccountView | null>(
    null,
  );
  const [reviewViewRevision, setReviewViewRevision] = useState<string | null>(null);
  const reviewRequest = useRef(0);
  const directoryRequest = useRef(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [fundingAmount, setFundingAmount] = useState('');
  const [fundingComment, setFundingComment] = useState('');
  const [isIssuingFunding, setIsIssuingFunding] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
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
  const [pendingExpenseAttachments, setPendingExpenseAttachments] = useState<{ id: string | null; files: File[] } | null>(null);
  const [isAttachingExpense, setIsAttachingExpense] = useState(false);

  useEffect(() => {
    // A rights revision preserves a draft; a different account must not inherit it.
    setExternalAmount(''); setExternalSource(''); setExternalComment(''); setExternalFiles([]);
    setPendingReceiptAttachments(null); setFundingAmount(''); setFundingComment('');
    setPendingExpenseAttachments(null);
    setIsAttachingExpense(false);
    setIsRecordingExternal(false); setIsIssuingFunding(false);
    setSelectedUserId(''); setActionError(null); setSavedNotice(null);
  }, [user?.id]);

  const visibleUserOptions = directoryRevision === accessRevision ? userOptions : [];
  const visibleAccountItems = directoryRevision === accessRevision ? accountItems : [];
  const freshReviewView = !reviewLoading && reviewViewRevision === accessRevision
    && reviewView?.account.user.id === selectedUserId ? reviewView : null;
  const selectedUser = useMemo(
    () => directoryRevision === accessRevision
      ? userOptions.find((item) => item.id === selectedUserId) ?? null : null,
    [selectedUserId, userOptions, directoryRevision, accessRevision],
  );
  const canIssueAccountabilityFunds = Boolean(
    selectedUser && !reviewLoading && reviewViewRevision === accessRevision && selectedUserId &&
    reviewView?.account.user.id === selectedUserId && reviewView.capabilities.canIssueFunding,
  );
  const selectReviewedUser = (nextUserId: string): void => {
    if (isIssuingFunding) return;
    if (nextUserId !== selectedUserIdRef.current) {
      setFundingAmount('');
      setFundingComment('');
    }
    selectedUserIdRef.current = nextUserId;
    setSelectedUserId(nextUserId);
  };

  const reloadOwnView = async (): Promise<void> => {
    const requestId = ++ownRequest.current;
    const generation = getAccessGeneration();
    if (!canOpenOwnLedger) {
      // Keep a same-user draft mounted but concealed until access is checked again.
      setOwnView((current) => current?.account.user.id === user?.id ? current : null);
      setOwnError(null);
      setOwnLoading(false);
      return;
    }

    setOwnLoading(true);
    setOwnError(null);

    try {
      const response = await getMyAccountability();
      if (requestId !== ownRequest.current || !isAccessGenerationCurrent(generation)) return;
      if (response.account.user.id !== user?.id) {
        setOwnView(null);
        setOwnError('Не удалось подтвердить владельца счёта. Обновите доступ.');
        return;
      }
      setOwnView(response);
      setOwnViewRevision(accessRevision);
    } catch (error) {
      if (requestId !== ownRequest.current || !isAccessGenerationCurrent(generation)) return;
      setOwnView((current) => current?.account.user.id === user?.id ? current : null);
      setOwnError(
        getErrorMessage(error, 'Не удалось загрузить ваш подотчетный контур.'),
      );
    } finally {
      if (requestId === ownRequest.current && isAccessGenerationCurrent(generation)) setOwnLoading(false);
    }
  };

  const reloadReviewDirectory = async (
    preferredUserId?: string,
  ): Promise<AccountabilityUserSummary[]> => {
    const requestId = ++directoryRequest.current;
    const generation = getAccessGeneration();
    setDirectoryRevision(null);
    if (!canDiscoverAccountabilityReview) {
      reviewRequest.current += 1;
      setReviewView(null);
      setAccountItems([]);
      setUserOptions([]);
      return [];
    }

    try {
      const [accounts, users] = await Promise.all([
        listAccountabilityAccounts(),
        listAccountabilityUsers(),
      ]);
      if (requestId !== directoryRequest.current || !isAccessGenerationCurrent(generation)) return [];

      setAccountItems(accounts);
      setUserOptions(users);
      setDirectoryRevision(accessRevision);
      setReviewError(null);
      setSelectedUserId((current) => {
        const isAllowed = (candidate: string | undefined): candidate is string =>
          Boolean(candidate) && users.some((userItem) => userItem.id === candidate);

        if (!current && isAllowed(preferredUserId)) {
          return preferredUserId;
        }

        if (isAllowed(current)) {
          return current;
        }

        // Losing access must never retarget an entered amount to another person.
        if (current) return current;

        if (isAllowed(accounts[0]?.user.id)) {
          return accounts[0].user.id;
        }

        if (isAllowed(user?.id)) {
          return user.id;
        }

        return users[0]?.id ?? '';
      });
      return users;
    } catch (error) {
      if (requestId !== directoryRequest.current || !isAccessGenerationCurrent(generation)) return [];
      reviewRequest.current += 1;
      setReviewView(null);
      setAccountItems([]);
      setUserOptions([]);
      setReviewError(
        error instanceof ApiError && error.statusCode === 403 ? null
          : getErrorMessage(error, 'Не удалось загрузить список подотчетных пользователей.'),
      );
      return [];
    }
  };

  const reloadReviewView = async (userId: string): Promise<void> => {
    const requestId = ++reviewRequest.current;
    const generation = getAccessGeneration();
    if (!canDiscoverAccountabilityReview || !userId || !userOptions.some(({ id }) => id === userId)) {
      setReviewView(null);
      setReviewError(null);
      setReviewLoading(false);
      return;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const response = await getAccountabilityAccountByUserId(userId);
      if (requestId !== reviewRequest.current || !isAccessGenerationCurrent(generation)) return;
      setReviewView(response);
      setReviewViewRevision(accessRevision);
    } catch (error) {
      if (requestId !== reviewRequest.current || !isAccessGenerationCurrent(generation)) return;
      setReviewView(null);
      setReviewError(
        getErrorMessage(error, 'Не удалось загрузить подотчетный контур пользователя.'),
      );
    } finally {
      if (requestId === reviewRequest.current && isAccessGenerationCurrent(generation)) setReviewLoading(false);
    }
  };

  const reloadAfterAccountChange = async (affectedUserId: string): Promise<void> => {
    await reloadOwnView();

    if (!canDiscoverAccountabilityReview) {
      return;
    }

    const users = await reloadReviewDirectory(affectedUserId);
    if (selectedUserIdRef.current === affectedUserId && users.some(({ id }) => id === affectedUserId)) {
      await reloadReviewView(affectedUserId);
    }
  };

  useEffect(() => {
    void reloadOwnView();
    return () => { ownRequest.current += 1; };
  }, [canOpenOwnLedger, accessRevision]);

  useEffect(() => {
    void reloadReviewDirectory();
    return () => { directoryRequest.current += 1; };
  }, [canDiscoverAccountabilityReview, accessRevision]);

  useEffect(() => {
    if (!canDiscoverAccountabilityReview || !selectedUserId) {
      reviewRequest.current += 1;
      setReviewView(null);
      setReviewError(null);
      setReviewLoading(false);
      return;
    }

    void reloadReviewView(selectedUserId);
  }, [canDiscoverAccountabilityReview, selectedUserId, userOptions, accessRevision]);

  const acknowledgeIfAccessChanged = (result: object, generation: number, message: string): boolean => {
    if (!isSavedWithoutAccess(result) && isAccessGenerationCurrent(generation)) return false;
    setSavedNotice(message);
    return true;
  };

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
            const session = getAccessSessionGeneration();
            try {
              await Promise.all(pendingReceiptAttachments.files.map((file) => uploadFileToEntity({ entityType: 'accountability_funding', entityId: pendingReceiptAttachments.id, file })));
              if (getAccessSessionGeneration() !== session) return;
              setPendingReceiptAttachments(null);
              await reloadOwnView();
            } catch {
              if (getAccessSessionGeneration() !== session) return;
              setActionError('Поступление уже учтено, но файл не прикреплён. Повторите прикрепление.');
            } finally { if (getAccessSessionGeneration() === session) setIsRecordingExternal(false); }
          })()}>Повторить прикрепление</Button>
        </Surface>
      ) : null}
      <div className="ui-inline accountability-receipt-actions">
        <Button disabled={isRecordingExternal || pendingReceiptAttachments !== null || !Number.isFinite(Number(externalAmount)) || Number(externalAmount) <= 0 || !externalSource.trim() || !externalComment.trim() || ownView.account.status === 'closing_requested'} onClick={() => void (async () => {
          setActionError(null);
          setIsRecordingExternal(true);
          const session = getAccessSessionGeneration();
          try {
            const generation = getAccessGeneration();
            const receipt = await recordExternalAccountabilityReceipt({ amount: Number(externalAmount), source: externalSource.trim(), comment: externalComment.trim() });
            if (getAccessSessionGeneration() !== session) return;
            const files = externalFiles;
            const message = files.length ? 'Поступление сохранено. Файлы не прикреплены.' : 'Поступление сохранено.';
            // Returning from the acknowledgement must not expose this already
            // committed receipt as a new, still-sendable money draft.
            setExternalAmount(''); setExternalSource(''); setExternalComment(''); setExternalFiles([]);
            if (isSavedWithoutAccess(receipt) || !isAccessGenerationCurrent(generation)) {
              if (!isSavedWithoutAccess(receipt) && files.length) setPendingReceiptAttachments({ id: receipt.id, files });
              setSavedNotice(message);
              return;
            }
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
            if (getAccessSessionGeneration() !== session) return;
            setActionError(getErrorMessage(error, 'Не удалось записать поступление.'));
          } finally { if (getAccessSessionGeneration() === session) setIsRecordingExternal(false); }
        })()}>{isRecordingExternal ? 'Сохраняем...' : 'Зафиксировать поступление'}</Button>
      </div>
    </Surface>
  ) : null;

  if (savedNotice) return (
    <>
      <PageTitle title="Подотчёт" />
      <Alert tone="success" role="status" title={savedNotice}>
        <p>Доступ изменился. Карточка закрыта.</p>
        {capabilitiesRefreshError ? <p role="alert">{capabilitiesRefreshError}</p> : null}
        <Button onClick={() => void refreshUser({ force: true }).then(() => setSavedNotice(null)).catch(() => undefined)}>Проверить доступ</Button>
      </Alert>
    </>
  );

  if (!canAccessAccountability && !canDiscoverAccountabilityReview && !ownView) {
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
        {!canAccessAccountability && !canDiscoverAccountabilityReview ? (
          <Surface padding="md">Доступ к подотчёту отозван. Несохранённый черновик скрыт.</Surface>
        ) : null}
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

        {canOpenOwnLedger || (ownView && ownView.account.user.id === user?.id) ? (
        <section
          className={`ui-stack ui-stack--lg ${accountabilityStyles.accountabilityWorkspacePanel}`}
          role={workspaceSections.length > 1 ? 'tabpanel' : 'region'}
          id="workspace-panel-mine"
          aria-labelledby={workspaceSections.length > 1 ? 'workspace-tab-mine' : undefined}
          aria-label={workspaceSections.length > 1 ? undefined : 'Мой подотчёт'}
          hidden={!canOpenOwnLedger || activeWorkspaceSection !== 'mine'}
        >
        {ownLoading ? (
          <Surface padding="md">Загрузка вашего подотчета...</Surface>
        ) : null}
        {ownError ? (
          <Alert tone="danger" role="alert">
            {ownError}
            <Button onClick={() => void reloadOwnView()}>Проверить доступ</Button>
          </Alert>
        ) : null}
        {ownView ? (
          <AccessSnapshotBoundary blocked={!canOpenOwnLedger || ownView.account.user.id !== user?.id || ownLoading || ownViewRevision !== accessRevision || Boolean(ownError)}>
          {pendingExpenseAttachments ? (
            <Alert tone="warning" role="status">
              Черновик расхода уже сохранён. Часть файлов не прикреплена; повторное прикрепление не создаёт новый расход.
              {!pendingExpenseAttachments.id ? (
                <SearchableSelect label="Сохранённый расход" value=""
                  placeholder="Выберите сохранённый расход для этих файлов"
                  options={ownView.expenses.filter((expense) => expense.status === 'draft' && expense.createdBy.id === user?.id)
                    .map((expense) => ({ value: expense.id, label: `${formatMoney(expense.amount)} · ${expense.description}`,
                      description: new Date(expense.createdAt).toLocaleString('ru-RU') }))}
                  onChange={(expenseId) => setPendingExpenseAttachments((current) => current ? { ...current, id: expenseId || null } : null)} />
              ) : <p>Сохранённый расход: {ownView.expenses.find((expense) => expense.id === pendingExpenseAttachments.id)?.description ?? 'сейчас недоступен'}.</p>}
              <Button disabled={!pendingExpenseAttachments.id || isAttachingExpense || user?.capabilities?.canUploadFile === false ||
                !ownView.expenses.find((expense) => expense.id === pendingExpenseAttachments.id)?.capabilities.canEdit}
                onClick={() => void (async () => {
                  if (!pendingExpenseAttachments?.id || isAttachingExpense) return;
                  const pending = pendingExpenseAttachments;
                  const expenseId = pendingExpenseAttachments.id;
                  const generation = getAccessGeneration();
                  const session = getAccessSessionGeneration();
                  setIsAttachingExpense(true);
                  const outcomes = await Promise.allSettled(pending.files.map((file) => uploadFileToEntity({
                    entityType: 'accountability_expense', entityId: expenseId, file,
                  })));
                  if (getAccessSessionGeneration() !== session) return;
                  setIsAttachingExpense(false);
                  const failed = pending.files.filter((_, index) => outcomes[index]?.status !== 'fulfilled');
                  setPendingExpenseAttachments(failed.length ? { id: pending.id, files: failed } : null);
                  if (!isAccessGenerationCurrent(generation)) return;
                  setActionError(failed.length ? 'Черновик расхода сохранён. Не все файлы прикреплены; повторите прикрепление после проверки доступа.' : null);
                  await reloadOwnView();
                })()}>Повторить прикрепление</Button>
            </Alert>
          ) : null}
          <AccountabilityAccountPanel
            key={ownView.account.user.id}
            title="Мой подотчет"
            view={ownView}
            isOwnView
            section={activeAccountSection}
            onSectionChange={changeAccountSection}
            idPrefix="own-account"
            movementContent={externalReceiptForm}
            onSaveExpense={async (payload) => {
              setActionError(null);
              const generation = getAccessGeneration();
              const session = getAccessSessionGeneration();
              let committedExpenseId: string | null = null;

              try {
                if (pendingExpenseAttachments) throw new Error('Сначала завершите прикрепление файлов к уже сохранённому расходу.');
                let savedExpense = payload.expenseId
                  ? await updateAccountabilityExpense(payload.expenseId, {
                      amount: payload.amount,
                      description: payload.description,
                    })
                  : await createAccountabilityExpense({
                      amount: payload.amount,
                      description: payload.description,
                    });

                if (getAccessSessionGeneration() !== session) return;
                if (payload.files.length && (isSavedWithoutAccess(savedExpense) || !isAccessGenerationCurrent(generation))) {
                  setPendingExpenseAttachments({ id: isSavedWithoutAccess(savedExpense) ? payload.expenseId ?? null : savedExpense.id, files: payload.files });
                }
                if (acknowledgeIfAccessChanged(savedExpense, generation,
                  payload.files.length ? 'Черновик расхода сохранён. Файлы не прикреплены.' : 'Черновик расхода сохранён.')) return;
                if (isSavedWithoutAccess(savedExpense)) return;
                const savedExpenseId = savedExpense.id;
                committedExpenseId = savedExpenseId;

                if (payload.files.length > 0) {
                  const uploads = await Promise.allSettled(
                    payload.files.map((file) =>
                      uploadFileToEntity({
                        entityType: 'accountability_expense',
                        entityId: savedExpenseId,
                        file,
                      }),
                    ),
                  );
                  if (getAccessSessionGeneration() !== session) return;
                  const failed = payload.files.filter((_, index) => uploads[index]?.status !== 'fulfilled');
                  if (failed.length) setPendingExpenseAttachments({ id: savedExpenseId, files: failed });
                  if (!isAccessGenerationCurrent(generation)) {
                    setSavedNotice('Черновик расхода сохранён. Проверьте вложения в карточке расхода.');
                    return;
                  }
                  if (failed.length) {
                    setActionError('Черновик расхода сохранён. Часть файлов не прикреплена; отправка на проверку не выполнена.');
                    await reloadOwnView();
                    return;
                  }
                }

                if (payload.submitAfterSave) {
                  if (!isAccessGenerationCurrent(generation)) {
                    setSavedNotice('Черновик расхода сохранён. Он не отправлен на проверку.');
                    return;
                  }
                  savedExpense = await submitAccountabilityExpense(savedExpense.id);
                  if (getAccessSessionGeneration() !== session) return;
                  if (acknowledgeIfAccessChanged(savedExpense, generation, 'Расход отправлен на проверку.')) return;
                }

                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                if (getAccessSessionGeneration() !== session) return;
                if (committedExpenseId) {
                  const notice = 'Расход сохранён. Не удалось подтвердить следующий шаг. Проверьте его состояние в списке расходов.';
                  if (!isAccessGenerationCurrent(generation)) setSavedNotice(notice);
                  else {
                    setActionError(notice);
                    await reloadOwnView();
                  }
                  return;
                }
                setActionError(
                  getErrorMessage(error, 'Не удалось сохранить расход подотчета.'),
                );
                throw error;
              }
            }}
            onSubmitExpense={async (expenseId) => {
              setActionError(null);
              const generation = getAccessGeneration();
              const session = getAccessSessionGeneration();

              try {
                const result = await submitAccountabilityExpense(expenseId);
                if (getAccessSessionGeneration() !== session) return;
                if (acknowledgeIfAccessChanged(result, generation, 'Расход отправлен на проверку.')) return;
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                if (getAccessSessionGeneration() !== session) return;
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
              const generation = getAccessGeneration();
              const session = getAccessSessionGeneration();
              setActionError(null);

              try {
                const result = await requestAccountabilityClosure();
                if (getAccessSessionGeneration() !== session) return;
                if (acknowledgeIfAccessChanged(result, generation, 'Подотчёт отправлен на сверку.')) return;
                await reloadAfterAccountChange(user?.id ?? ownView.account.user.id);
              } catch (error) {
                if (getAccessSessionGeneration() !== session) return;
                setActionError(
                  getErrorMessage(error, 'Не удалось отправить подотчет на сверку.'),
                );
              }
            }}
            onReverseExternalReceipt={async (fundingId, reason) => {
              setActionError(null);
              try {
                const generation = getAccessGeneration();
                const result = await reverseExternalAccountabilityReceipt(fundingId, reason);
                if (acknowledgeIfAccessChanged(result, generation, 'Сторно сохранено.')) return;
                await reloadAfterAccountChange(ownView.account.user.id);
              } catch (error) {
                setActionError(getErrorMessage(error, 'Не удалось сторнировать внешнее поступление.'));
                throw error;
              }
            }}
          />
          </AccessSnapshotBoundary>
        ) : !ownLoading && !ownError ? <EmptyState title="Подотчёт пока не открыт" description="Это не нулевой остаток: сведения о вашем счёте пока отсутствуют. Обратитесь к пользователю с правом выдачи подотчётных средств." /> : null}
        </section>
        ) : null}
        {canDiscoverAccountabilityReview ? (
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
                  value={selectedUser ? selectedUserId : ''}
                  options={visibleUserOptions.map((option) => ({
                    value: option.id,
                    label: getUserDisplayName(option),
                    description: getUserSecondaryLabel(option) || undefined,
                    searchText: `${option.login} ${option.roleCodes.join(' ')}`,
                  }))}
                  onChange={selectReviewedUser}
                  disabled={isIssuingFunding}
                  placeholder="Выберите пользователя"
                  searchPlaceholder="Найти пользователя"
                  emptyText="Пользователь не найден"
                  clearable={false}
                  hideLabel
                />
              </Stack>

              {selectedUserId && !selectedUser ? (
                <Alert tone="warning" role="status">Доступ к выбранному счёту недоступен. Выдача заблокирована; черновик не перенесён другому пользователю.</Alert>
              ) : null}

              {canIssueAccountabilityFunds ? (
                <>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>Сумма выдачи</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={fundingAmount}
                      disabled={isIssuingFunding}
                      onChange={(event) => setFundingAmount(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                    <span>Комментарий к выдаче</span>
                    <textarea
                      rows={3}
                      value={fundingComment}
                      disabled={isIssuingFunding}
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
                    {freshReviewView
                      ? getAccountabilityAccountStatusLabel(freshReviewView.account.status)
                      : '—'}
                  </div>
                </div>
                <div className="ui-detail-field">
                  <div className="ui-detail-label">Текущий остаток</div>
                  <div className="ui-detail-value">
                    {freshReviewView ? (freshReviewView.account.id ? formatMoney(freshReviewView.summary.currentBalance) : 'Счёт не открыт') : '—'}
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
                    if (!canIssueAccountabilityFunds || isIssuingFunding) return;
                    void (async () => {
                      setActionError(null);
                      setIsIssuingFunding(true);
                      const session = getAccessSessionGeneration();

                      try {
                        const generation = getAccessGeneration();
                        const result = await issueAccountabilityFunding(selectedUserId, {
                          amount: Number(fundingAmount),
                          comment: fundingComment.trim() || undefined,
                        });
                        if (getAccessSessionGeneration() !== session) return;
                        setFundingAmount('');
                        setFundingComment('');
                        if (acknowledgeIfAccessChanged(result, generation, 'Выдача сохранена.')) return;
                        await reloadAfterAccountChange(selectedUserId);
                      } catch (error) {
                        if (getAccessSessionGeneration() !== session) return;
                        setActionError(
                          error instanceof ApiError && (error.statusCode === 403 || error.code === 'ACCESS_VERSION_CHANGED')
                            ? 'Право на выдачу изменилось. Проверьте доступ перед повторной отправкой.'
                            : getErrorMessage(error, 'Не удалось выдать подотчётные средства пользователю.'),
                        );
                      } finally {
                        if (getAccessSessionGeneration() === session) setIsIssuingFunding(false);
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
                Все подотчётные счета <span className="ui-text-muted">({visibleAccountItems.length})</span>
              </summary>

              {visibleAccountItems.length === 0 ? (
                <div className="ui-text-muted">
                  Пока нет пользователей с открытым или ранее использованным подотчетом. Выберите пользователя выше, чтобы проверить его счёт.
                </div>
              ) : (
                <div className="record-list">
                  {visibleAccountItems.map((item) => (
                    <button
                      key={item.accountId}
                      type="button"
                      disabled={isIssuingFunding}
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
                        selectReviewedUser(item.user.id);
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
        {canDiscoverAccountabilityReview ? (
          reviewLoading ? (
            <Surface padding="md">Загрузка подотчёта пользователя…</Surface>
          ) : reviewError ? (
            <Alert tone="danger" role="alert">
              {reviewError}
            </Alert>
          ) : freshReviewView && selectedUser ? (
            <AccountabilityAccountPanel
              title={
                selectedUser
                  ? `Подотчет пользователя: ${getUserDisplayName(selectedUser)}`
                  : 'Подотчет пользователя'
              }
              view={freshReviewView}
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
                  const generation = getAccessGeneration();
                  const result = await approveAccountabilityExpense(expenseId);
                  if (acknowledgeIfAccessChanged(result, generation, 'Расход подтверждён.')) return;
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
                  const generation = getAccessGeneration();
                  const result = await rejectAccountabilityExpense(expenseId, comment);
                  if (acknowledgeIfAccessChanged(result, generation, 'Расход отклонён.')) return;
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
                  const generation = getAccessGeneration();
                  const result = await reverseExternalAccountabilityReceipt(fundingId, reason);
                  if (acknowledgeIfAccessChanged(result, generation, 'Сторно сохранено.')) return;
                  await reloadAfterAccountChange(freshReviewView.account.user.id);
                } catch (error) {
                  setActionError(getErrorMessage(error, 'Не удалось сторнировать внешнее поступление.'));
                  throw error;
                }
              }}
            />
          ) : <EmptyState title={selectedUserId ? 'Подотчёт пользователя пока не открыт' : 'Выберите пользователя'} description={selectedUserId ? (canIssueAccountabilityFunds ? 'Это не нулевой остаток. Для начала работы используйте выдачу средств выше.' : 'Счёт появляется при начале работы с подотчётом. Выдача средств доступна пользователю с соответствующим правом.') : 'Выберите пользователя выше, чтобы просмотреть его подотчёт.'} />
        ) : null}
        </section>
        ) : null}
      </div>
    </>
  );
}
