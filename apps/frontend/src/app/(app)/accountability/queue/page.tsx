'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import {
  getAccountabilityAccountByUserId,
  listAccountabilityAccounts,
} from '@/entities/accountability/api/accountability-client';
import type {
  AccountabilityAccountView,
  AccountabilityExpenseItem,
  AccountabilityFundingEntry,
} from '@/entities/accountability/model/accountability.types';
import { useAuth } from '@/shared/auth/use-auth';
import {
  getAccountabilityExpenseStatusLabel,
  getAccountabilityFundingTypeLabel,
} from '@/shared/lib/accountability-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './queue.module.css';

type QueueView = 'submitted' | 'closing' | 'one_time_receipts';

type ExpenseRow = { account: AccountabilityAccountView; expense: AccountabilityExpenseItem };
type FundingRow = { account: AccountabilityAccountView; funding: AccountabilityFundingEntry };

function parseView(value: string | null): QueueView {
  if (value === 'closing' || value === 'one_time_receipts') return value;
  return 'submitted';
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export default function AccountabilityQueuePage(): React.JSX.Element {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const canReview = user?.capabilities?.canReviewAccountability ?? false;
  const [accounts, setAccounts] = useState<AccountabilityAccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReview) {
      setLoading(false);
      setAccounts([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void listAccountabilityAccounts()
      .then((items) => Promise.all(items.map((item) => getAccountabilityAccountByUserId(item.user.id))))
      .then((details) => {
        if (!cancelled) setAccounts(details);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить финансовую очередь.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canReview]);

  const submitted = useMemo<ExpenseRow[]>(
    () => accounts.flatMap((account) => account.expenses
      .filter((expense) => expense.status === 'submitted')
      .map((expense) => ({ account, expense }))),
    [accounts],
  );

  const closing = useMemo(
    () => accounts
      .filter((account) => account.account.status === 'closing_requested')
      .map((account) => ({
        account,
        closure: account.closures.find((item) => item.status === 'requested') ?? account.closures[0] ?? null,
      })),
    [accounts],
  );

  const receipts = useMemo<FundingRow[]>(
    () => accounts.flatMap((account) => account.fundings
      .filter((funding) => funding.fundingType === 'one_time_order_receipt' && funding.entryDirection === 'credit')
      .map((funding) => ({ account, funding })))
      .sort((a, b) => b.funding.issuedAt.localeCompare(a.funding.issuedAt)),
    [accounts],
  );

  const title = view === 'closing'
    ? 'Закрытие подотчёта'
    : view === 'one_time_receipts'
      ? 'Приход по разовым заказам'
      : 'Расходы на проверке';

  const total = view === 'closing' ? closing.length : view === 'one_time_receipts' ? receipts.length : submitted.length;
  const amount = view === 'one_time_receipts'
    ? receipts.reduce((sum, item) => sum + Number(item.funding.amount), 0)
    : view === 'submitted'
      ? submitted.reduce((sum, item) => sum + Number(item.expense.amount), 0)
      : null;

  if (!canReview) {
    return <div className={styles.notice}>У вас нет права просмотра общей финансовой очереди.</div>;
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <div className={styles.actions}>
          <span className={styles.filterChip}>{title}<Link href="/accountability" aria-label="Снять фильтр">×</Link></span>
          <Link className={styles.secondaryAction} href="/accountability">Весь подотчёт</Link>
        </div>
      </header>

      <section className={styles.summary}>
        <div><span>Записей</span><strong>{loading ? '—' : total}</strong></div>
        {amount !== null ? <div><span>Сумма</span><strong>{loading ? '—' : formatMoney(amount)}</strong></div> : null}
      </section>

      {error ? <div className={styles.notice}>{error}</div> : null}
      {loading ? <div className={styles.empty}>Загружаем выборку…</div> : null}

      {!loading && view === 'submitted' ? (
        <div className={styles.list}>
          {submitted.length === 0 ? <div className={styles.empty}>Расходов на проверке нет.</div> : submitted.map(({ account, expense }) => (
            <article className={styles.row} key={expense.id}>
              <div className={styles.rowMain}>
                <strong>{formatMoney(expense.amount)}</strong>
                <span>{expense.description}</span>
                <small>{getUserDisplayName(account.account.user)} · {formatDate(expense.submittedAt ?? expense.createdAt)}</small>
              </div>
              <div className={styles.rowMeta}>
                <span>{getAccountabilityExpenseStatusLabel(expense.status)}</span>
                <Link href="/accountability">Открыть подотчёт →</Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && view === 'closing' ? (
        <div className={styles.list}>
          {closing.length === 0 ? <div className={styles.empty}>Запросов на закрытие нет.</div> : closing.map(({ account, closure }) => (
            <article className={styles.row} key={account.account.id ?? account.account.user.id}>
              <div className={styles.rowMain}>
                <strong>{getUserDisplayName(account.account.user)}</strong>
                <span>Текущий остаток: {formatMoney(account.summary.currentBalance)}</span>
                <small>{closure ? `Запрошено ${formatDate(closure.requestedAt)}` : 'Ожидает сверки'}</small>
              </div>
              <div className={styles.rowMeta}>
                <span>Ожидает решения</span>
                {closure ? (
                  <Link href={`/approvals?status=pending&sourceEntityType=accountability_closure&sourceEntityId=${closure.id}`}>
                    Открыть согласование →
                  </Link>
                ) : (
                  <Link href="/accountability">Открыть подотчёт →</Link>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && view === 'one_time_receipts' ? (
        <div className={styles.list}>
          {receipts.length === 0 ? <div className={styles.empty}>Поступлений по разовым заказам нет.</div> : receipts.map(({ account, funding }) => (
            <article className={styles.row} key={funding.id}>
              <div className={styles.rowMain}>
                <strong>+{formatMoney(Number(funding.amount))}</strong>
                <span>{getAccountabilityFundingTypeLabel(funding.fundingType)}</span>
                <small>{getUserDisplayName(account.account.user)} · {formatDate(funding.issuedAt)}</small>
              </div>
              <div className={styles.rowMeta}>
                {funding.comment ? <span>{funding.comment}</span> : null}
                {funding.oneTimeOrderId ? <Link href={`/one-time-orders/${funding.oneTimeOrderId}`}>Открыть заказ →</Link> : <Link href="/accountability">Открыть подотчёт →</Link>}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
