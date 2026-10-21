'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  changeOneTimeOrderStatus,
  checkOneTimeOrderConflicts,
  createOneTimeOrderComment,
  clearOneTimeOrderReview,
  getOneTimeOrderById,
  listOneTimeOrderComments,
  updateOneTimeOrderReview,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  OneTimeOrderCommentItem,
  OneTimeOrderItem,
  OneTimeOrderListItem,
} from '@/entities/one-time-order/model/one-time-order.types';
import { ApiError } from '@/shared/api/fetcher';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  getOneTimeOrderConflictTypeLabel,
  getOneTimeOrderPlannedPaymentMethodLabel,
  getOneTimeOrderStatusLabel,
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from '@/shared/lib/one-time-order-presentation';
import { ConfirmDialog } from '@/shared/ui/overlays';

import styles from './one-time-order-preview-drawer.module.css';
import { Button } from '@/shared/ui/foundation';

function formatExecutionDates(start: string | null, end: string | null): string {
  if (!start) return 'Даты не указаны';
  const format = (value: string, withYear: boolean): string => {
    const [year = 1970, month = 1, day = 1] = value.slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(year, month - 1, day));
  };
  if (!end || end === start) return format(start, true);
  return `${format(start, false)} – ${format(end, true)}`;
}

function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined
    ? 'Не указана'
    : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getReviewFailureMessage(error: unknown, action: string): string {
  if (error instanceof ApiError && error.statusCode === 403) {
    return 'Недостаточно прав для изменения отзыва.';
  }
  if (error instanceof ApiError && error.statusCode === 404) {
    return 'Заказ не найден или больше недоступен.';
  }
  if (error instanceof ApiError && error.statusCode >= 500) {
    return `Не удалось ${action} отзыв. Возможно, требуется применить миграцию базы данных для оценок с шагом 0,5.`;
  }
  return `Не удалось ${action} отзыв. Проверьте данные и попробуйте ещё раз.`;
}

function confirmScheduleConflicts(
  conflicts: Array<{ date: string; type: string; user: { fullName: string } }>,
): boolean {
  const details = conflicts
    .filter((conflict) => conflict.type !== 'pending_availability_request')
    .slice(0, 8)
    .map((conflict) =>
      `${conflict.date} · ${conflict.user.fullName} · ${getOneTimeOrderConflictTypeLabel(conflict.type)}`,
    )
    .join('\n');
  return window.confirm(`Найдены конфликты расписания:\n${details}\n\nПродолжить?`);
}

