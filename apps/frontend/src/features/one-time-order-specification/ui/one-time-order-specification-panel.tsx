'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

import { uploadFileToEntity } from '@/entities/file/api/file-client';
import {
  applyOneTimeOrderSpecificationCatalog,
  completeOneTimeOrderSpecificationItem,
  createOneTimeOrderSpecificationComment,
  createOneTimeOrderSpecificationItem,
  detachOneTimeOrderSpecificationAttachment,
  deleteOneTimeOrderSpecificationItem,
  listOneTimeOrderSpecificationComments,
  listOneTimeOrderSpecificationItems,
  listSpecificationCatalog,
  listSpecificationTemplates,
  reopenOneTimeOrderSpecificationItem,
  reorderOneTimeOrderSpecificationItems,
  updateOneTimeOrderSpecificationItem,
} from '@/entities/one-time-order/api/one-time-order-client';
import type { SpecificationCatalogItem, SpecificationTemplate } from '@/entities/one-time-order/api/one-time-order-client';
import { ApiError } from '@/shared/api/fetcher';
import type { OneTimeOrderSpecificationComment, OneTimeOrderSpecificationItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';
import { ConfirmDialog, Dialog } from '@/shared/ui/overlays';
import { Alert, Button, EmptyState, Field, LoadingState, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

export function OneTimeOrderSpecificationPanel({
  orderId,
  canManage,
  canEditStructure,
  orderStatus,
  onOpenDailyReport,
}: {
  orderId: string;
  /** Assigned manager's execution scope: complete/reopen and attach evidence. */
  canManage: boolean;
  /** Leadership-only scope for creating and structurally editing the snapshot. */
  canEditStructure: boolean;
  orderStatus: string;
  onOpenDailyReport?: () => void;
}): React.JSX.Element {
  const [items, setItems] = useState<OneTimeOrderSpecificationItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [itemFilter, setItemFilter] = useState<'all' | 'incomplete' | 'completed'>('all');
  const formId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OneTimeOrderSpecificationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<SpecificationCatalogItem[]>([]);
  const [templates, setTemplates] = useState<SpecificationTemplate[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [selectedCatalogItemIds, setSelectedCatalogItemIds] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [applyReason, setApplyReason] = useState('');
  const [isApplyingCatalog, setIsApplyingCatalog] = useState(false);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [commentsByItem, setCommentsByItem] = useState<Record<string, OneTimeOrderSpecificationComment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<Record<string, boolean>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string | null>>({});
  const [postingComments, setPostingComments] = useState<Record<string, boolean>>({});
  const [attachmentTarget, setAttachmentTarget] = useState<{ item: OneTimeOrderSpecificationItem; fileId: string; fileName: string } | null>(null);
  const [isDetachingAttachment, setIsDetachingAttachment] = useState(false);
  const commentRequests = useRef<Record<string, { requestId: string; content: string }>>({});
  const commentPosting = useRef(new Set<string>());
  const mounted = useRef(true);
  const activeOrderId = useRef(orderId);
  activeOrderId.current = orderId;
  const pendingApplies = useRef<Record<string, Parameters<typeof applyOneTimeOrderSpecificationCatalog>[1]>>({});
  const catalogLoadVersion = useRef(0);
  const [hasPendingApply, setHasPendingApply] = useState(false);
  const canEditCurrentStructure = canEditStructure && orderStatus !== 'completed' && orderStatus !== 'cancelled';
  const canExecute = canManage && orderStatus !== 'completed' && orderStatus !== 'cancelled';

  const load = async (): Promise<void> => {
    setItems(await listOneTimeOrderSpecificationItems(orderId));
  };

  useEffect(() => {
    mounted.current = true;
    setOpenCommentsFor(null);
    setCommentsByItem({});
    setCommentDrafts({});
    setCommentLoading({});
    setCommentErrors({});
    setPostingComments({});
    commentRequests.current = {};
    commentPosting.current.clear();
    return () => { mounted.current = false; };
  }, [orderId]);

  useEffect(() => {
    void load()
      .catch(() => setError('Не удалось загрузить техническое задание.'))
      .finally(() => setIsLoading(false));
  }, [orderId]);

  useEffect(() => {
    if (isFormOpen) titleInput.current?.focus();
  }, [isFormOpen, editingId]);

  const refreshCatalog = async (requestOrderId: string): Promise<void> => {
    const version = ++catalogLoadVersion.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [nextTemplates, nextItems] = await Promise.all([listSpecificationTemplates(), listSpecificationCatalog()]);
      if (mounted.current && activeOrderId.current === requestOrderId && catalogLoadVersion.current === version) {
        setTemplates(nextTemplates.filter((template) => !template.isArchived));
        setCatalogItems(nextItems.filter((item) => !item.isArchived));
      }
    } catch {
      if (mounted.current && activeOrderId.current === requestOrderId && catalogLoadVersion.current === version) {
        setCatalogError('Не удалось загрузить каталог. Закройте окно и попробуйте снова.');
      }
    } finally {
      if (mounted.current && activeOrderId.current === requestOrderId && catalogLoadVersion.current === version) setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (!isCatalogOpen) return;
    setHasPendingApply(Boolean(pendingApplies.current[orderId]));
    void refreshCatalog(orderId);
  }, [isCatalogOpen]);

  const completedCount = items.filter((item) => item.isCompleted).length;
  const visibleItems = items.filter((item) => itemFilter === 'all' || item.isCompleted === (itemFilter === 'completed'));
  const commentKey = (itemId: string): string => `${orderId}:${itemId}`;
  const mergeComments = (key: string, incoming: OneTimeOrderSpecificationComment[]): void => {
    setCommentsByItem((current) => {
      const byId = new Map((current[key] ?? []).map((comment) => [comment.id, comment]));
      incoming.forEach((comment) => byId.set(comment.id, comment));
      return { ...current, [key]: [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
    });
  };
  const refreshComments = async (itemId: string, key = commentKey(itemId)): Promise<OneTimeOrderSpecificationComment[]> => {
    const requestOrderId = orderId;
    const comments = await listOneTimeOrderSpecificationComments(requestOrderId, itemId);
    if (mounted.current && activeOrderId.current === requestOrderId) mergeComments(key, comments);
    return comments;
  };
  const selectedCatalogIds = new Set(selectedCatalogItemIds);
  const selectedTemplateIdsSet = new Set(selectedTemplateIds);
  const proposedItems = [
    ...templates
      .filter((template) => selectedTemplateIdsSet.has(template.id))
      .flatMap((template) => template.items),
    ...catalogItems
      .filter((catalogItem) => selectedCatalogIds.has(catalogItem.id))
      .map((catalogItem) => ({
        catalogItemId: catalogItem.id,
        title: catalogItem.title,
        description: catalogItem.description,
        sortOrder: catalogItem.sortOrder,
      })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.catalogItemId === item.catalogItemId) === index);
  const normalizeTitle = (value: string): string =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  const existingTitles = new Set(items.map((item) => normalizeTitle(item.title)));
  const matchingExistingCount = proposedItems.filter((item) => existingTitles.has(normalizeTitle(item.title))).length;

  const closeCatalog = (): void => {
    setIsCatalogOpen(false);
    if (!pendingApplies.current[orderId]) {
      setSelectedTemplateIds([]);
      setSelectedCatalogItemIds([]);
      setApplyReason('');
      setCatalogError(null);
    }
  };

  const submitCatalogApply = async (): Promise<void> => {
    if (isApplyingCatalog || catalogLoading) return;
    const requestOrderId = orderId;
    setCatalogError(null);
    setIsApplyingCatalog(true);
    let request = pendingApplies.current[requestOrderId];
    if (!request) {
      request = {
        requestId: crypto.randomUUID(),
        templateIds: [...selectedTemplateIds],
        catalogItemIds: [...selectedCatalogItemIds],
        expectedTemplateVersions: templates
          .filter((template) => selectedTemplateIdsSet.has(template.id))
          .map(({ id, version }) => ({ templateId: id, version })),
        expectedCatalogItems: catalogItems
          .filter((catalogItem) => selectedCatalogIds.has(catalogItem.id))
          .map(({ id, updatedAt }) => ({ catalogItemId: id, updatedAt })),
        ...(orderStatus === 'in_progress' ? { reason: applyReason.trim() } : {}),
      };
      pendingApplies.current[requestOrderId] = request;
    }
    try {
      await applyOneTimeOrderSpecificationCatalog(requestOrderId, request);
    } catch (caught) {
      const isDefiniteClientError = caught instanceof ApiError && caught.statusCode >= 400 && caught.statusCode < 500;
      if (isDefiniteClientError) {
        delete pendingApplies.current[requestOrderId];
        if (mounted.current && activeOrderId.current === requestOrderId) setHasPendingApply(false);
        if (caught instanceof ApiError && caught.statusCode === 409) {
          await refreshCatalog(requestOrderId);
          if (mounted.current && activeOrderId.current === requestOrderId) {
            setCatalogError('Каталог изменился: прежний состав не применён. Проверьте обновлённые пункты и шаблоны, затем отправьте выбранный состав заново.');
          }
        } else if (mounted.current && activeOrderId.current === requestOrderId) {
          setCatalogError(caught instanceof ApiError && caught.statusCode < 500
            ? caught.message
            : 'Сервер отклонил состав. Проверьте выбор и отправьте его заново.');
        }
      } else if (mounted.current && activeOrderId.current === requestOrderId) {
        setHasPendingApply(true);
        setCatalogError('Предыдущая отправка не подтверждена. Проверьте результат или повторите исходный запрос; выбранный состав пока заблокирован.');
      }
      if (mounted.current && activeOrderId.current === requestOrderId) setIsApplyingCatalog(false);
      return;
    }
    if (!mounted.current || activeOrderId.current !== requestOrderId) return;
    delete pendingApplies.current[requestOrderId];
    setHasPendingApply(false);
    try { await load(); } catch { setError('Не удалось обновить пункты после добавления из каталога.'); }
    closeCatalog();
    setIsApplyingCatalog(false);
  };

  const resetForm = (): void => {
    setTitle('');
    setDescription('');
    setEditingId(null);
    setIsFormOpen(false);
  };

  const moveItem = async (index: number, direction: -1 | 1): Promise<void> => {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const nextItems = [...items];
    const [moved] = nextItems.splice(index, 1);

    if (!moved) {
      return;
    }

    nextItems.splice(targetIndex, 0, moved);
    setItems(nextItems);
    try {
      setItems(
        await reorderOneTimeOrderSpecificationItems(
          orderId,
          nextItems.map((item) => item.id),
        ),
      );
    } catch {
      setError('Не удалось изменить порядок пунктов.');
      await load();
    }
  };

  return (
    <>
    <Surface as="section" padding="md" className="ui-stack ui-stack--lg">
      <div className="ui-section-header">
        <div>
          <h2 className="ui-section-title">Техническое задание</h2>
          <div className="ui-section-subtitle">
            {isLoading ? 'Загрузка пунктов…' : `Выполнено ${completedCount} из ${items.length}`}
          </div>
        </div>
        <div className="ui-inline">
          {onOpenDailyReport ? <Button variant="ghost" onClick={onOpenDailyReport}>К дневному отчёту</Button> : null}
          {canEditCurrentStructure ? (
          <>
            <Button disabled={isBusy || isLoading || isFormOpen || isApplyingCatalog} onClick={() => setIsCatalogOpen(true)}>
              Добавить из каталога
            </Button>
            <Button
              id={`${formId}-trigger`}
              aria-expanded={isFormOpen}
              aria-controls={formId}
              disabled={isBusy || isLoading || isFormOpen || isApplyingCatalog}
              onClick={() => setIsFormOpen(true)}
            >
              Добавить вручную
            </Button>
          </>
          ) : null}
        </div>
      </div>

      <div className="ui-inline" role="group" aria-label="Фильтр пунктов технического задания">
        {([
          ['all', `Все (${items.length})`],
          ['incomplete', `Не выполнены (${items.length - completedCount})`],
          ['completed', `Выполнены (${completedCount})`],
        ] as const).map(([filter, label]) => (
          <Button key={filter} variant={itemFilter === filter ? 'default' : 'ghost'} aria-pressed={itemFilter === filter} onClick={() => setItemFilter(filter)}>{label}</Button>
        ))}
      </div>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      {isLoading ? <LoadingState label="Загрузка технического задания…" /> : null}

      {!isLoading && items.length === 0 && !error ? (
        <EmptyState
          title="Пунктов ТЗ пока нет"
          description={canEditStructure ? 'Пункты добавляет руководящий круг при создании или редактировании заказа.' : 'Пункты появятся здесь после добавления технического задания руководством.'}
        />
      ) : null}

      {items.length > 0 && visibleItems.length === 0 ? <EmptyState title="В этой группе пунктов нет" /> : null}
      {visibleItems.length > 0 ? <div className="ui-stack ui-stack--lg">
        {visibleItems.map((item) => {
          const index = items.findIndex((candidate) => candidate.id === item.id);
          const itemComments = commentsByItem[commentKey(item.id)];
          return (
          <article key={item.id} className={`ui-stack ui-stack--sm ${orderStyles.specificationItem}`}>
            <div className={`ui-section-header ${orderStyles.specificationHeader}`}>
              <div className={`ui-inline ${orderStyles.specificationIdentity}`}>
                <input
                  type="checkbox"
                  checked={item.isCompleted}
                  disabled={!canExecute || isBusy}
                  aria-label={`Выполнение: ${item.title}`}
                  onChange={async () => {
                    setIsBusy(true);
                    setError(null);
                    try {
                      if (item.isCompleted) {
                        await reopenOneTimeOrderSpecificationItem(orderId, item.id);
                      } else {
                        await completeOneTimeOrderSpecificationItem(orderId, item.id);
                      }
                      await load();
                    } catch {
                      setError('Не удалось изменить состояние пункта. Обновите страницу и проверьте назначение менеджера.');
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                />
                <h3 className={orderStyles.specificationTitle}>{item.title}</h3>
              </div>
              {(canManage || canEditCurrentStructure) ? (
                <div className={`ui-inline ${orderStyles.specificationActions}`}>
                  {canExecute ? (
                    <MediaActionPicker compactMenu compactLabel={`Добавить вложение к пункту «${item.title}»`} onPick={async (file) => {
                      await uploadFileToEntity({ entityType: 'one_time_order_specification_item', entityId: item.id, file });
                      await load();
                      setError(null);
                    }} />
                  ) : null}
                  {canEditCurrentStructure ? (
                <OverflowMenu
                  triggerLabel={`Действия для пункта: ${item.title}`}
                  items={[
                    {
                      key: 'edit',
                      label: 'Изменить пункт',
                      onSelect: () => {
                        setEditingId(item.id);
                        setTitle(item.title);
                        setDescription(item.description ?? '');
                        setIsFormOpen(true);
                      },
                    },
                    ...(index > 0 ? [{ key: 'move-up', label: 'Переместить выше', onSelect: () => void moveItem(index, -1) }] : []),
                    ...(index < items.length - 1 ? [{ key: 'move-down', label: 'Переместить ниже', onSelect: () => void moveItem(index, 1) }] : []),
                    { key: 'delete', label: 'Удалить пункт', tone: 'danger' as const, onSelect: () => setDeleteTarget(item) },
                  ]}
                />
                  ) : null}
                </div>
              ) : null}
            </div>
            {item.description ? <p className={orderStyles.orderLongText}>{item.description}</p> : null}
            {item.completedBy && item.completedAt ? (
              <div className="ui-text-muted">
                Выполнил: {getUserDisplayName(item.completedBy)} · {new Date(item.completedAt).toLocaleString('ru-RU')}
              </div>
            ) : null}
            {item.attachments.length > 0 ? (
              <div className="ui-stack ui-stack--sm">
                <AttachmentPreviewList
                  files={item.attachments}
                  getFileActions={(file): ReadonlyArray<OverflowMenuItem> => canExecute ? [{
                    key: 'detach',
                    label: 'Убрать из пункта ТЗ',
                    tone: 'danger',
                    disabled: isDetachingAttachment,
                    onSelect: () => setAttachmentTarget({ item, fileId: file.id, fileName: file.originalName }),
                  }] : []}
                />
              </div>
            ) : null}
            <Button
                variant="ghost"
                aria-expanded={openCommentsFor === item.id}
                onClick={async () => {
                  if (openCommentsFor === item.id) { setOpenCommentsFor(null); return; }
                  setOpenCommentsFor(item.id);
                  const key = commentKey(item.id);
                  if (commentsByItem[key]) return;
                  setCommentLoading((current) => ({ ...current, [key]: true }));
                  setCommentErrors((current) => ({ ...current, [key]: null }));
                  try {
                    await refreshComments(item.id, key);
                  } catch {
                    if (mounted.current && activeOrderId.current === orderId) setCommentErrors((current) => ({ ...current, [key]: 'Не удалось загрузить комментарии к пункту.' }));
                  } finally {
                    if (mounted.current && activeOrderId.current === orderId) setCommentLoading((current) => ({ ...current, [key]: false }));
                  }
                }}
              >
                {openCommentsFor === item.id ? 'Скрыть комментарии' : `Комментарии${itemComments ? ` (${itemComments.length})` : ''}`}
            </Button>
            {openCommentsFor === item.id ? (
              <section className="ui-stack ui-stack--sm" aria-label={`Комментарии к пункту «${item.title}»`}>
                {commentLoading[commentKey(item.id)] ? <LoadingState label="Загрузка комментариев…" /> : null}
                {commentErrors[commentKey(item.id)] ? <Alert tone="danger" role="alert" action={<Button variant="ghost" onClick={async () => {
                  const key = commentKey(item.id);
                  setCommentLoading((current) => ({ ...current, [key]: true }));
                  setCommentErrors((current) => ({ ...current, [key]: null }));
                  try { await refreshComments(item.id, key); }
                  catch { if (mounted.current && activeOrderId.current === orderId) setCommentErrors((current) => ({ ...current, [key]: 'Не удалось загрузить комментарии к пункту.' })); }
                  finally { if (mounted.current && activeOrderId.current === orderId) setCommentLoading((current) => ({ ...current, [key]: false })); }
                }}>Повторить</Button>}>{commentErrors[commentKey(item.id)]}</Alert> : null}
                {!commentLoading[commentKey(item.id)] && !commentErrors[commentKey(item.id)] && (commentsByItem[commentKey(item.id)] ?? []).length === 0 ? <EmptyState title="Комментариев пока нет" /> : null}
                {(commentsByItem[commentKey(item.id)] ?? []).map((comment) => (
                  <div className="ui-stack ui-stack--xs" key={comment.id}>
                    <div><strong>{getUserDisplayName(comment.createdBy)}</strong><span className="ui-text-muted"> · {new Date(comment.createdAt).toLocaleString('ru-RU')}</span></div>
                    <p className={orderStyles.orderLongText}>{comment.content}</p>
                  </div>
                ))}
                {canExecute ? <form className="ui-stack ui-stack--sm" onSubmit={async (event) => {
                  event.preventDefault();
                  const key = commentKey(item.id);
                  const draft = (commentDrafts[key] ?? '').trim();
                  if (!draft || commentPosting.current.has(key)) return;
                  commentPosting.current.add(key);
                  setPostingComments((current) => ({ ...current, [key]: true }));
                  setCommentErrors((current) => ({ ...current, [key]: null }));
                  const requestOrderId = orderId;
                  const previous = commentRequests.current[key];
                  try {
                    const send = async (request: { requestId: string; content: string }): Promise<OneTimeOrderSpecificationComment> => {
                      commentRequests.current[key] = request;
                      try {
                        const saved = await createOneTimeOrderSpecificationComment(requestOrderId, item.id, request);
                        if (mounted.current && activeOrderId.current === requestOrderId) mergeComments(key, [saved]);
                        return saved;
                      } catch (caught) {
                        if (caught instanceof ApiError && caught.statusCode >= 400 && caught.statusCode < 500) {
                          if (commentRequests.current[key]?.requestId === request.requestId) delete commentRequests.current[key];
                          const message = caught.statusCode === 409
                            ? 'Запрос конфликтует с сохранённым состоянием. Обновите комментарии и отправьте текст снова.'
                            : caught.message;
                          throw new Error(message);
                        }
                        throw caught;
                      }
                    };
                    const firstRequest = previous ?? { requestId: crypto.randomUUID(), content: draft };
                    const sent = await send(firstRequest);
                    const commentsToMerge = [sent];
                    let completedContent = firstRequest.content;
                    if (previous && draft !== previous.content) {
                      const next = { requestId: crypto.randomUUID(), content: draft };
                      commentsToMerge.push(await send(next));
                      completedContent = next.content;
                    }
                    if (mounted.current && activeOrderId.current === requestOrderId) {
                      mergeComments(key, commentsToMerge);
                      delete commentRequests.current[key];
                      setCommentDrafts((current) => current[key]?.trim() === completedContent
                        ? { ...current, [key]: '' }
                        : current);
                    }
                  } catch (caught) {
                    if (mounted.current && activeOrderId.current === requestOrderId) {
                      const message = caught instanceof Error && !(caught instanceof ApiError)
                        ? caught.message
                        : 'Не удалось отправить комментарий. Повторите попытку с тем же запросом.';
                      setCommentErrors((current) => ({ ...current, [key]: message }));
                    }
                  } finally {
                    commentPosting.current.delete(key);
                    if (mounted.current && activeOrderId.current === requestOrderId) setPostingComments((current) => ({ ...current, [key]: false }));
                  }
                }}>
                  <Field label={`Комментарий к пункту «${item.title}»`}>
                    <textarea name={`comment-${item.id}`} value={commentDrafts[commentKey(item.id)] ?? ''} maxLength={5000} rows={2} onChange={(event) => setCommentDrafts((current) => ({ ...current, [commentKey(item.id)]: event.target.value }))} />
                  </Field>
                  <div><Button variant="primary" type="submit" pending={Boolean(postingComments[commentKey(item.id)])} pendingLabel="Отправляем…" disabled={!commentDrafts[commentKey(item.id)]?.trim() || Boolean(postingComments[commentKey(item.id)])}>Отправить комментарий</Button></div>
                </form> : null}
              </section>
            ) : null}
          </article>
        );})}
      </div> : null}

      {canEditCurrentStructure && isFormOpen ? (
        <form
          id={formId}
          className={`ui-stack ui-stack--lg ${orderStyles.specificationForm}`}
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);

            if (!title.trim()) {
              setError('Название пункта обязательно.');
              return;
            }

            setIsBusy(true);
            try {
              if (editingId) {
                const editingItem = items.find((item) => item.id === editingId);
                const reopenCompleted = Boolean(editingItem?.isCompleted);

                await updateOneTimeOrderSpecificationItem(orderId, editingId, {
                  title,
                  description: description.trim() || null,
                  reopenCompleted,
                });
              } else {
                await createOneTimeOrderSpecificationItem(orderId, {
                  title,
                  description: description.trim() || undefined,
                });
              }

              resetForm();
              await load();
            } catch {
              setError('Не удалось сохранить пункт ТЗ.');
            } finally {
              setIsBusy(false);
            }
          }}
        >
          <h3 className="ui-section-title">{editingId ? 'Редактирование пункта' : 'Новый пункт ТЗ'}</h3>
          <Field label="Название пункта" required>
            <input
              ref={titleInput}
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </Field>
          <Field label="Описание">
            <textarea
              value={description}
              maxLength={5000}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="ui-inline">
            <Button variant="primary" type="submit" pending={isBusy} pendingLabel="Сохраняем…">
              {editingId
                ? items.find((item) => item.id === editingId)?.isCompleted
                  ? 'Сохранить и переоткрыть'
                  : 'Сохранить пункт'
                : 'Сохранить пункт'}
            </Button>
            <Button variant="ghost" disabled={isBusy} onClick={() => {
              resetForm();
              window.requestAnimationFrame(() => document.getElementById(`${formId}-trigger`)?.focus());
            }}>
              Отмена
            </Button>
          </div>
        </form>
      ) : null}

    </Surface>
    <Dialog
      open={isCatalogOpen}
      onOpenChange={(open) => { if (!open && !isApplyingCatalog) closeCatalog(); }}
      title="Добавить пункты из каталога"
      description="Выберите один или оба шаблона и при необходимости добавьте отдельные пункты. Состав будет добавлен к существующему ТЗ."
      busy={isApplyingCatalog || catalogLoading}
      footer={(
        <div className="ui-inline">
          <Button
            variant="primary"
            pending={isApplyingCatalog}
            pendingLabel="Добавляем…"
            disabled={hasPendingApply || catalogLoading || proposedItems.length === 0 || (orderStatus === 'in_progress' && applyReason.trim().length < 5)}
            onClick={() => void submitCatalogApply()}
          >
            Добавить выбранные · {proposedItems.length}
          </Button>
          <Button variant="ghost" disabled={isApplyingCatalog} onClick={closeCatalog}>Отмена</Button>
        </div>
      )}
    >
      <div className="ui-stack ui-stack--lg">
        {hasPendingApply ? (
          <Alert tone="warning" role="status" action={<Button variant="ghost" pending={isApplyingCatalog} pendingLabel="Проверяем…" disabled={isApplyingCatalog || catalogLoading} onClick={() => void submitCatalogApply()}>Проверить результат / Повторить отправку</Button>}>
            Предыдущая отправка не подтверждена. Повтор будет выполнен с исходным составом и ключом запроса; изменить выбор до результата нельзя.
          </Alert>
        ) : null}
        {catalogError ? <Alert tone="danger" role="alert">{catalogError}</Alert> : null}
        {orderStatus === 'in_progress' ? (
          <div className="ui-stack ui-stack--sm">
            <Alert tone="warning">Заказ уже в работе. Добавление изменит объём задания; назначенные менеджеры получат уведомление. Укажите причину.</Alert>
            <Field label="Причина изменения" required>
              <textarea value={applyReason} maxLength={1000} rows={3} disabled={hasPendingApply || isApplyingCatalog} onChange={(event) => setApplyReason(event.target.value)} />
            </Field>
          </div>
        ) : null}
        {catalogLoading ? <LoadingState label="Загружаем каталог и шаблоны…" /> : null}
        {!catalogLoading && templates.length > 0 ? (
          <section className="ui-stack ui-stack--sm" aria-labelledby={`${formId}-templates-heading`}>
            <h3 className="ui-section-title" id={`${formId}-templates-heading`}>Шаблоны</h3>
            {templates.map((template) => (
              <label key={template.id} className="ui-inline">
                <input type="checkbox" checked={selectedTemplateIdsSet.has(template.id)} disabled={isApplyingCatalog || hasPendingApply} onChange={(event) => setSelectedTemplateIds((current) => event.target.checked ? [...current, template.id] : current.filter((id) => id !== template.id))} />
                <span className={orderStyles.catalogOptionText}><strong>{template.name}</strong><span className="ui-text-muted"> · {template.items.length} пунктов</span></span>
              </label>
            ))}
          </section>
        ) : null}
        {!catalogLoading && catalogItems.length > 0 ? (
          <section className="ui-stack ui-stack--sm" aria-labelledby={`${formId}-items-heading`}>
            <h3 className="ui-section-title" id={`${formId}-items-heading`}>Отдельные пункты</h3>
            {catalogItems.map((catalogItem) => (
              <label key={catalogItem.id} className="ui-inline">
                <input type="checkbox" checked={selectedCatalogIds.has(catalogItem.id)} disabled={isApplyingCatalog || hasPendingApply} onChange={(event) => setSelectedCatalogItemIds((current) => event.target.checked ? [...current, catalogItem.id] : current.filter((id) => id !== catalogItem.id))} />
                <span className={orderStyles.catalogOptionText}>{catalogItem.title}{catalogItem.description ? <span className="ui-text-muted"> · {catalogItem.description}</span> : null}</span>
              </label>
            ))}
          </section>
        ) : null}
        {matchingExistingCount > 0 ? (
          <Alert tone="warning">
            Совпадения по тексту с существующим ТЗ: {matchingExistingCount}. Все совпавшие пункты будут добавлены отдельно; исходные отметки, комментарии и вложения останутся без изменений. Ненужные дубли можно удалить вручную позже.
          </Alert>
        ) : null}
        {!catalogLoading && templates.length === 0 && catalogItems.length === 0 && !catalogError ? (
          <EmptyState title="Каталог пока пуст" description="Руководящий круг может добавить пункты и шаблоны в настройках каталога ТЗ." />
        ) : null}
      </div>
    </Dialog>
    <ConfirmDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      title="Удалить пункт технического задания?"
      consequence={deleteTarget ? `«${deleteTarget.title}» будет удалён из задания.` : ''}
      confirmLabel="Удалить пункт"
      tone="danger"
      pending={isDeleting}
      error={error}
      onConfirm={() => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        setError(null);
        void deleteOneTimeOrderSpecificationItem(orderId, deleteTarget.id)
          .then(async () => { setDeleteTarget(null); await load(); })
          .catch(() => setError('Не удалось удалить пункт ТЗ.'))
          .finally(() => setIsDeleting(false));
      }}
    />
    <ConfirmDialog
      open={attachmentTarget !== null}
      onOpenChange={(open) => { if (!open && !isDetachingAttachment) setAttachmentTarget(null); }}
      title="Убрать вложение из пункта?"
      consequence={attachmentTarget ? `«${attachmentTarget.fileName}» перестанет отображаться у этого пункта. Файл в хранилище не удаляется.` : ''}
      confirmLabel="Убрать вложение"
      pending={isDetachingAttachment}
      onConfirm={() => {
        if (!attachmentTarget) return;
        setIsDetachingAttachment(true);
        void detachOneTimeOrderSpecificationAttachment(orderId, attachmentTarget.item.id, attachmentTarget.fileId)
          .then(async () => { setAttachmentTarget(null); await load(); })
          .catch(() => setError('Не удалось убрать вложение. Обновите страницу и проверьте назначение.'))
          .finally(() => setIsDetachingAttachment(false));
      }}
    />
    </>
  );
}
