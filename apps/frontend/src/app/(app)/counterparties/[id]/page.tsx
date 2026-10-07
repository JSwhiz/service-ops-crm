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
import type { CounterpartyCard, CounterpartyHistoryItem } from '@/entities/counterparty/model/counterparty.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import { ConfirmDialog } from '@/shared/ui/overlays';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

import styles from '../counterparties.module.css';

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

function historyActionLabel(action: string): string {
  switch (action) {
    case 'counterparty.created': return 'Контрагент создан';
    case 'counterparty.updated': return 'Данные изменены';
    case 'counterparty.archived': return 'Контрагент перенесён в архив';
    case 'counterparty.restored': return 'Контрагент восстановлен';
    case 'counterparty.object_linked': return 'Объект привязан';
    case 'counterparty.object_unlinked': return 'Объект отвязан';
    case 'counterparty.object_unlinked_by_relink': return 'Объект перенесён к другому контрагенту';
    default: return action;
  }
}

export default function CounterpartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<CounterpartyCard | null>(null);
  const [history, setHistory] = useState<CounterpartyHistoryItem[]>([]);
  const [historyLoadedForId, setHistoryLoadedForId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    void params
      .then(({ id: counterpartyId }) => {
        if (!active) return null;
        return getCounterparty(counterpartyId);
      })
      .then((result) => {
        if (!active || !result) return;
        sync(result);
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

  useEffect(() => {
    if (activeTab !== 'history' || !item || historyLoadedForId === item.id) return;
    let active = true;
    setHistoryLoading(true);
    void listCounterpartyHistory(item.id)
      .then((events) => {
        if (!active) return;
        setHistory(events);
        setHistoryLoadedForId(item.id);
      })
      .catch((caughtError) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : 'Не удалось загрузить историю контрагента.');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, historyLoadedForId, item]);

  const mutate = async (
    operation: () => Promise<CounterpartyCard>,
  ): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const next = await operation();
      sync(next);
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
      <div className={`workspace-page counterparty-workspace page-stack ${styles.page}`}>
        <PageTitle title="Контрагент" />
        <div className={`page-card workspace-surface ${styles.surface} ${styles.loading}`}>Загружаем карточку…</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className={`workspace-page counterparty-workspace page-stack ${styles.page}`}>
        <PageTitle title="Контрагент" />
        <div className={`${styles.surface} ${styles.error}`} role="alert">
          {error ?? 'Контрагент не найден.'}
        </div>
      </div>
    );
  }

  return (
    <div className={`workspace-page counterparty-workspace ${styles.page} ${styles.detailPage}`}>
      <section className={`page-card workspace-surface hero-card ${styles.counterpartyHero}`}>
        <div className={styles.summaryTop}>
          <div className={styles.summaryIdentity}>
            <div className={styles.summaryTitleRow}>
              <h1 className="hero-title">{item.name}</h1>
              <span className="status-pill" data-status={item.status}>{item.status === 'active' ? 'Активный' : 'Архив'}</span>
            </div>
            {item.legalName ? <div className={styles.summaryLegalName}><span>Юридическое название</span><strong>{item.legalName}</strong></div> : null}
          </div>
          <div className={styles.summaryActions}>
            {item.capabilities.canManage ? (
              <button type="button" className={`button-link object-summary__primary-action ${styles.summaryButton}`} onClick={() => setEditing((current) => !current)}>
                {editing ? 'Отменить' : 'Редактировать'}
              </button>
            ) : null}
            <button type="button" className={`button-link ${styles.historyButton}`} onClick={() => { setEditing(false); setActiveTab('history'); }}>
              История
            </button>
          </div>
        </div>
        <div className={`detail-grid ${styles.summaryFacts}`}>
          <div className="detail-field"><div className="detail-label">Основной контакт</div><div className="detail-value">{item.contactName || 'Не указан'}</div></div>
          <div className="detail-field"><div className="detail-label">Телефон</div><div className="detail-value">{item.contactPhone || 'Не указан'}</div></div>
          <div className="detail-field"><div className="detail-label">Связанные объекты</div><div className="detail-value">{item.objectCount}</div></div>
        </div>
        {item.notes ? <div className={`object-summary__note ${styles.summaryNote}`}><div className="detail-label">Комментарий</div><div className="detail-value">{item.notes}</div></div> : null}
      </section>

      <nav className={styles.navigation} aria-label="Разделы контрагента" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'overview'} className={activeTab === 'overview' ? styles.navigationActive : undefined} onClick={() => { setActiveTab('overview'); setEditing(false); }}>Обзор</button>
        <button type="button" role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? styles.navigationActive : undefined} onClick={() => { setActiveTab('history'); setEditing(false); }}>История</button>
      </nav>

      {error ? (
        <div className={`${styles.surface} ${styles.error}`} role="alert">
          {error}
        </div>
      ) : null}

      {activeTab === 'overview' ? <>
      <section className={`page-card workspace-surface ${styles.surface} ${styles.statusSection}`}>
        <div className={styles.statusHeader}>
          <h2 className={styles.sectionTitle}>Статус контрагента</h2>
          <div className={styles.statusActions}>
            <span className="status-pill" data-status={item.status}>{item.status === 'active' ? 'Активный' : 'Архив'}</span>
            {item.capabilities.canManage ? (
              item.status === 'active' ? (
                <button type="button" className={styles.statusAction} disabled={saving} onClick={() => { setArchiveError(null); setArchiveDialogOpen(true); }}>
                  <MediaActionIcon name="archive" />
                  В архив
                </button>
              ) : (
                <button type="button" className={styles.statusAction} disabled={saving} onClick={() => void mutate(() => setCounterpartyArchived(item.id, false))}>Восстановить</button>
              )
            ) : null}
          </div>
        </div>
      </section>

      {editing ? <section className={`page-card workspace-surface ${styles.surface} ${styles.section} ${styles.detailSurface}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Редактирование контрагента</h2>
          </div>
        </div>

        {editing ? (
          <form
            className={styles.inlineForm}
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
                placeholder="Например, ООО «Чистота»"
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
                placeholder="Полное название организации"
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
                placeholder="ФИО контактного лица"
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
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={form.contactPhone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactPhone: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.fullRow}>
              <span>Комментарий</span>
              <textarea
                rows={4}
                placeholder="Условия сотрудничества, важные договорённости…"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
            <div className={`${styles.formActions} ${styles.fullRow}`}>
              <button type="button" className={styles.secondaryButton} onClick={() => { sync(item); setEditing(false); }}>
                Отмена
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={saving || form.name.trim().length < 2}
              >
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </form>
        ) : null}

      </section> : null}

      <section className={`page-card workspace-surface ${styles.surface} ${styles.section} ${styles.detailSurface}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Связанные объекты</h2>
            <div className={styles.muted}>
              Доступно: {item.visibleObjectCount} из {item.objectCount}
              {hiddenObjectCount > 0
                ? ` · ещё ${hiddenObjectCount} ${hiddenObjectCount === 1 ? 'объект скрыт' : 'объекта скрыты'} согласно правам доступа`
                : ''}
            </div>
          </div>
        </div>

        {item.capabilities.canLinkObjects && item.status === 'active' ? (
          <div className={styles.objectLinkForm}>
            <SearchableSelect
              label="Добавить / перенести объект"
              hideLabel
              value={linkObjectId}
              options={[]}
              placeholder="Найти доступный объект"
              searchPlaceholder="Название, адрес или внутреннее имя"
              emptyText="Доступные объекты не найдены"
              viewportAware
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
            <div className={styles.objectLinkAction}>
              <button
                type="button"
                className={styles.primaryButton}
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
          <div className={styles.emptyState}>Связанных объектов пока нет.</div>
        ) : (
          <div className={styles.recordList}>
            {item.objects.map((object) => (
              <div key={object.id} className={styles.recordCard}>
                <div className={styles.recordMain}>
                  <Link className={styles.recordLink} href={`/objects/${object.id}`}>{object.name}</Link>
                  <div className={styles.muted}>
                    {[object.internalName, object.address]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {item.capabilities.canLinkObjects ? (
                  <button
                    type="button"
                    className={styles.quietButton}
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
      </> : (
        <section className={`page-card workspace-surface ${styles.surface} ${styles.section} ${styles.detailSurface}`}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>История изменений</h2>
            <span className={styles.muted}>{history.length}</span>
          </div>
          {historyLoading ? (
            <div className={styles.emptyState}>Загружаем историю…</div>
          ) : history.length === 0 ? (
            <div className={styles.emptyState}>История изменений пока пуста.</div>
          ) : (
            <div className={styles.recordList}>
              {history.map((event) => (
                <article key={event.id} className={styles.recordCard}>
                  <div className={styles.recordMain}>
                    <strong>{historyActionLabel(event.action)}</strong>
                    <div className={styles.muted}>{event.actor?.fullName ?? 'Система'}</div>
                  </div>
                  <time className={styles.muted}>{new Date(event.createdAt).toLocaleString('ru-RU')}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={(open) => {
          setArchiveDialogOpen(open);
          if (!open) setArchiveError(null);
        }}
        title="Перенести контрагента в архив?"
        consequence="Связанные объекты останутся без изменений. Контрагента можно будет восстановить позже."
        confirmLabel="В архив"
        tone="danger"
        pending={saving}
        error={archiveError}
        onConfirm={() => {
          setSaving(true);
          setArchiveError(null);
          void setCounterpartyArchived(item.id, true)
            .then((next) => {
              sync(next);
              setArchiveDialogOpen(false);
            })
            .catch((caughtError) => {
              setArchiveError(caughtError instanceof Error ? caughtError.message : 'Не удалось перенести контрагента в архив.');
            })
            .finally(() => setSaving(false));
        }}
      />
    </div>
  );
}