export function OneTimeOrderPreviewDrawer({
  item,
  onClose,
}: {
  item: OneTimeOrderListItem | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const [details, setDetails] = useState<OneTimeOrderItem | null>(null);
  const [comments, setComments] = useState<OneTimeOrderCommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState('');
  const [reviewRatingDraft, setReviewRatingDraft] = useState<number | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [clearReviewConfirmOpen, setClearReviewConfirmOpen] = useState(false);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!item) {
      setDetails(null);
      setComments([]);
      setError(null);
      setNotice(null);
      setCommentDraft('');
      setReviewDraft('');
      setReviewRatingDraft(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setDetails(null);
    setComments([]);
    setNextStatus('');

    void Promise.all([
      getOneTimeOrderById(item.id),
      listOneTimeOrderComments(item.id).catch(() => []),
    ]).then(([order, orderComments]) => {
      if (cancelled) return;
      setDetails(order);
      setComments(orderComments);
      setReviewDraft(order.capabilities.canEditReview ? order.reviewText ?? '' : '');
      setReviewRatingDraft(order.reviewRating);
    }).catch(() => {
      if (cancelled) return;
      setError('Не удалось загрузить данные заказа. Откройте полную карточку и попробуйте снова.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (statusMenuOpen) {
          setStatusMenuOpen(false);
          return;
        }
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [item, close, statusMenuOpen]);

  const managers = useMemo(
    () => item?.managers.map(getUserDisplayName).join(', ') || 'Не назначены',
    [item],
  );

  if (!item) return null;

  const order = details;
  const visibleComments = comments.slice(0, 3);
  const status = order?.status ?? item.status;
  const canComment = order?.capabilities.canComment ?? item.capabilities.canComment;
  const canEdit = order?.capabilities.canEdit ?? item.capabilities.canEdit;
  const canChangeStatus = order?.capabilities.canChangeStatus ?? item.capabilities.canChangeStatus;
  const canEditReview = order?.capabilities.canEditReview ?? false;
  const reviewText = (canEditReview ? order?.reviewText : item.reviewPreview)?.trim() || '';
  const allowedStatuses = ONE_TIME_ORDER_STATUS_OPTIONS.filter(
    (option) => option.value !== status && option.value !== 'completed',
  );

  const saveComment = async (): Promise<void> => {
    const content = commentDraft.trim();
    if (!content || !canComment || savingComment) return;
    setSavingComment(true);
    setError(null);
    setNotice(null);
    try {
      await createOneTimeOrderComment(item.id, { content });
      const refreshed = await listOneTimeOrderComments(item.id);
      setComments(refreshed);
      setCommentDraft('');
      setNotice('Комментарий добавлен.');
    } catch {
      setError('Не удалось добавить комментарий. Проверьте права доступа и попробуйте ещё раз.');
    } finally {
      setSavingComment(false);
    }
  };

  const saveReview = async (): Promise<void> => {
    if (!canEditReview || !order || savingReview) return;
    const text = reviewDraft.trim();
    if (!text) {
      setError('Введите текст отзыва.');
      return;
    }
    setSavingReview(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateOneTimeOrderReview(order.id, {
        reviewText: text || null,
        reviewRating: reviewRatingDraft,
      });
      setDetails(updated);
      setReviewDraft(updated.reviewText ?? '');
      setReviewRatingDraft(updated.reviewRating);
      setNotice('Отзыв сохранён.');
    } catch (saveError) {
      setError(getReviewFailureMessage(saveError, 'сохранить'));
    } finally {
      setSavingReview(false);
    }
  };

  const clearReview = async (): Promise<void> => {
    if (!canEditReview || !order || savingReview) return;
    setSavingReview(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await clearOneTimeOrderReview(order.id);
      setDetails(updated);
      setReviewDraft('');
      setReviewRatingDraft(null);
      setNotice('Отзыв удалён.');
      setClearReviewConfirmOpen(false);
    } catch (clearError) {
      setError(getReviewFailureMessage(clearError, 'удалить'));
    } finally {
      setSavingReview(false);
    }
  };

  const applyStatus = async (): Promise<void> => {
    if (!nextStatus || !canChangeStatus || !order || savingStatus) return;
    setSavingStatus(true);
    setError(null);
    setNotice(null);
    try {
      let conflictFingerprint: string | undefined;
      if (
        status === 'cancelled' &&
        nextStatus !== 'cancelled' &&
        order.executionStartDate &&
        order.executionEndDate &&
        order.managers.length > 0
      ) {
        const result = await checkOneTimeOrderConflicts({
          executionStartDate: order.executionStartDate,
          executionEndDate: order.executionEndDate,
          managerUserIds: order.managers.map((manager) => manager.userId),
          excludeOrderId: order.id,
        });
        if (result.hasConflicts) {
          const confirmed = confirmScheduleConflicts(result.conflicts);
          if (!confirmed) return;
          conflictFingerprint = result.conflictFingerprint;
        }
      }
      const updated = await changeOneTimeOrderStatus(order.id, nextStatus, conflictFingerprint);
      setDetails(updated);
      setNextStatus('');
      setStatusMenuOpen(false);
      setNotice(`Статус изменён: ${getOneTimeOrderStatusLabel(updated.status)}.`);
    } catch {
      setError('Не удалось изменить статус. Возможно, заказ уже обновлён или требуется проверить расписание.');
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={close}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`Быстрый просмотр заказа ${item.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <span className={styles.eyebrow}>Разовый заказ</span>
            <h2 className={styles.title}>{item.title}</h2>
            <span className={styles.address}>{item.executionAddress || 'Адрес не указан'}</span>
          </div>
          <button className={styles.closeButton} type="button" onClick={close} aria-label="Закрыть быстрый просмотр">×</button>
        </header>

        <div className={styles.statusRow}>
          <span className={styles.status} data-status={status}>
            <span className={styles.statusDot} aria-hidden="true" />
            {getOneTimeOrderStatusLabel(status)}
          </span>
          <span className={styles.date}>{formatExecutionDates(item.executionStartDate, item.executionEndDate)}</span>
        </div>

        {loading ? <div className={styles.notice} role="status">Загружаю данные заказа…</div> : null}
        {error ? <div className={`${styles.notice} ${styles.error}`} role="alert">{error}</div> : null}

        <section className={styles.section} aria-label="Основная информация">
          <h3 className={styles.sectionTitle}>Заказ</h3>
          <div className={styles.factGrid}>
            <Fact label="Контакт" value={order?.contactName || item.contact.name || 'Не указан'} />
            <div className={styles.fact}>
              <span>Телефон</span>
              {order?.contactPhone || item.contact.phone ? (
                <a className={styles.factLink} href={`tel:${order?.contactPhone ?? item.contact.phone}`}>
                  {order?.contactPhone ?? item.contact.phone}
                </a>
              ) : <strong>Не указан</strong>}
            </div>
            <Fact label="Менеджеры" value={managers} />
            <div className={styles.fact}>
              <span>Объект</span>
              {item.linkedObject?.canOpenObjectCard ? (
                <Link className={styles.factLink} href={`/objects/${item.linkedObject.id}`} onClick={close}>{item.linkedObject.name}</Link>
              ) : <strong>{item.linkedObject?.name || 'Не привязан'}</strong>}
            </div>
            {order?.description ? <Fact label="Описание" value={order.description} /> : null}
          </div>
        </section>

        <section className={styles.reviewSummary} aria-label="Отзыв клиента">
          <div className={styles.reviewHeading}>
            <h3 className={styles.sectionTitle}>Отзыв клиента</h3>
          </div>
          {reviewText ? <p className={styles.review}>{reviewText}</p> : <p className={styles.muted}>Текст отзыва пока не добавлен.</p>}
          {canEditReview ? (
            <form className={styles.reviewForm} onSubmit={(event) => { event.preventDefault(); void saveReview(); }}>
              <label className={styles.reviewLabel}>
                <span>Текст отзыва</span>
                <textarea
                  value={reviewDraft}
                  onChange={(event) => setReviewDraft(event.target.value)}
                  placeholder="Напишите отзыв клиента"
                  aria-label="Текст отзыва"
                  maxLength={5000}
                  rows={3}
                  disabled={savingReview}
                />
              </label>
              <div className={styles.reviewActions}>
                <Button variant="primary" type="submit" disabled={savingReview || !reviewDraft.trim()}>
                  {savingReview ? 'Сохраняю…' : 'Сохранить отзыв'}
                </Button>
                {order && (order.reviewText !== null || order.reviewRating !== null) ? (
                  <Button disabled={savingReview} onClick={() => setClearReviewConfirmOpen(true)}>
                    Удалить отзыв
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>

        {order ? (
          <section className={styles.section} aria-label="Условия оплаты">
            <h3 className={styles.sectionTitle}>Условия оплаты</h3>
            <div className={styles.factGrid}>
              <Fact label="Сумма заказа" value={formatMoney(order.agreedSum)} />
              <Fact label="Способ оплаты" value={order.plannedPaymentMethod ? getOneTimeOrderPlannedPaymentMethodLabel(order.plannedPaymentMethod) : 'Не указан'} />
              {order.financialNotes ? <Fact label="Финансовые заметки" value={order.financialNotes} /> : null}
              {order.expenseNotes ? <Fact label="Расходы" value={order.expenseNotes} /> : null}
            </div>
            <p className={styles.helper}>Поступления и подотчёт оформляются в штатном разделе завершения заказа.</p>
          </section>
        ) : null}

        <section className={styles.section} aria-label="Ход выполнения">
          <h3 className={styles.sectionTitle}>Выполнение</h3>
          <div className={styles.progressRow}>
            <span>Техническое задание</span>
            <strong>{item.specificationProgress.completed} из {item.specificationProgress.total}</strong>
          </div>
          <div className={styles.progressTrack} aria-label={`ТЗ: ${item.specificationProgress.completed} из ${item.specificationProgress.total}`}>
            <span style={{ width: `${item.specificationProgress.total ? Math.min(100, (item.specificationProgress.completed / item.specificationProgress.total) * 100) : 0}%` }} />
          </div>
          <div className={styles.progressRow}>
            <span>Доступные задачи</span>
            <strong>{item.accessibleTaskCount}</strong>
          </div>
        </section>

        {canChangeStatus && order ? (
          <section className={styles.section} aria-label="Быстрая смена статуса">
            <h3 className={styles.sectionTitle}>Быстрое действие</h3>
            <div className={styles.statusAction}>
              <div className={styles.statusPicker} onKeyDown={(event) => {
                if (event.key === 'Escape' && statusMenuOpen) {
                  event.stopPropagation();
                  setStatusMenuOpen(false);
                }
              }}>
                <button
                  className={styles.statusPickerTrigger}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={statusMenuOpen}
                  aria-label="Новый статус заказа"
                  disabled={savingStatus}
                  onClick={() => setStatusMenuOpen((open) => !open)}
                >
                  <span>{allowedStatuses.find((option) => option.value === nextStatus)?.label ?? 'Изменить статус…'}</span>
                  <span className={styles.statusPickerChevron} aria-hidden="true">⌄</span>
                </button>
                {statusMenuOpen ? (
                  <div className={styles.statusMenu} role="listbox" aria-label="Доступные статусы">
                    {allowedStatuses.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={nextStatus === option.value}
                        className={styles.statusMenuOption}
                        onClick={() => { setNextStatus(option.value); setStatusMenuOpen(false); }}
                      >
                        <span>{option.label}</span>
                        {nextStatus === option.value ? <span aria-hidden="true">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button disabled={!nextStatus || savingStatus} onClick={() => void applyStatus()}>
                {savingStatus ? 'Сохраняю…' : 'Применить'}
              </Button>
            </div>
            <p className={styles.helper}>Завершение заказа проводится в полной карточке вместе с учётом поступлений.</p>
          </section>
        ) : null}

        <section className={styles.section} aria-label="Комментарии к заказу">
          <div className={styles.sectionHeading}>
            <h3 className={styles.sectionTitle}>Комментарии</h3>
            {comments.length > 3 ? <Link href={`/one-time-orders/${item.id}`} onClick={close}>Все {comments.length}</Link> : null}
          </div>
          {visibleComments.length ? (
            <div className={styles.commentList}>
              {visibleComments.map((comment) => (
                <article className={styles.comment} key={comment.id}>
                  <div className={styles.commentMeta}><strong>{getUserDisplayName(comment.createdBy)}</strong><time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time></div>
                  <p>{comment.content}</p>
                </article>
              ))}
            </div>
          ) : <p className={styles.muted}>Комментариев пока нет.</p>}
          {canComment ? (
            <form className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void saveComment(); }}>
              <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Добавить комментарий к заказу" aria-label="Новый комментарий" maxLength={5000} />
              <Button type="submit" disabled={!commentDraft.trim() || savingComment}>
                {savingComment ? 'Добавляю…' : 'Добавить комментарий'}
              </Button>
            </form>
          ) : null}
        </section>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

        <footer className={styles.footer}>
          {canEdit ? <Link className={styles.secondaryAction} href={`/one-time-orders/${item.id}`} onClick={close}>Редактировать</Link> : null}
          <Link className={styles.primaryAction} href={`/one-time-orders/${item.id}`} onClick={close}>Открыть заказ</Link>
        </footer>
      </aside>
      <ConfirmDialog
        open={clearReviewConfirmOpen}
        onOpenChange={setClearReviewConfirmOpen}
        title="Удалить отзыв?"
        consequence="Будут удалены текст отзыва и сохранённая оценка. Это действие нельзя отменить."
        confirmLabel="Удалить отзыв"
        tone="danger"
        pending={savingReview}
        onConfirm={() => void clearReview()}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}
