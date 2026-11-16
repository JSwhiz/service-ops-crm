'use client';

import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';

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
import { AccessSnapshotBlockedContext, AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';
import { ConfirmDialog, Dialog } from '@/shared/ui/overlays';
import { Alert, Button, EmptyState, Field, LoadingState, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

export function OneTimeOrderSpecificationPanel({
  orderId,
  readSnapshot,
  canManage,
  canEditStructure,
  canCommentSpecification,
  canDetachSpecificationFiles,
  orderStatus,
  onOpenDailyReport,
}: {
  orderId: string;
  /** The fresh parent DTO; same-order ACL reloads must also refresh this read. */
  readSnapshot: object;
  /** Assigned manager's execute leaf; never a proxy for comments or detach. */
  canManage: boolean;
  /** Leadership-only scope for creating and structurally editing the snapshot. */
  canEditStructure: boolean;
  canCommentSpecification: boolean;
  canDetachSpecificationFiles: boolean;
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
  const canCommentCurrent = canCommentSpecification === true && orderStatus !== 'completed' && orderStatus !== 'cancelled';
  const canDetachCurrent = canDetachSpecificationFiles === true && orderStatus !== 'completed' && orderStatus !== 'cancelled';
  const accessRevision = useAccessRevision();
  const snapshotBlocked = useContext(AccessSnapshotBlockedContext);
  const [loadedSpecification, setLoadedSpecification] = useState<{ orderId: string; revision: string; snapshot: object } | null>(null);
  const [specificationError, setSpecificationError] = useState<string | null>(null);
  const [readRetry, setReadRetry] = useState(0);
  const readSequence = useRef(0);
  const specificationReady = !snapshotBlocked && !specificationError && loadedSpecification?.orderId === orderId &&
    loadedSpecification.revision === accessRevision && loadedSpecification.snapshot === readSnapshot;
  const liveContext = useRef({ orderId, accessRevision, readSnapshot, snapshotBlocked: !specificationReady, canExecute, canEditCurrentStructure, canCommentCurrent, canDetachCurrent, items });
  liveContext.current = { orderId, accessRevision, readSnapshot, snapshotBlocked: !specificationReady, canExecute, canEditCurrentStructure, canCommentCurrent, canDetachCurrent, items };
  const [deleteIntent, setDeleteIntent] = useState<(() => boolean) | null>(null);
  const [attachmentIntent, setAttachmentIntent] = useState<(() => boolean) | null>(null);
  const pendingIntents = useRef({ deleteIntent, attachmentIntent });
  pendingIntents.current = { deleteIntent, attachmentIntent };
  const cancelDelete = (): void => {
    pendingIntents.current.deleteIntent = null;
    setDeleteIntent(null); setDeleteTarget(null);
  };
  const cancelAttachment = (): void => {
    pendingIntents.current.attachmentIntent = null;
    setAttachmentIntent(null); setAttachmentTarget(null);
  };
  const captureSpecificationAction = (itemId: string, fileId?: string, action: 'manage' | 'execute' | 'comment' | 'detach' = fileId ? 'detach' : 'manage'): (() => boolean) => {
    const generation = getAccessGeneration();
    const capability = ({ manage: 'canEditCurrentStructure', execute: 'canExecute', comment: 'canCommentCurrent', detach: 'canDetachCurrent' } as const)[action];
    return () => mounted.current && isAccessGenerationCurrent(generation) && liveContext.current.orderId === orderId &&
      liveContext.current.accessRevision === accessRevision && !liveContext.current.snapshotBlocked &&
      liveContext.current[capability] === true &&
      liveContext.current.items.some((row) => row.id === itemId && (!fileId || row.attachments.some((file) => file.id === fileId)));
  };
  useEffect(() => {
    if (deleteIntent && !deleteIntent()) cancelDelete();
    if (attachmentIntent && !attachmentIntent()) cancelAttachment();
  }, [deleteIntent, attachmentIntent, orderId, accessRevision, specificationReady, canExecute, canEditCurrentStructure, canDetachCurrent, items]);

  const load = async (): Promise<void> => {
    const generation = getAccessGeneration();
    const sequence = ++readSequence.current;
    const isCurrentRead = (): boolean => mounted.current && sequence === readSequence.current && isAccessGenerationCurrent(generation) &&
      liveContext.current.orderId === orderId && liveContext.current.accessRevision === accessRevision && liveContext.current.readSnapshot === readSnapshot;
    setLoadedSpecification(null); setSpecificationError(null);
    try {
      const result = await listOneTimeOrderSpecificationItems(orderId);
      if (!isCurrentRead()) return;
      setItems(result);
      setLoadedSpecification({ orderId, revision: accessRevision, snapshot: readSnapshot });
    } catch (caught) {
      if (isCurrentRead()) setSpecificationError('Не удалось обновить техническое задание. Старые пункты и вложения скрыты до успешной проверки.');
      throw caught;
    }
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
      .catch(() => {}) // The read error is outside the concealed server-data boundary.
      .finally(() => setIsLoading(false));
  }, [orderId, accessRevision, readSnapshot, readRetry]);
  const clearLoadedComments = (): void => {
    setOpenCommentsFor(null);
    setCommentsByItem({}); setCommentLoading({}); setCommentErrors({});
  };
  useEffect(() => {
    clearLoadedComments();
  }, [orderId, accessRevision, readSnapshot]);

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
  const captureSpecificationRead = (itemId: string): (() => boolean) => {
    const generation = getAccessGeneration();
    return () => mounted.current && isAccessGenerationCurrent(generation) &&
      liveContext.current.orderId === orderId && liveContext.current.accessRevision === accessRevision &&
      liveContext.current.readSnapshot === readSnapshot &&
      !liveContext.current.snapshotBlocked && liveContext.current.items.some((row) => row.id === itemId);
  };
  const refreshComments = async (itemId: string, key = commentKey(itemId)): Promise<OneTimeOrderSpecificationComment[]> => {
    const isCurrentRead = captureSpecificationRead(itemId);
    if (!isCurrentRead()) return [];
    const comments = await listOneTimeOrderSpecificationComments(orderId, itemId);
    if (!isCurrentRead()) return [];
    mergeComments(key, comments);
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
    {!specificationReady && !snapshotBlocked ? <div role="status">
      {specificationError || 'Обновляем техническое задание…'}
      {specificationError ? <Button onClick={() => setReadRetry((value) => value + 1)}>Повторить проверку ТЗ</Button> : null}
    </div> : null}
    <AccessSnapshotBoundary blocked={!specificationReady}>
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
                    const isCurrent = captureSpecificationAction(item.id, undefined, 'execute');
                    if (!isCurrent()) return;
                    setIsBusy(true);
                    setError(null);
                    try {
                      if (item.isCompleted) {
                        await reopenOneTimeOrderSpecificationItem(orderId, item.id);
                      } else {
                        await completeOneTimeOrderSpecificationItem(orderId, item.id);
                      }
                      if (!isCurrent()) return;
                      await load();
                    } catch {
                      if (isCurrent()) setError('Не удалось изменить состояние пункта. Обновите страницу и проверьте назначение менеджера.');
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                />
                <h3 className={orderStyles.specificationTitle}>{item.title}</h3>
              </div>
              <AccessSnapshotBoundary blocked={!canManage && !canEditCurrentStructure}>
                <div className={`ui-inline ${orderStyles.specificationActions}`}>
                  <AccessSnapshotBoundary blocked={!canExecute}>
                    <MediaActionPicker disabled={!canExecute} compactMenu compactLabel={`Добавить вложение к пункту «${item.title}»`} onPick={async (file) => {
                      await uploadFileToEntity({ entityType: 'one_time_order_specification_item', entityId: item.id, file });
                      try {
                        await load();
                        setError(null);
                      } catch {
                        setError('Файл сохранён, но не удалось обновить пункт ТЗ. Обновите страницу; повторная загрузка файла не нужна.');
                      }
                    }} />
                  </AccessSnapshotBoundary>
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
                    { key: 'delete', label: 'Удалить пункт', tone: 'danger' as const, onSelect: () => {
                      const isCurrent = captureSpecificationAction(item.id);
                      if (!isCurrent()) return;
                      setDeleteIntent(() => isCurrent); setDeleteTarget(item);
                    } },
                  ]}
                />
                  ) : null}
                </div>
              </AccessSnapshotBoundary>
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
                  getFileActions={(file): ReadonlyArray<OverflowMenuItem> => canDetachCurrent ? [{
                    key: 'detach',
                    label: 'Убрать из пункта ТЗ',
                    tone: 'danger',
                    disabled: isDetachingAttachment,
                    onSelect: () => {
                      const isCurrent = captureSpecificationAction(item.id, file.id);
                      if (!isCurrent()) return;
                      setAttachmentIntent(() => isCurrent); setAttachmentTarget({ item, fileId: file.id, fileName: file.originalName });
                    },
                  }] : []}
                />
              </div>
            ) : null}
            <Button
                variant="ghost"
                aria-expanded={openCommentsFor === item.id}
                onClick={async () => {
                  const isCurrentRead = captureSpecificationRead(item.id);
                  if (!isCurrentRead()) return;
                  if (openCommentsFor === item.id) { setOpenCommentsFor(null); return; }
                  setOpenCommentsFor(item.id);
                  const key = commentKey(item.id);
                  if (commentsByItem[key]) return;
                  setCommentLoading((current) => ({ ...current, [key]: true }));
                  setCommentErrors((current) => ({ ...current, [key]: null }));
                  try {
                    await refreshComments(item.id, key);
                  } catch {
                    if (isCurrentRead()) setCommentErrors((current) => ({ ...current, [key]: 'Не удалось загрузить комментарии к пункту.' }));
                  } finally {
                    if (isCurrentRead()) setCommentLoading((current) => ({ ...current, [key]: false }));
                  }
                }}
              >
                {openCommentsFor === item.id ? 'Скрыть комментарии' : `Комментарии${itemComments ? ` (${itemComments.length})` : ''}`}
            </Button>
            {openCommentsFor === item.id ? (
              <section className="ui-stack ui-stack--sm" aria-label={`Комментарии к пункту «${item.title}»`}>
                {commentLoading[commentKey(item.id)] ? <LoadingState label="Загрузка комментариев…" /> : null}
                {commentErrors[commentKey(item.id)] ? <Alert tone="danger" role="alert" action={<Button variant="ghost" onClick={async () => {
                  const isCurrentRead = captureSpecificationRead(item.id);
                  if (!isCurrentRead()) return;
                  const key = commentKey(item.id);
                  setCommentLoading((current) => ({ ...current, [key]: true }));
                  setCommentErrors((current) => ({ ...current, [key]: null }));
                  try { await refreshComments(item.id, key); }
                  catch { if (isCurrentRead()) setCommentErrors((current) => ({ ...current, [key]: 'Не удалось загрузить комментарии к пункту.' })); }
                  finally { if (isCurrentRead()) setCommentLoading((current) => ({ ...current, [key]: false })); }
                }}>Повторить</Button>}>{commentErrors[commentKey(item.id)]}</Alert> : null}
                {!commentLoading[commentKey(item.id)] && !commentErrors[commentKey(item.id)] && (commentsByItem[commentKey(item.id)] ?? []).length === 0 ? <EmptyState title="Комментариев пока нет" /> : null}
                {(commentsByItem[commentKey(item.id)] ?? []).map((comment) => (
                  <div className="ui-stack ui-stack--xs" key={comment.id}>
                    <div><strong>{getUserDisplayName(comment.createdBy)}</strong><span className="ui-text-muted"> · {new Date(comment.createdAt).toLocaleString('ru-RU')}</span></div>
                    <p className={orderStyles.orderLongText}>{comment.content}</p>
                  </div>
                ))}
                <AccessSnapshotBoundary blocked={!canCommentCurrent}><form className="ui-stack ui-stack--sm" onSubmit={async (event) => {
                  event.preventDefault();
                  const isCurrent = captureSpecificationAction(item.id, undefined, 'comment');
                  if (!isCurrent()) return;
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
                      if (!isCurrent()) throw new Error('Права или пункт задания изменились.');
                      commentRequests.current[key] = request;
                      try {
                        const saved = await createOneTimeOrderSpecificationComment(requestOrderId, item.id, request);
                        if (isCurrent()) mergeComments(key, [saved]);
                        return saved;
                      } catch (caught) {
                        if (!isCurrent()) throw caught;
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
                    if (!isCurrent()) return;
                    const commentsToMerge = [sent];
                    let completedContent = firstRequest.content;
                    if (previous && draft !== previous.content) {
                      const next = { requestId: crypto.randomUUID(), content: draft };
                      commentsToMerge.push(await send(next));
                      if (!isCurrent()) return;
                      completedContent = next.content;
                    }
                    if (isCurrent()) {
                      mergeComments(key, commentsToMerge);
                      delete commentRequests.current[key];
                      setCommentDrafts((current) => current[key]?.trim() === completedContent
                        ? { ...current, [key]: '' }
                        : current);
                    }
                  } catch (caught) {
                    if (isCurrent()) {
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
                    <textarea name={`comment-${item.id}`} disabled={!canCommentCurrent} value={commentDrafts[commentKey(item.id)] ?? ''} maxLength={5000} rows={2} onChange={(event) => setCommentDrafts((current) => ({ ...current, [commentKey(item.id)]: event.target.value }))} />
                  </Field>
                  <div><Button variant="primary" type="submit" pending={Boolean(postingComments[commentKey(item.id)])} pendingLabel="Отправляем…" disabled={!canCommentCurrent || !commentDrafts[commentKey(item.id)]?.trim() || Boolean(postingComments[commentKey(item.id)])}>Отправить комментарий</Button></div>
                </form></AccessSnapshotBoundary>
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
      open={deleteTarget !== null && deleteIntent?.() === true}
      onOpenChange={(open) => { if (!open) cancelDelete(); }}
      title="Удалить пункт технического задания?"
      consequence={deleteTarget ? `«${deleteTarget.title}» будет удалён из задания.` : ''}
      confirmLabel="Удалить пункт"
      tone="danger"
      pending={isDeleting}
      error={error}
      onConfirm={() => {
        const isCurrent = (): boolean => pendingIntents.current.deleteIntent === deleteIntent && deleteIntent?.() === true;
        if (!deleteTarget || !isCurrent() || isDeleting) return;
        setIsDeleting(true);
        setError(null);
        void deleteOneTimeOrderSpecificationItem(orderId, deleteTarget.id)
          .then(async () => { if (!isCurrent()) return; cancelDelete(); await load(); })
          .catch(() => { if (isCurrent()) setError('Не удалось удалить пункт ТЗ или обновить список. Проверьте текущий список перед повтором.'); })
          .finally(() => setIsDeleting(false));
      }}
    />
    <ConfirmDialog
      open={attachmentTarget !== null && attachmentIntent?.() === true}
      onOpenChange={(open) => { if (!open && !isDetachingAttachment) cancelAttachment(); }}
      title="Убрать вложение из пункта?"
      consequence={attachmentTarget ? `«${attachmentTarget.fileName}» перестанет отображаться у этого пункта. Файл в хранилище не удаляется.` : ''}
      confirmLabel="Убрать вложение"
      pending={isDetachingAttachment}
      onConfirm={() => {
        const isCurrent = (): boolean => pendingIntents.current.attachmentIntent === attachmentIntent && attachmentIntent?.() === true;
        const target = attachmentTarget;
        if (!target || !isCurrent() || isDetachingAttachment) return;
        setIsDetachingAttachment(true);
        void (async () => {
          // Revalidate the exact item/file pair; an old dialog must not detach a replacement attachment.
          const currentItems = await listOneTimeOrderSpecificationItems(orderId);
          if (!isCurrent()) return;
          setItems(currentItems);
          if (!currentItems.some((row) => row.id === target.item.id && row.attachments.some((file) => file.id === target.fileId))) {
            cancelAttachment();
            setError('Вложение уже изменилось. Проверьте текущий пункт задания.');
            return;
          }
          if (!isCurrent()) return;
          await detachOneTimeOrderSpecificationAttachment(orderId, target.item.id, target.fileId);
          if (!isCurrent()) return;
          cancelAttachment();
          await load();
        })()
          .catch(() => { if (isCurrent()) setError('Не удалось убрать вложение или обновить список. Проверьте текущее назначение перед повтором.'); })
          .finally(() => setIsDetachingAttachment(false));
      }}
    />
    </AccessSnapshotBoundary>
    </>
  );
}
