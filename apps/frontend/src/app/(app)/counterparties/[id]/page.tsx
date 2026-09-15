'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import {
  getCounterparty,
  linkCounterpartyObject,
  listCounterpartyHistory,
  setCounterpartyArchived,
  unlinkCounterpartyObject,
  updateCounterparty,
} from '@/entities/counterparty/api/counterparty-client';
import type {
  CounterpartyCard,
  CounterpartyHistoryItem,
} from '@/entities/counterparty/model/counterparty.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

function toObjectOption(object: ServiceObject): SearchableSelectOption {
  return {
    value: object.id,
    label: object.name,
    description: [object.internalName, object.address].filter(Boolean).join(' · '),
    searchText: [object.name, object.internalName, object.address]
      .filter(Boolean)
      .join(' '),
  };
}

function actionLabel(action: string): string {
  switch (action) {
    case 'counterparty.created':
      return 'Контрагент создан';
    case 'counterparty.updated':
      return 'Данные изменены';
    case 'counterparty.archived':
      return 'Контрагент архивирован';
    case 'counterparty.restored':
      return 'Контрагент восстановлен';
    case 'counterparty.object_linked':
      return 'Объект привязан';
    case 'counterparty.object_unlinked':
      return 'Объект отвязан';
    case 'counterparty.object_unlinked_by_relink':
      return 'Объект перенесён к другому контрагенту';
    default:
      return action;
  }
}

