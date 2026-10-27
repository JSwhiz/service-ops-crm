'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import {
  getCounterparty,
  clearCounterpartyMasterObject,
  linkCounterpartyObject,
  listCounterpartyInventoryMovements,
  listCounterpartyHistory,
  setCounterpartyArchived,
  setCounterpartyMasterObject,
  unlinkCounterpartyObject,
  updateCounterparty,
} from '@/entities/counterparty/api/counterparty-client';
import type { CounterpartyCard, CounterpartyHistoryItem } from '@/entities/counterparty/model/counterparty.types';
import type { CounterpartyInventoryMovement } from '@/entities/counterparty/model/counterparty.types';
import { getObjectById, listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import { ConfirmDialog } from '@/shared/ui/overlays';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import styles from './counterparty-detail.module.css';
import { CounterpartyHistory } from './counterparty-history';
import { Alert, BackLink, Badge, Button, EmptyState, FactStrip, Field, LoadingState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';

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

function movementTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    receipt: 'Поступление', return: 'Возврат', issue_to_object: 'Списание на объект',
    issue_to_one_time_order: 'Списание на разовый заказ', writeoff: 'Списание', adjustment: 'Корректировка',
  };
  return labels[type] ?? type;
}

function movementStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    applied: 'Проведено', pending_approval: 'На проверке', rejected: 'Отклонено', cancelled: 'Отменено',
  };
  return labels[status] ?? status;
}

function formatMovementDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
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
  const [extraObjectNames, setExtraObjectNames] = useState<Record<string, string>>({});
  const [inventoryMovements, setInventoryMovements] = useState<CounterpartyInventoryMovement[]>([]);
  const [inventoryMovementsTotal, setInventoryMovementsTotal] = useState(0);
  const [inventoryMovementsLoading, setInventoryMovementsLoading] = useState(false);
  const [inventoryMovementsPage, setInventoryMovementsPage] = useState(1);
  const [inventoryMovementsTotalPages, setInventoryMovementsTotalPages] = useState(0);
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

  const historyObjectNames = useMemo(() => {
    const names = new Map<string, string>(Object.entries(extraObjectNames));
    if (item?.masterObject) names.set(item.masterObject.id, item.masterObject.name);
    for (const object of item?.objects ?? []) names.set(object.id, object.name);
    return names;
  }, [extraObjectNames, item]);

  useEffect(() => {
    const missing = new Set<string>();
    for (const event of history) {
      for (const values of [event.oldValues, event.newValues]) {
        const id = values?.objectId;
        if (typeof id === 'string' && !historyObjectNames.has(id)) missing.add(id);
      }
    }
    if (missing.size === 0) return;
    let cancelled = false;
    void Promise.allSettled([...missing].map((id) => getObjectById(id))).then((results) => {
      if (cancelled) return;
      const found: Record<string, string> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled') found[result.value.id] = result.value.name;
      });
      if (Object.keys(found).length) setExtraObjectNames((current) => ({ ...current, ...found }));
    });
    return () => { cancelled = true; };
  }, [history, historyObjectNames]);

  useEffect(() => {
    if (activeTab !== 'overview' || !item) return;
    let active = true;
    setInventoryMovementsLoading(true);
    void listCounterpartyInventoryMovements(item.id, { page: inventoryMovementsPage, limit: 10 })
      .then((result) => {
        if (!active) return;
        setInventoryMovements(result.items);
        setInventoryMovementsTotal(result.total);
        setInventoryMovementsTotalPages(result.totalPages);
      })
      .catch((caughtError) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : 'Не удалось загрузить движения расходников.');
      })
      .finally(() => { if (active) setInventoryMovementsLoading(false); });
    return () => { active = false; };
  }, [activeTab, inventoryMovementsPage, item?.id]);

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
      <div className={`ui-page counterparty-workspace ui-stack ui-stack--lg ${styles.page}`}>
        <BackLink href="/counterparties">Контрагенты</BackLink>
        <LoadingState label="Загружаем карточку…" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className={`ui-page counterparty-workspace ui-stack ui-stack--lg ${styles.page}`}>
        <BackLink href="/counterparties">Контрагенты</BackLink>
        <Alert tone="danger">
          {error ?? 'Контрагент не найден.'}
        </Alert>
      </div>
    );
  }

  return (
    <Stack gap="lg" className={`ui-page ${styles.page}`}>
      <BackLink href="/counterparties">Контрагенты</BackLink>
      <Surface as="section" padding="md" className={styles.counterpartyHero}>
        <div className={styles.summaryTop}>
          <div className={styles.summaryIdentity}>
            <div className={styles.summaryTitleRow}>
              <h1 className={styles.title}>{item.name}</h1>
              <StatusBadge status={item.status}>{item.status === 'active' ? 'Активный' : 'Архив'}</StatusBadge>
            </div>
            {item.legalName ? <div className={styles.summaryLegalName}><span>Юридическое название</span><strong>{item.legalName}</strong></div> : null}
          </div>
          <div className={styles.summaryActions}>
            {item.capabilities.canManage ? (
              <Button variant="primary" onClick={() => setEditing((current) => !current)}>
                {editing ? 'Отменить' : 'Редактировать'}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => { setEditing(false); setActiveTab('history'); }}>
              История
            </Button>
            {item.capabilities.canManage ? (
              item.status === 'active' ? (
                <Button variant="ghost" disabled={saving} onClick={() => { setArchiveError(null); setArchiveDialogOpen(true); }}>
                  <MediaActionIcon name="archive" />
                  В архив
                </Button>
              ) : (
                <Button disabled={saving} onClick={() => void mutate(() => setCounterpartyArchived(item.id, false))}>Восстановить</Button>
              )
            ) : null}
          </div>
        </div>
        <FactStrip items={[
          { label: 'Основной контакт', value: item.contactName || 'Не указан' },
          { label: 'Телефон', value: item.contactPhone || 'Не указан' },
          { label: 'Связанные объекты', value: item.objectCount },
        ]} />
        {item.notes ? <div className={styles.summaryNote}><div className="ui-detail-label">Комментарий</div><div>{item.notes}</div></div> : null}
      </Surface>

      <WorkspaceTabs
        items={[{ value: 'overview', label: 'Обзор' }, { value: 'history', label: 'История' }]}
        value={activeTab}
        onChange={(value) => { setActiveTab(value as 'overview' | 'history'); setEditing(false); }}
        label="Разделы контрагента"
        idPrefix="counterparty"
      />

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      {activeTab === 'overview' ? <>
      {editing ? <Surface as="section" padding="md" className={`${styles.surface} ${styles.section} ${styles.detailSurface}`}>
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
            <Field label="Название" required>
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
            </Field>
            <Field label="Юридическое название">
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
            </Field>
            <Field label="Основной контакт">
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
            </Field>
            <Field label="Телефон">
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
            </Field>
            <Field label="Комментарий" className={styles.fullRow}>
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
            </Field>
            <div className={`${styles.formActions} ${styles.fullRow}`}>
              <Button onClick={() => { sync(item); setEditing(false); }}>
                Отмена
              </Button>
              <Button variant="primary"
                type="submit"
                disabled={saving || form.name.trim().length < 2}
              >
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </div>
          </form>
        ) : null}

      </Surface> : null}

      <Surface as="section" padding="md" className={`${styles.surface} ${styles.section} ${styles.detailSurface}`}>
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
              <Button variant="primary"
                disabled={saving || !linkObjectId}
                onClick={() => {
                  const objectId = linkObjectId;
                  void mutate(() =>
                    linkCounterpartyObject(item.id, objectId),
                  ).then(() => setLinkObjectId(''));
                }}
              >
                Привязать объект
              </Button>
            </div>
          </div>
        ) : null}

        {item.objects.length === 0 ? (
          <EmptyState title="Связанных объектов пока нет" />
        ) : (
          <ul className={styles.recordList}>
            {item.objects.map((object) => (
              <li key={object.id} className={styles.recordCard}>
                <div className={styles.recordMain}>
                  <div className={styles.recordIdentity}>
                    <Link className={styles.recordLink} href={`/objects/${object.id}`}>{object.name}</Link>
                    {item.masterObject?.id === object.id ? <Badge tone="success">Мастер-объект</Badge> : null}
                  </div>
                  <div className={styles.muted}>
                    {[object.internalName, object.address]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className={styles.recordActions}>
                {item.capabilities.canLinkObjects && item.status === 'active' ? (
                  item.masterObject?.id === object.id ? (
                    <Button variant="ghost" disabled={saving} onClick={() => void mutate(() => clearCounterpartyMasterObject(item.id))}>Снять мастер-объект</Button>
                  ) : (
                    <Button variant="ghost" disabled={saving} onClick={() => void mutate(() => setCounterpartyMasterObject(item.id, object.id))}>Назначить мастером</Button>
                  )
                ) : null}
                {item.capabilities.canLinkObjects ? (
                  <Button variant="ghost"
                    disabled={saving}
                    onClick={() =>
                      void mutate(() =>
                        unlinkCounterpartyObject(item.id, object.id),
                      )
                    }
                  >
                    Отвязать
                  </Button>
                ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface as="section" padding="md" className={`${styles.surface} ${styles.section} ${styles.detailSurface}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Движения расходников по объектам</h2>
            <div className={styles.muted}>Показываются движения только по объектам, доступным вам. У каждой записи указан фактический объект.</div>
          </div>
        </div>
        {inventoryMovementsLoading ? <LoadingState label="Загружаем движения…" /> : inventoryMovements.length === 0 ? (
          <EmptyState title="Движений расходников пока нет" description="Здесь появятся движения по доступным вам объектам." />
        ) : (
          <>
            <DataTable label="Движения расходников по объектам контрагента" className={styles.movementsTable}>
              <thead><tr>
                <th scope="col">Расходник / операция</th>
                <th scope="col" className={styles.quantityColumn}>Количество</th>
                <th scope="col">Фактический объект</th>
                <th scope="col">Состояние</th>
                <th scope="col">Дата / автор</th>
              </tr></thead>
              <tbody>
              {inventoryMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>
                    <strong>{movement.inventoryItem.name}</strong>
                    <div className={styles.muted}>{movementTypeLabel(movement.movementType)}</div>
                  </td>
                  <td className={styles.movementQuantity} data-direction={movement.signedQuantity < 0 ? 'out' : 'in'}>
                    {movement.signedQuantity > 0 ? '+' : ''}{movement.signedQuantity} {movement.inventoryItem.unit}
                  </td>
                  <td>
                    {movement.relatedObject?.canOpenObjectCard ? <Link className={styles.recordLink} href={`/objects/${movement.relatedObject.id}`}>{movement.relatedObject.name}</Link> : <strong>{movement.relatedObject?.name ?? 'Объект не указан'}</strong>}
                    {movement.comment ? <div className={styles.muted}>{movement.comment}</div> : null}
                  </td>
                  <td><StatusBadge status={movement.status}>{movementStatusLabel(movement.status)}</StatusBadge></td>
                  <td><time dateTime={movement.createdAt}>{formatMovementDate(movement.createdAt)}</time><div className={styles.muted}>{movement.createdBy.fullName}</div></td>
                </tr>
              ))}
              </tbody>
            </DataTable>
            <TablePagination page={inventoryMovementsPage} totalPages={inventoryMovementsTotalPages} pending={inventoryMovementsLoading} label="Страницы движений контрагента"
              summary={inventoryMovementsTotal > 0 ? `Показано ${(inventoryMovementsPage - 1) * 10 + 1}–${Math.min(inventoryMovementsPage * 10, inventoryMovementsTotal)} из ${inventoryMovementsTotal}` : 'Движения не найдены'}
              onPageChange={setInventoryMovementsPage} />
          </>
        )}
      </Surface>
      </> : (
        <Surface as="section" padding="md" className={`${styles.surface} ${styles.section} ${styles.detailSurface}`}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>История изменений</h2>
            <span className={styles.muted}>{history.length}</span>
          </div>
          {historyLoading ? (
            <LoadingState label="Загружаем историю…" />
          ) : history.length === 0 ? (
            <EmptyState title="История изменений пока пуста" />
          ) : (
            <CounterpartyHistory items={history} objectNames={historyObjectNames} />
          )}
        </Surface>
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
    </Stack>
  );
}
