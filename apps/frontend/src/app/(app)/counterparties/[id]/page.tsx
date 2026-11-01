'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import {
  getCounterparty,
  clearCounterpartyMasterObject,
  linkCounterpartyObject,
  listCounterpartyInventoryMovements,
  listCounterpartyHistoryPage,
  setCounterpartyArchived,
  setCounterpartyMasterObject,
  unlinkCounterpartyObject,
  updateCounterparty,
} from '@/entities/counterparty/api/counterparty-client';
import type { CounterpartyCard, CounterpartyHistoryPage } from '@/entities/counterparty/model/counterparty.types';
import type { CounterpartyInventoryMovement } from '@/entities/counterparty/model/counterparty.types';
import { getObjectById, listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { ConfirmDialog, useConfirm } from '@/shared/ui/overlays';
import { OverflowMenu } from '@/shared/ui/overflow-menu/overflow-menu';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { RegistryDateRange } from '@/shared/ui/registry-filters/registry-toolbar';
import { usePageExitGuard } from '@/shared/lib/use-page-exit-guard';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import styles from './counterparty-detail.module.css';
import { CounterpartyHistory, getCounterpartyHistoryActionLabel } from './counterparty-history';
import { hasHistoryFilters, HistoryFilterBar, type HistoryFilterValues } from '@/shared/ui/history-filters/history-filter-bar';
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
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

const EMPTY_HISTORY_FILTERS: HistoryFilterValues = {
  q: '', eventType: '', actorUserId: '', dateFrom: '', dateTo: '',
};

export default function CounterpartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<CounterpartyCard | null>(null);
  const [historyPageData, setHistoryPageData] = useState<CounterpartyHistoryPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoadedQueryKey, setHistoryLoadedQueryKey] = useState<string | null>(null);
  const [historyPageNumber, setHistoryPageNumber] = useState(1);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyFilters, setHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [extraObjectNames, setExtraObjectNames] = useState<Record<string, string>>({});
  const [inventoryMovements, setInventoryMovements] = useState<CounterpartyInventoryMovement[]>([]);
  const [inventoryMovementsTotal, setInventoryMovementsTotal] = useState(0);
  const [inventoryMovementsLoading, setInventoryMovementsLoading] = useState(false);
  const [inventoryMovementsError, setInventoryMovementsError] = useState<string | null>(null);
  const [inventoryMovementsLoadedQueryKey, setInventoryMovementsLoadedQueryKey] = useState<string | null>(null);
  const [inventoryMovementsRetry, setInventoryMovementsRetry] = useState(0);
  const [inventoryMovementsPage, setInventoryMovementsPage] = useState(1);
  const [inventoryMovementsTotalPages, setInventoryMovementsTotalPages] = useState(0);
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');
  const [movementObjectId, setMovementObjectId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isLinkingObject, setIsLinkingObject] = useState(false);
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
  const [confirm, confirmDialog] = useConfirm();
  const editNameRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      editNameRef.current?.focus();
      document.getElementById('counterparty-edit-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [editing]);

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
    const timeout = window.setTimeout(() => setAppliedHistoryFilters(historyFilters), 250);
    return () => window.clearTimeout(timeout);
  }, [historyFilters]);

  const historyQueryKey = JSON.stringify([item?.id, historyPageNumber, appliedHistoryFilters]);

  useEffect(() => {
    const counterpartyId = item?.id;
    if (activeTab !== 'history' || !counterpartyId) return;
    let active = true;
    const requestKey = historyQueryKey;
    setHistoryLoading(true);
    setHistoryError(null);
    void listCounterpartyHistoryPage(counterpartyId, {
      page: historyPageNumber,
      limit: 25,
      q: appliedHistoryFilters.q.trim() || undefined,
      eventType: appliedHistoryFilters.eventType || undefined,
      actorUserId: appliedHistoryFilters.actorUserId || undefined,
      dateFrom: appliedHistoryFilters.dateFrom || undefined,
      dateTo: appliedHistoryFilters.dateTo || undefined,
    })
      .then((response) => {
        if (!active) return;
        setHistoryPageData(response);
        setHistoryLoadedQueryKey(requestKey);
      })
      .catch((caughtError) => {
        if (active) setHistoryError(caughtError instanceof Error ? caughtError.message : 'Не удалось загрузить историю контрагента.');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, appliedHistoryFilters, historyPageNumber, historyQueryKey, historyRetry, item?.id]);

  const history = historyPageData?.items ?? [];

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

  const movementQueryKey = JSON.stringify([
    item?.id,
    inventoryMovementsPage,
    movementDateFrom,
    movementDateTo,
    movementObjectId,
    movementType,
  ]);

  useEffect(() => {
    if (activeTab !== 'overview' || !item) return;
    let active = true;
    const requestKey = movementQueryKey;
    setInventoryMovementsLoading(true);
    setInventoryMovementsError(null);
    void listCounterpartyInventoryMovements(item.id, {
      page: inventoryMovementsPage,
      limit: 10,
      dateFrom: movementDateFrom || undefined,
      dateTo: movementDateTo || undefined,
      objectId: movementObjectId || undefined,
      movementType: movementType || undefined,
    })
      .then((result) => {
        if (!active) return;
        setInventoryMovements(result.items);
        setInventoryMovementsTotal(result.total);
        setInventoryMovementsTotalPages(result.totalPages);
        setInventoryMovementsLoadedQueryKey(requestKey);
      })
      .catch((caughtError) => {
        if (active) setInventoryMovementsError(caughtError instanceof Error ? caughtError.message : 'Не удалось загрузить движения расходников.');
      })
      .finally(() => { if (active) setInventoryMovementsLoading(false); });
    return () => { active = false; };
  }, [activeTab, item?.id, movementQueryKey, inventoryMovementsRetry]);

  const mutate = async (
    operation: () => Promise<CounterpartyCard>,
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const next = await operation();
      sync(next);
      return true;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Не удалось сохранить изменение.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const editIsDirty = item !== null && (
    form.name !== item.name ||
    form.legalName !== (item.legalName ?? '') ||
    form.contactName !== (item.contactName ?? '') ||
    form.contactPhone !== (item.contactPhone ?? '') ||
    form.notes !== (item.notes ?? '')
  );
  usePageExitGuard(editing && editIsDirty, confirm);

  const cancelEdit = async (): Promise<void> => {
    if (editIsDirty && !(await confirm({
      title: 'Отменить изменения контрагента?',
      consequence: 'Введённые данные не будут сохранены.',
      confirmLabel: 'Отменить изменения',
      tone: 'danger',
    }))) return;
    if (item) sync(item);
    setEditing(false);
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
              <Button variant="primary" onClick={() => {
                if (editing) void cancelEdit();
                else { setActiveTab('overview'); setEditing(true); }
              }}>
                {editing ? 'Отменить редактирование' : 'Редактировать'}
              </Button>
            ) : null}
            {item.capabilities.canManage ? (
              item.status === 'active' ? <OverflowMenu triggerLabel="Действия с контрагентом" items={[
                { key: 'archive', label: 'В архив', tone: 'danger', disabled: saving, onSelect: () => { setArchiveError(null); setArchiveDialogOpen(true); } },
              ]} /> : <Button disabled={saving} onClick={() => void mutate(() => setCounterpartyArchived(item.id, false))}>Восстановить</Button>
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
        onChange={(value) => {
          const nextTab = value as 'overview' | 'history';
          if (nextTab === activeTab) return;
          if (editing && editIsDirty) {
            void confirm({
              title: 'Закрыть редактирование?',
              consequence: 'Несохранённые изменения будут отменены перед переходом в другой раздел.',
              confirmLabel: 'Отменить изменения',
              tone: 'danger',
            }).then((accepted) => {
              if (!accepted) return;
              if (item) sync(item);
              setEditing(false);
              setActiveTab(nextTab);
            });
            return;
          }
          setActiveTab(nextTab);
        }}
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
              ).then((saved) => { if (saved) setEditing(false); });
            }}
          >
            <Field label="Название" required>
              <input
                required
                minLength={2}
                ref={editNameRef}
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
              <Button onClick={() => void cancelEdit()}>
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
          {item.capabilities.canLinkObjects && item.status === 'active' && !isLinkingObject ? (
            <Button className={styles.addObjectButton} variant="primary" onClick={() => setIsLinkingObject(true)}>Добавить объект</Button>
          ) : null}
        </div>

        {item.capabilities.canLinkObjects && item.status === 'active' && isLinkingObject ? (
          <div className={styles.objectLinkForm}>
            <SearchableSelect
              label="Объект для связи"
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
                  void confirm({
                    title: 'Связать объект с контрагентом?',
                    consequence: 'Если объект сейчас связан с другим контрагентом, связь будет перенесена. Текущий мастер-статус объекта при переносе может быть снят.',
                    confirmLabel: 'Связать объект',
                  }).then(async (accepted) => {
                    if (!accepted) return;
                    if (await mutate(() => linkCounterpartyObject(item.id, objectId))) {
                      setLinkObjectId('');
                      setIsLinkingObject(false);
                    }
                  });
                }}
              >
                Привязать объект
              </Button>
              <Button disabled={saving} onClick={() => { setLinkObjectId(''); setIsLinkingObject(false); }}>Отмена</Button>
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
                  {item.capabilities.canLinkObjects ? <OverflowMenu triggerLabel={`Действия с объектом ${object.name}`} items={[
                    ...(item.status === 'active' ? [{
                      key: 'master',
                      label: item.masterObject?.id === object.id ? 'Снять мастер-объект' : 'Назначить мастер-объектом',
                      disabled: saving,
                      onSelect: () => {
                        const isMaster = item.masterObject?.id === object.id;
                        void confirm({
                          title: isMaster ? 'Снять мастер-объект?' : 'Назначить мастер-объектом?',
                          consequence: isMaster ? 'Контрагент останется связан с объектом, но объект перестанет быть основным.' : 'Текущий мастер-объект контрагента будет заменён.',
                          confirmLabel: isMaster ? 'Снять назначение' : 'Назначить',
                        }).then((accepted) => {
                          if (accepted) void mutate(() => isMaster
                            ? clearCounterpartyMasterObject(item.id)
                            : setCounterpartyMasterObject(item.id, object.id));
                        });
                      },
                    }] : []),
                    {
                      key: 'unlink', label: 'Отвязать от контрагента', tone: 'danger', disabled: saving,
                      onSelect: () => void confirm({
                        title: 'Отвязать объект?',
                        consequence: 'Связь объекта с этим контрагентом будет удалена. История операции сохранится.',
                        confirmLabel: 'Отвязать', tone: 'danger',
                      }).then((accepted) => {
                        if (accepted) void mutate(() => unlinkCounterpartyObject(item.id, object.id));
                      }),
                    },
                  ]} /> : null}
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
        <div className={styles.movementFilters} aria-label="Фильтры движений расходников">
          <RegistryDateRange
            label="Период, МСК"
            from={movementDateFrom}
            to={movementDateTo}
            onFromChange={(value) => { setInventoryMovementsPage(1); setMovementDateFrom(value); }}
            onToChange={(value) => { setInventoryMovementsPage(1); setMovementDateTo(value); }}
          />
          <SearchableSelect
            label="Фактический объект"
            value={movementObjectId}
            options={item.objects.map((object) => ({
              value: object.id,
              label: object.name,
              description: [object.internalName, object.address].filter(Boolean).join(' · ') || undefined,
              searchText: `${object.name} ${object.internalName ?? ''} ${object.address ?? ''}`,
            }))}
            selectedOption={null}
            placeholder="Все объекты"
            searchPlaceholder="Название или адрес связанного объекта"
            emptyText="Связанные объекты не найдены"
            minimumSearchLength={0}
            onChange={(value) => {
              setMovementObjectId(value);
              setInventoryMovementsPage(1);
            }}
          />
          <SearchableSelect
            label="Операция"
            value={movementType}
            options={[
              { value: 'receipt', label: 'Поступление' },
              { value: 'return', label: 'Возврат' },
              { value: 'issue_to_object', label: 'Выдача на объект' },
              { value: 'issue_to_one_time_order', label: 'Выдача на разовый заказ' },
              { value: 'writeoff', label: 'Списание' },
              { value: 'adjustment', label: 'Корректировка' },
            ]}
            searchable={false}
            placeholder="Все операции"
            onChange={(value) => { setMovementType(value); setInventoryMovementsPage(1); }}
          />
          {(movementDateFrom || movementDateTo || movementObjectId || movementType) ? (
            <Button variant="ghost" onClick={() => {
              setMovementDateFrom(''); setMovementDateTo(''); setMovementObjectId('');
              setMovementType(''); setInventoryMovementsPage(1);
            }}>Сбросить</Button>
          ) : null}
        </div>
        {inventoryMovementsError ? (
          <Alert tone="warning" role="alert">
            <div className="ui-inline">
              <span>{inventoryMovementsError}</span>
              {inventoryMovements.length > 0 && inventoryMovementsLoadedQueryKey !== movementQueryKey ? (
                <span>Показаны движения по предыдущим фильтрам; они не соответствуют выбранному периоду, объекту и операции.</span>
              ) : null}
              <Button onClick={() => setInventoryMovementsRetry((value) => value + 1)}>Повторить</Button>
            </div>
          </Alert>
        ) : null}
        {inventoryMovementsLoading ? <LoadingState label="Загружаем движения…" /> : inventoryMovements.length === 0 ? (
          <EmptyState
            title={inventoryMovementsError ? 'Не удалось загрузить движения' : 'Движений расходников пока нет'}
            description={inventoryMovementsError ? 'Повторите загрузку, чтобы увидеть результат фильтра.' : 'Здесь появятся движения по доступным вам объектам.'}
          />
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
            <span className={styles.muted}>{historyPageData?.total ?? 0}</span>
          </div>
          <HistoryFilterBar
            filters={historyFilters}
            eventTypes={(historyPageData?.facets.eventTypes ?? []).map((eventType) => ({
              value: eventType,
              label: getCounterpartyHistoryActionLabel(eventType),
            }))}
            actors={historyPageData?.facets.actors ?? []}
            actorsHasMore={historyPageData?.facets.actorsHasMore ?? false}
            eventTypesHasMore={historyPageData?.facets.eventTypesHasMore ?? false}
            busy={historyLoading}
            onActorSearch={async (actorSearch) => {
              const result = await listCounterpartyHistoryPage(item.id, {
                page: 1, limit: 1, actorSearch,
              });
              return result.facets.actors;
            }}
            onChange={(nextFilters) => {
              setHistoryFilters(nextFilters);
              setHistoryPageNumber(1);
            }}
          />
          {historyError || (historyLoadedQueryKey !== historyQueryKey && history.length > 0) ? (
            <Alert tone={historyError ? 'warning' : 'info'} role={historyError ? 'alert' : 'status'}>
              <div className="ui-inline">
                <span>{historyError ?? 'Показаны события по предыдущим фильтрам, пока загружается новый результат.'}</span>
                {historyError ? <Button onClick={() => setHistoryRetry((value) => value + 1)}>Повторить</Button> : null}
              </div>
            </Alert>
          ) : null}
          {historyLoading && history.length === 0 ? <LoadingState label="Загружаем историю…" /> : null}
          {!historyLoading && history.length === 0 ? (
            <EmptyState title={historyError ? 'Не удалось загрузить историю' : historyPageData?.total === 0 && historyLoadedQueryKey === historyQueryKey && hasHistoryFilters(appliedHistoryFilters) ? 'По выбранным фильтрам событий нет' : 'История изменений пока пуста'} />
          ) : null}
          {history.length > 0 ? <CounterpartyHistory items={history} objectNames={historyObjectNames} /> : null}
          {historyPageData ? (
            <TablePagination
              page={historyPageData.page}
              totalPages={historyPageData.totalPages}
              pending={historyLoading || historyLoadedQueryKey !== historyQueryKey}
              label="Страницы истории контрагента"
              summary={historyPageData.total > 0 ? `Показано ${(historyPageData.page - 1) * historyPageData.limit + 1}–${Math.min(historyPageData.page * historyPageData.limit, historyPageData.total)} из ${historyPageData.total}` : 'Событий не найдено'}
              onPageChange={setHistoryPageNumber}
            />
          ) : null}
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
      {confirmDialog}
    </Stack>
  );
}
