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
    <section className="page-card page-stack">
      <div className="section-header">
        <div>
          <div className="section-title">Техническое задание</div>
          <div className="section-subtitle">
            Выполнено {completedCount} из {items.length}
          </div>
        </div>
      </div>

      {canManage ? (
        <form
          className="detail-grid"
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
                const reopenCompleted = Boolean(
                  editingItem?.isCompleted &&
                    window.confirm(
                      'Пункт уже выполнен. Сохранить изменения и переоткрыть его?',
                    ),
                );

                if (editingItem?.isCompleted && !reopenCompleted) {
                  return;
                }

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
            <div className="detail-label">Название пункта</div>
            <input
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            <div className="detail-label">Описание</div>
            <input
              value={description}
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="action-row">
            <input
              type="checkbox"
              checked={requiresAttachment}
              onChange={(event) => setRequiresAttachment(event.target.checked)}
            />
            Требовать вложение
          </label>
          <div className="action-row">
            <button type="submit" disabled={isBusy}>
              {editingId ? 'Сохранить пункт' : 'Добавить пункт'}
            </button>
            {editingId ? (
              <button type="button" className="button-secondary" onClick={resetForm}>
                Отмена
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

      <div className="page-stack">
        {items.length === 0 ? (
          <div className="page-muted">Пункты ТЗ пока не добавлены.</div>
        ) : (
          items.map((item, index) => (
            <article key={item.id} className="detail-section">
              <div className="section-header">
                <div className="action-row">
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
                      <span className="status-pill">Нужно вложение</span>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <div className="action-row">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={index === 0}
                      onClick={() => void moveItem(index, -1)}
                    >
                      Выше
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={index === items.length - 1}
                      onClick={() => void moveItem(index, 1)}
                    >
                      Ниже
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        setEditingId(item.id);
                        setTitle(item.title);
                        setDescription(item.description ?? '');
                        setRequiresAttachment(item.requiresAttachment);
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="button-danger"
                      onClick={async () => {
                        if (!window.confirm('Удалить пункт ТЗ?')) {
                          return;
                        }
                        await deleteOneTimeOrderSpecificationItem(
                          orderId,
                          item.id,
                        );
                        await load();
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>

              {item.description ? <p>{item.description}</p> : null}
              {item.completedBy && item.completedAt ? (
                <div className="page-muted">
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
    </section>
  );
}