export default function CounterpartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<CounterpartyCard | null>(null);
  const [history, setHistory] = useState<CounterpartyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [linkObjectId, setLinkObjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    contactName: '',
    contactPhone: '',
    notes: '',
  });

  const sync = (next: CounterpartyCard): void => {
    setItem(next);
    setForm({
      name: next.name,
      legalName: next.legalName ?? '',
      contactName: next.contactName ?? '',
      contactPhone: next.contactPhone ?? '',
      notes: next.notes ?? '',
    });
  };

  const reloadHistory = async (counterpartyId: string): Promise<void> => {
    const next = await listCounterpartyHistory(counterpartyId);
    setHistory(next);
  };

  useEffect(() => {
    let active = true;
    void params
      .then(({ id: counterpartyId }) => {
        if (!active) return null;
        return Promise.all([
          getCounterparty(counterpartyId),
          listCounterpartyHistory(counterpartyId),
        ]);
      })
      .then((result) => {
        if (!active || !result) return;
        sync(result[0]);
        setHistory(result[1]);
      })
      .catch((caughtError) => {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Не удалось загрузить контрагента.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params]);

  const mutate = async (
    operation: () => Promise<CounterpartyCard>,
  ): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const next = await operation();
      sync(next);
      await reloadHistory(next.id);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Не удалось сохранить изменение.',
      );
    } finally {
      setSaving(false);
    }
  };

  const hiddenObjectCount = useMemo(
    () => Math.max(0, (item?.objectCount ?? 0) - (item?.visibleObjectCount ?? 0)),
    [item],
  );

  if (loading) {
    return (
      <div className="workspace-page page-stack">
        <PageTitle title="Контрагент" />
        <div className="page-card">Загрузка...</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="workspace-page page-stack">
        <PageTitle title="Контрагент" />
        <div className="page-card inline-notice inline-notice--warning">
          {error ?? 'Контрагент не найден.'}
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page page-stack">
      <PageTitle title={item.name} />

      <div className="action-row">
        <Link href="/counterparties">К реестру</Link>
        <span className="status-pill" data-status={item.status}>
          {item.status === 'active' ? 'Активный' : 'Архив'}
        </span>
      </div>

      {error ? (
        <div className="page-card inline-notice inline-notice--warning">
          {error}
        </div>
      ) : null}

      <section className="page-card workspace-surface">
        <div className="section-header">
          <div>
            <div className="section-title">Обзор</div>
            <div className="page-muted">
              Клиентская сущность. Операционные процессы остаются на объектах.
            </div>
          </div>
          {item.capabilities.canManage ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? 'Отмена' : 'Редактировать'}
            </button>
          ) : null}
        </div>

        {editing ? (
          <form
            className="field-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(() =>
                updateCounterparty(item.id, {
                  name: form.name.trim(),
                  legalName: form.legalName.trim() || null,
                  contactName: form.contactName.trim() || null,
                  contactPhone: form.contactPhone.trim() || null,
                  notes: form.notes.trim() || null,
                }),
              ).then(() => setEditing(false));
            }}
          >
            <label>
              <span>Название *</span>
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Юридическое название</span>
              <input
                value={form.legalName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    legalName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Основной контакт</span>
              <input
                value={form.contactName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Телефон</span>
              <input
                value={form.contactPhone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactPhone: event.target.value,
                  }))
                }
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Комментарий</span>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
            <div className="action-row" style={{ gridColumn: '1 / -1' }}>
              <button
                type="submit"
                disabled={saving || form.name.trim().length < 2}
              >
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </form>
        ) : (
          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Название</div>
              <div className="detail-value">{item.name}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Юридическое название</div>
              <div className="detail-value">{item.legalName ?? 'Не указано'}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Основной контакт</div>
              <div className="detail-value">{item.contactName ?? 'Не указан'}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Телефон</div>
              <div className="detail-value">{item.contactPhone ?? 'Не указан'}</div>
            </div>
            {item.notes ? (
              <div className="detail-field">
                <div className="detail-label">Комментарий</div>
                <div className="detail-value">{item.notes}</div>
              </div>
            ) : null}
          </div>
        )}

        {item.capabilities.canManage ? (
          <div className="action-row" style={{ marginTop: 16 }}>
            {item.status === 'active' ? (
              <button
                type="button"
                className="button-danger"
                disabled={saving}
                onClick={() => {
                  if (!window.confirm('Архивировать контрагента? Объекты останутся без изменений.')) {
                    return;
                  }
                  void mutate(() => setCounterpartyArchived(item.id, true));
                }}
              >
                Архивировать
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void mutate(() => setCounterpartyArchived(item.id, false))
                }
              >
                Восстановить
              </button>
            )}
          </div>
        ) : null}
      </section>

      <section className="page-card workspace-surface">
        <div className="section-header">
          <div>
            <div className="section-title">Объекты</div>
            <div className="page-muted">
              Доступно: {item.visibleObjectCount} из {item.objectCount}
              {hiddenObjectCount > 0
                ? ` · ещё ${hiddenObjectCount} объект(а) скрыто вашей Object ACL`
                : ''}
            </div>
          </div>
        </div>

        {item.capabilities.canLinkObjects && item.status === 'active' ? (
          <div className="field-grid" style={{ marginBottom: 16 }}>
            <SearchableSelect
              label="Добавить / перенести объект"
              value={linkObjectId}
              options={[]}
              placeholder="Найти доступный объект"
              searchPlaceholder="Название, адрес или внутреннее имя"
              emptyText="Доступные объекты не найдены"
              asyncSearch={async (query) => {
                const result = await listObjectsPage({
                  q: query,
                  page: 1,
                  limit: 20,
                  sortBy: 'name',
                  sortDirection: 'asc',
                });
                return result.items
                  .filter((object) => object.id !== undefined)
                  .map(toObjectOption);
              }}
              onChange={setLinkObjectId}
            />
            <div className="action-row" style={{ alignItems: 'end' }}>
              <button
                type="button"
                disabled={saving || !linkObjectId}
                onClick={() => {
                  const objectId = linkObjectId;
                  void mutate(() =>
                    linkCounterpartyObject(item.id, objectId),
                  ).then(() => setLinkObjectId(''));
                }}
              >
                Привязать объект
              </button>
            </div>
          </div>
        ) : null}

        {item.objects.length === 0 ? (
          <div className="page-muted">Доступных связанных объектов нет.</div>
        ) : (
          <div className="record-list">
            {item.objects.map((object) => (
              <div
                key={object.id}
                className="record-card"
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <Link href={`/objects/${object.id}`}>{object.name}</Link>
                  <div className="page-muted">
                    {[object.internalName, object.address]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {item.capabilities.canLinkObjects ? (
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={saving}
                    onClick={() =>
                      void mutate(() =>
                        unlinkCounterpartyObject(item.id, object.id),
                      )
                    }
                  >
                    Отвязать
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="page-card workspace-surface">
        <div className="section-title">История</div>
        {history.length === 0 ? (
          <div className="page-muted">Изменений пока нет.</div>
        ) : (
          <div className="record-list" style={{ marginTop: 12 }}>
            {history.map((event) => (
              <article key={event.id} className="record-card">
                <div className="section-header">
                  <strong>{actionLabel(event.action)}</strong>
                  <time className="page-muted">
                    {new Date(event.createdAt).toLocaleString('ru-RU')}
                  </time>
                </div>
                <div className="page-muted">
                  {event.actor?.fullName ?? 'Система'}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
