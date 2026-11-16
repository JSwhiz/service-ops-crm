'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

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
  getOneTimeOrderPlannedPaymentMethodLabel,
  getOneTimeOrderStatusLabel,
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from '@/shared/lib/one-time-order-presentation';
import { ConfirmDialog } from '@/shared/ui/overlays';

import { CloseIcon } from '@/shared/ui/icons/icons';
import styles from './one-time-order-preview-drawer.module.css';
import { Button, IconButton } from '@/shared/ui/foundation';
import { ScheduleConflictList } from '@/entities/one-time-order/ui/schedule-conflicts';
import { PeopleList } from '@/shared/ui/person-presentation/person-presentation';

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

export function OneTimeOrderPreviewDrawer({
  item,
  onClose,
}: {
  item: OneTimeOrderListItem | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const accessRevision = useAccessRevision();
  const { capabilitiesRefreshError } = useAuth();
  const scope = `${item?.id ?? ''}:${accessRevision}:${capabilitiesRefreshError ?? ''}`;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [accessRetry, setAccessRetry] = useState(0);
  const [details, setDetails] = useState<OneTimeOrderItem | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{
    conflicts: Parameters<typeof ScheduleConflictList>[0]['conflicts'];
    isCurrent: () => boolean;
    resolve: (accepted: boolean) => void;
  } | null>(null);
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
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [commentFormOpen, setCommentFormOpen] = useState(false);
  const itemRef = useRef(item);
  itemRef.current = item;
  const draftItemId = useRef<string | null>(null);
  const itemGeneration = useRef(0);
  const reviewFormOpenRef = useRef(reviewFormOpen);
  reviewFormOpenRef.current = reviewFormOpen;
  const liveContext = useRef({ scope, ready: false, details });
  liveContext.current = { scope, ready: loadedScope === scope && !capabilitiesRefreshError && !loading, details };
  useEffect(() => {
    if (conflictPrompt && !conflictPrompt.isCurrent()) {
      conflictPrompt.resolve(false);
      setConflictPrompt(null);
      setSavingStatus(false);
    }
  }, [conflictPrompt, scope, details, loading, error]);
  useEffect(() => () => { liveContext.current = { ...liveContext.current, ready: false }; }, []);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const item = itemRef.current;
    const nextItemId = item?.id ?? null;
    if (draftItemId.current !== nextItemId) {
      draftItemId.current = nextItemId;
      itemGeneration.current += 1;
      // Only an access refresh for the same order may retain unsaved inputs.
      reviewFormOpenRef.current = false;
      setLoadedScope(null);
      setDetails(null);
      setComments([]);
      setError(null);
      setNotice(null);
      setCommentDraft('');
      setReviewDraft('');
      setReviewRatingDraft(null);
      setReviewFormOpen(false);
      setCommentFormOpen(false);
      setNextStatus('');
      setStatusMenuOpen(false);
      setClearReviewConfirmOpen(false);
      setSavingComment(false);
      setSavingReview(false);
      setSavingStatus(false);
    }
    if (!item) { setLoading(false); return; }
    if (capabilitiesRefreshError) { setLoadedScope(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    void getOneTimeOrderById(item.id).then(async (order) => {
      const orderComments = order.capabilities.canReadComments === false ? [] : await listOneTimeOrderComments(item.id);
      if (cancelled) return;
      setDetails(order);
      setComments(orderComments);
      if (!reviewFormOpenRef.current) {
        setReviewDraft(order.capabilities.canEditReview ? order.reviewText ?? '' : '');
        setReviewRatingDraft(order.reviewRating);
      }
      setLoadedScope(scope);
    }).catch(() => {
      if (cancelled) return;
      setError('Не удалось загрузить данные заказа. Откройте полную карточку и попробуйте снова.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [scope, accessRetry]);

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

  if (!item) return null;

  const order = details;
  const executionStartDate = order ? order.executionStartDate : item.executionStartDate;
  const executionEndDate = order ? order.executionEndDate : item.executionEndDate;
  const managers = order ? order.managers : item.managers;
  const visibleComments = comments.slice(0, 3);
  const status = order?.status ?? item.status;
  const canComment = order?.capabilities.canComment ?? item.capabilities.canComment;
  const canEditOperationalFields = order?.capabilities.canEditOperationalFields ?? item.capabilities.canEditOperationalFields;
  const canChangeStatus = order?.capabilities.canChangeStatus ?? item.capabilities.canChangeStatus;
  const canEditReview = order?.capabilities.canEditReview ?? false;
  const canDeleteReview = order ? order.capabilities.canDeleteReview ?? order.capabilities.canEditReview : false;
  const reviewText = order?.reviewText?.trim() || '';
  const allowedStatuses = ONE_TIME_ORDER_STATUS_OPTIONS.filter(
    (option) => option.value !== status && option.value !== 'completed',
  );

  const captureItemOperation = (): (() => boolean) => {
    const generation = itemGeneration.current;
    const accessGeneration = getAccessGeneration();
    return () => generation === itemGeneration.current && itemRef.current?.id === item.id &&
      isAccessGenerationCurrent(accessGeneration) && liveContext.current.ready && liveContext.current.scope === scope;
  };

  const saveComment = async (): Promise<void> => {
    const content = commentDraft.trim();
    if (!content || !canComment || savingComment || loadedScope !== scope) return;
    const isCurrentItem = captureItemOperation();
    setSavingComment(true);
    setError(null);
    setNotice(null);
    try {
      await createOneTimeOrderComment(item.id, { content });
      if (!isCurrentItem()) return;
      const refreshed = await listOneTimeOrderComments(item.id);
      if (!isCurrentItem()) return;
      setComments(refreshed);
      setCommentDraft('');
      setNotice('Комментарий добавлен.');
    } catch {
      if (!isCurrentItem()) return;
      setError('Не удалось добавить комментарий. Проверьте права доступа и попробуйте ещё раз.');
    } finally {
      if (isCurrentItem()) setSavingComment(false);
    }
  };

  const saveReview = async (): Promise<void> => {
    if (!canEditReview || !order || savingReview || loadedScope !== scope) return;
    const isCurrentItem = captureItemOperation();
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
      if (!isCurrentItem()) return;
      setDetails(updated);
      setReviewDraft(updated.reviewText ?? '');
      setReviewRatingDraft(updated.reviewRating);
      setNotice('Отзыв сохранён.');
    } catch (saveError) {
      if (!isCurrentItem()) return;
      setError(getReviewFailureMessage(saveError, 'сохранить'));
    } finally {
      if (isCurrentItem()) setSavingReview(false);
    }
  };

  const clearReview = async (): Promise<void> => {
    if (!canDeleteReview || !order || savingReview || loadedScope !== scope) return;
    const isCurrentItem = captureItemOperation();
    setSavingReview(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await clearOneTimeOrderReview(order.id);
      if (!isCurrentItem()) return;
      setDetails(updated);
      setReviewDraft('');
      setReviewRatingDraft(null);
      setNotice('Отзыв удалён.');
      setClearReviewConfirmOpen(false);
    } catch (clearError) {
      if (!isCurrentItem()) return;
      setError(getReviewFailureMessage(clearError, 'удалить'));
    } finally {
      if (isCurrentItem()) setSavingReview(false);
    }
  };

  const applyStatus = async (): Promise<void> => {
    if (!nextStatus || !canChangeStatus || !order || savingStatus || loadedScope !== scope) return;
    const isCurrentItem = captureItemOperation();
    const isCurrentStatus = (): boolean => isCurrentItem() && liveContext.current.details?.capabilities.canChangeStatus === true &&
      liveContext.current.details === order && liveContext.current.details.status === order.status;
    if (!isCurrentStatus()) return;
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
        if (!isCurrentItem() || !isCurrentStatus()) return;
        if (result.hasConflicts) {
          const confirmed = await new Promise<boolean>((resolve) => setConflictPrompt({ conflicts: result.conflicts, isCurrent: isCurrentStatus, resolve }));
          if (!confirmed || !isCurrentItem() || !isCurrentStatus()) return;
          conflictFingerprint = result.conflictFingerprint;
        }
      }
      if (!isCurrentItem() || !isCurrentStatus()) return;
      const updated = await changeOneTimeOrderStatus(order.id, nextStatus, conflictFingerprint);
      if (!isCurrentItem()) return;
      setDetails(updated);
      setNextStatus('');
      setStatusMenuOpen(false);
      setNotice(`Статус изменён: ${getOneTimeOrderStatusLabel(updated.status)}.`);
    } catch {
      if (!isCurrentItem()) return;
      setError('Не удалось изменить статус. Возможно, заказ уже обновлён или требуется проверить расписание.');
    } finally {
      if (isCurrentItem()) setSavingStatus(false);
    }
  };

  return (
    <>
    <ConfirmDialog
      open={conflictPrompt !== null && conflictPrompt.isCurrent()}
      onOpenChange={(open) => { if (!open) { conflictPrompt?.resolve(false); setConflictPrompt(null); } }}
      title="Есть конфликты расписания"
      consequence={conflictPrompt ? <ScheduleConflictList conflicts={conflictPrompt.conflicts} /> : null}
      confirmLabel="Изменить статус"
      onConfirm={() => { conflictPrompt?.resolve(conflictPrompt.isCurrent()); setConflictPrompt(null); }}
    />
    <div className={styles.backdrop} role="presentation" onMouseDown={close}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={loadedScope === scope ? `Быстрый просмотр заказа ${item.title}` : 'Проверка доступа к заказу'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <span className={styles.eyebrow}>Разовый заказ</span>
            <h2 className={styles.title}>{loadedScope === scope ? item.title : 'Проверка доступа…'}</h2>
            {loadedScope === scope ? <span className={styles.address}>{item.executionAddress || 'Адрес не указан'}</span> : null}
          </div>
          <IconButton aria-label="Закрыть быстрый просмотр" title="Закрыть" onClick={close}><CloseIcon size={18} /></IconButton>
        </header>

        {loadedScope !== scope ? <div className={styles.notice} role="status">{error || 'Обновляем доступ к заказу…'}{error ? <Button onClick={() => setAccessRetry((value) => value + 1)}>Повторить проверку доступа</Button> : null}</div> : null}
        <AccessSnapshotBoundary blocked={loadedScope !== scope}>
        <div className={styles.statusRow}>
          <span className={styles.status} data-status={status}>
            <span className={styles.statusDot} aria-hidden="true" />
            {getOneTimeOrderStatusLabel(status)}
          </span>
          <span className={styles.date}>{formatExecutionDates(executionStartDate, executionEndDate)}</span>
        </div>
        {!executionStartDate || !executionEndDate || managers.length === 0 ? (
          <div className={styles.warnings} aria-label="Требует внимания">
            {!executionStartDate || !executionEndDate ? <span className={styles.warning}>{!executionStartDate ? 'Даты не указаны' : 'Дата окончания не указана'}</span> : null}
            {managers.length === 0 ? <span className={styles.warning}>Менеджеры не назначены</span> : null}
          </div>
        ) : null}

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
            <Fact label="Менеджеры" value={managers.length ? <PeopleList people={managers} compact={false} label="Менеджеры заказа" /> : 'Не назначены'} />
            <div className={styles.fact}>
              <span>Объект</span>
              {item.linkedObject?.canOpenObjectCard ? (
                <Link className={styles.factLink} href={`/objects/${item.linkedObject.id}`} onClick={close}>{item.linkedObject.name}</Link>
              ) : <strong>{item.linkedObject?.name || 'Не привязан'}</strong>}
            </div>
            {order?.description ? <Fact label="Описание" value={order.description} /> : null}
          </div>
        </section>

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
          <div className={styles.sectionLinks}>
            <Link className={styles.sectionLink} href={`/one-time-orders/${item.id}?section=execution#one-time-order-specification`} onClick={close}>Открыть работы и ТЗ</Link>
            <Link className={styles.sectionLink} href={`/one-time-orders/${item.id}?section=execution#one-time-order-tasks`} onClick={close}>Открыть задачи</Link>
            <Link className={styles.sectionLink} href={`/one-time-orders/${item.id}?section=materials`} onClick={close}>Открыть материалы</Link>
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
            {comments.length > 3 ? <Link href={`/one-time-orders/${item.id}?section=discussion`} onClick={close}>Все {comments.length}</Link> : null}
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
            <>
              <Button onClick={() => setCommentFormOpen((open) => !open)} aria-expanded={commentFormOpen} aria-controls="one-time-order-preview-comment-form">{commentFormOpen ? 'Скрыть форму' : 'Добавить комментарий'}</Button>
              {commentFormOpen ? <form id="one-time-order-preview-comment-form" className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void saveComment(); }}>
              <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Добавить комментарий к заказу" aria-label="Новый комментарий" maxLength={5000} />
              <Button type="submit" disabled={!commentDraft.trim() || savingComment}>
                {savingComment ? 'Добавляю…' : 'Сохранить комментарий'}
              </Button>
              </form> : null}
            </>
          ) : null}
        </section>

        {order && order.capabilities.canReadFinance !== false ? (
          <section className={styles.section} aria-label="Условия оплаты">
            <h3 className={styles.sectionTitle}>Условия оплаты</h3>
            <div className={styles.factGrid}>
              <Fact label="Плановая сумма заказа" value={formatMoney(order.agreedSum)} />
              <Fact label="Способ оплаты" value={order.plannedPaymentMethod ? getOneTimeOrderPlannedPaymentMethodLabel(order.plannedPaymentMethod) : 'Не указан'} />
              {order.financialNotes ? <Fact label="Финансовые заметки" value={order.financialNotes} /> : null}
              {order.expenseNotes ? <Fact label="Расходы" value={order.expenseNotes} /> : null}
            </div>
            <p className={styles.helper}>Это плановые условия заказа. Полученные платежи и подотчёт смотрите в разделе финансов полной карточки.</p>
            <Link className={styles.sectionLink} href={`/one-time-orders/${item.id}?section=finance`} onClick={close}>Открыть финансы</Link>
          </section>
        ) : null}

        <section className={styles.reviewSummary} aria-label="Отзыв клиента">
          <div className={styles.reviewHeading}>
            <h3 className={styles.sectionTitle}>Отзыв клиента</h3>
            {canEditReview ? <Button onClick={() => setReviewFormOpen((open) => !open)} aria-expanded={reviewFormOpen} aria-controls="one-time-order-preview-review-form">{reviewFormOpen ? 'Скрыть форму' : reviewText ? 'Изменить отзыв' : 'Добавить отзыв'}</Button> : null}
            {canDeleteReview && !reviewFormOpen && order && (order.reviewText !== null || order.reviewRating !== null) ? <Button disabled={savingReview} onClick={() => setClearReviewConfirmOpen(true)}>Удалить отзыв</Button> : null}
          </div>
          {reviewText ? <p className={styles.review}>{reviewText}</p> : <p className={styles.muted}>Текст отзыва пока не добавлен.</p>}
          {canEditReview && reviewFormOpen ? (
            <form id="one-time-order-preview-review-form" className={styles.reviewForm} onSubmit={(event) => { event.preventDefault(); void saveReview(); }}>
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
              <label className={styles.reviewLabel}>
                <span>Оценка клиента (0,5–5)</span>
                <input type="number" min="0.5" max="5" step="0.5" value={reviewRatingDraft ?? ''} onChange={(event) => setReviewRatingDraft(event.target.value ? Number(event.target.value) : null)} disabled={savingReview} />
              </label>
              <div className={styles.reviewActions}>
                <Button variant="primary" type="submit" disabled={savingReview || !reviewDraft.trim()}>
                  {savingReview ? 'Сохраняю…' : 'Сохранить отзыв'}
                </Button>
                {canDeleteReview && order && (order.reviewText !== null || order.reviewRating !== null) ? (
                  <Button disabled={savingReview} onClick={() => setClearReviewConfirmOpen(true)}>
                    Удалить отзыв
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

        <footer className={styles.footer}>
          {canEditOperationalFields ? <Link className={styles.secondaryAction} href={`/one-time-orders/${item.id}?section=overview&edit=1`} onClick={close}>Редактировать</Link> : null}
          <Link className={styles.primaryAction} href={`/one-time-orders/${item.id}`} onClick={close}>Открыть заказ</Link>
        </footer>
        </AccessSnapshotBoundary>
      </aside>
      <AccessSnapshotBoundary blocked={loadedScope !== scope}>
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
      </AccessSnapshotBoundary>
    </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <div className={styles.factValue} title={typeof value === 'string' ? value : undefined}>{value}</div>
    </div>
  );
}
