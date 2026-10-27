'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

import { uploadFileToEntity } from '@/entities/file/api/file-client';
import {
  completeOneTimeOrderSpecificationItem,
  createOneTimeOrderSpecificationItem,
  deleteOneTimeOrderSpecificationItem,
  listOneTimeOrderSpecificationItems,
  reopenOneTimeOrderSpecificationItem,
  reorderOneTimeOrderSpecificationItems,
  updateOneTimeOrderSpecificationItem,
} from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderSpecificationItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { ConfirmDialog } from '@/shared/ui/overlays';
import { Alert, Badge, Button, EmptyState, Field, LoadingState, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

export function OneTimeOrderSpecificationPanel({
  orderId,
  canManage,
}: {
  orderId: string;
  canManage: boolean;
}): React.JSX.Element {
  const [items, setItems] = useState<OneTimeOrderSpecificationItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requiresAttachment, setRequiresAttachment] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const formId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OneTimeOrderSpecificationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async (): Promise<void> => {
    setItems(await listOneTimeOrderSpecificationItems(orderId));
  };

  useEffect(() => {
    void load()
      .catch(() => setError('Не удалось загрузить техническое задание.'))
      .finally(() => setIsLoading(false));
  }, [orderId]);

  useEffect(() => {
    if (isFormOpen) titleInput.current?.focus();
  }, [isFormOpen, editingId]);

  const completedCount = items.filter((item) => item.isCompleted).length;

  const resetForm = (): void => {
    setTitle('');
    setDescription('');
    setRequiresAttachment(false);
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
        {canManage ? (
          <Button
            id={`${formId}-trigger`}
            aria-expanded={isFormOpen}
            aria-controls={formId}
            disabled={isBusy || isLoading || isFormOpen}
            onClick={() => setIsFormOpen(true)}
          >
            Добавить пункт
          </Button>
        ) : null}
      </div>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      {isLoading ? <LoadingState label="Загрузка технического задания…" /> : null}

      {!isLoading && items.length === 0 && !error ? (
        <EmptyState
          title="Пунктов ТЗ пока нет"
          description={canManage ? 'Добавьте первый пункт: укажите работу и необходимость вложения.' : 'Пункты появятся здесь после добавления технического задания.'}
        />
      ) : null}

      {items.length > 0 ? <div className="ui-stack ui-stack--lg">
        {items.map((item, index) => (
          <article key={item.id} className={`ui-stack ui-stack--sm ${orderStyles.specificationItem}`}>
            <div className="ui-section-header">
              <div className="ui-inline">
                <input
                  type="checkbox"
                  checked={item.isCompleted}
                  disabled={!canManage || isBusy}
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
                      setError(item.requiresAttachment && !item.isCompleted
                        ? 'Для выполнения пункта нужно вложение.'
                        : 'Не удалось изменить состояние пункта.');
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                />
                <h3 className={orderStyles.specificationTitle}>{item.title}</h3>
                {item.requiresAttachment ? <Badge>Нужно вложение</Badge> : null}
              </div>
              {canManage ? (
                <div className="ui-inline">
                  <Button size="sm" disabled={index === 0} aria-label={`Переместить выше: ${item.title}`} onClick={() => void moveItem(index, -1)}>Выше</Button>
                  <Button size="sm" disabled={index === items.length - 1} aria-label={`Переместить ниже: ${item.title}`} onClick={() => void moveItem(index, 1)}>Ниже</Button>
                  <Button size="sm" onClick={() => {
                    setEditingId(item.id);
                    setTitle(item.title);
                    setDescription(item.description ?? '');
                    setRequiresAttachment(item.requiresAttachment);
                    setIsFormOpen(true);
                  }}>Изменить</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(item)}>Удалить</Button>
                </div>
              ) : null}
            </div>
            {item.description ? <p className={orderStyles.orderLongText}>{item.description}</p> : null}
            {item.completedBy && item.completedAt ? (
              <div className="ui-text-muted">
                Выполнил: {getUserDisplayName(item.completedBy)} · {new Date(item.completedAt).toLocaleString('ru-RU')}
              </div>
            ) : null}
            {canManage ? (
              <MediaActionPicker onPick={async (file) => {
                await uploadFileToEntity({ entityType: 'one_time_order_specification_item', entityId: item.id, file });
                await load();
              }} />
            ) : null}
            {item.attachments.length > 0 ? <AttachmentPreviewList files={item.attachments} /> : null}
          </article>
        ))}
      </div> : null}

      {canManage && isFormOpen ? (
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
                  requiresAttachment,
                  reopenCompleted,
                });
              } else {
                await createOneTimeOrderSpecificationItem(orderId, {
                  title,
                  description: description.trim() || undefined,
                  requiresAttachment,
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
          <label className="ui-inline">
            <input
              type="checkbox"
              checked={requiresAttachment}
              onChange={(event) => setRequiresAttachment(event.target.checked)}
            />
            Требовать вложение
          </label>
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
    </>
  );
}
