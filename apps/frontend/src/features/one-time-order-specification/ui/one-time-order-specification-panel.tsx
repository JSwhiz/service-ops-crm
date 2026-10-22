'use client';

import React, { useEffect, useState } from 'react';

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
import { Alert, Badge, Button, Surface } from '@/shared/ui/foundation';

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
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OneTimeOrderSpecificationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async (): Promise<void> => {
    setItems(await listOneTimeOrderSpecificationItems(orderId));
  };

  useEffect(() => {
    void load().catch(() => setError('Не удалось загрузить техническое задание.'));
  }, [orderId]);

  const completedCount = items.filter((item) => item.isCompleted).length;

  const resetForm = (): void => {
    setTitle('');
    setDescription('');
    setRequiresAttachment(false);
    setEditingId(null);
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
          <div className="ui-section-title">Техническое задание</div>
          <div className="ui-section-subtitle">
            Выполнено {completedCount} из {items.length}
          </div>
        </div>
      </div>

      {canManage ? (
        <form
          className="ui-detail-grid"
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
          <label>
            <div className="ui-detail-label">Название пункта</div>
            <input
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            <div className="ui-detail-label">Описание</div>
            <input
              value={description}
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="ui-inline">
            <input
              type="checkbox"
              checked={requiresAttachment}
              onChange={(event) => setRequiresAttachment(event.target.checked)}
            />
            Требовать вложение
          </label>
          <div className="ui-inline">
            <Button variant="primary" type="submit" disabled={isBusy}>
              {editingId
                ? items.find((item) => item.id === editingId)?.isCompleted
                  ? 'Сохранить и переоткрыть'
                  : 'Сохранить пункт'
                : 'Добавить пункт'}
            </Button>
            {editingId ? (
              <Button onClick={resetForm}>
                Отмена
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      <div className="ui-stack ui-stack--lg">
        {items.length === 0 ? (
          <div className="ui-text-muted">Пункты ТЗ пока не добавлены.</div>
        ) : (
          items.map((item, index) => (
            <article key={item.id} className="detail-section">
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
                          await reopenOneTimeOrderSpecificationItem(
                            orderId,
                            item.id,
                          );
                        } else {
                          await completeOneTimeOrderSpecificationItem(
                            orderId,
                            item.id,
                          );
                        }
                        await load();
                      } catch {
                        setError(
                          item.requiresAttachment && !item.isCompleted
                            ? 'Для выполнения пункта нужно вложение.'
                            : 'Не удалось изменить состояние пункта.',
                        );
                      } finally {
                        setIsBusy(false);
                      }
                    }}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    {item.requiresAttachment ? (
                      <Badge>Нужно вложение</Badge>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <div className="ui-inline">
                    <Button
                      disabled={index === 0}
                      onClick={() => void moveItem(index, -1)}
                    >
                      Выше
                    </Button>
                    <Button
                      disabled={index === items.length - 1}
                      onClick={() => void moveItem(index, 1)}
                    >
                      Ниже
                    </Button>
                    <Button
                      onClick={() => {
                        setEditingId(item.id);
                        setTitle(item.title);
                        setDescription(item.description ?? '');
                        setRequiresAttachment(item.requiresAttachment);
                      }}
                    >
                      Изменить
                    </Button>
                    <Button variant="danger"
                      onClick={() => setDeleteTarget(item)}
                    >
                      Удалить
                    </Button>
                  </div>
                ) : null}
              </div>

              {item.description ? <p>{item.description}</p> : null}
              {item.completedBy && item.completedAt ? (
                <div className="ui-text-muted">
                  Выполнил: {getUserDisplayName(item.completedBy)} ·{' '}
                  {new Date(item.completedAt).toLocaleString('ru-RU')}
                </div>
              ) : null}
              {canManage ? (
                <MediaActionPicker
                  onPick={async (file) => {
                    await uploadFileToEntity({
                      entityType: 'one_time_order_specification_item',
                      entityId: item.id,
                      file,
                    });
                    await load();
                  }}
                />
              ) : null}
              <AttachmentPreviewList
                files={item.attachments}
                emptyText="Вложений нет."
              />
            </article>
          ))
        )}
      </div>
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
