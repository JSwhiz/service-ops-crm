'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import {
  approveApprovalRequest,
  cancelApprovalRequest,
  listApprovalRequestsPage,
  rejectApprovalRequest,
} from '@/entities/approval/api/approval-client';
import {
  getApprovalSubtitle,
  getApprovalTitle,
  getStringValue,
} from '@/entities/approval/model/approval-summary';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import {
  APPROVAL_SOURCE_OPTIONS,
  APPROVAL_STATUS_OPTIONS,
  APPROVAL_TYPE_OPTIONS,
  getApprovalSourceLabel,
  getApprovalStatusLabel,
  getApprovalTypeLabel,
} from '@/shared/lib/approval-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';
import { usePageSizeParam } from '@/shared/lib/use-page-size-param';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { Alert, Badge, Button, EmptyState, Skeleton, Surface } from '@/shared/ui/foundation';
import {
  ConfirmDialog,
  Drawer,
  ReasonDialog,
} from '@/shared/ui/overlays';

import { RegistryDateRange, RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import styles from './approvals.module.css';

type ApprovalStatusTone = 'neutral' | 'danger' | 'warning' | 'success';

const PAGE_LIMIT = 20;

interface BusinessContextItem {
  label: string;
  value: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function getApprovalStatusTone(status: string): ApprovalStatusTone {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

function ApprovalStatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge className={styles.statusBadge} tone={getApprovalStatusTone(status)}>
      {getApprovalStatusLabel(status)}
    </Badge>
  );
}

function getNumberValue(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? day + '.' + month + '.' + year : value;
}

function getBusinessContext(item: ApprovalRequestItem): BusinessContextItem[] {
  const payload = item.payloadSnapshot;
  const context: BusinessContextItem[] = [];
  const taskTitle = getStringValue(payload, 'taskTitle');
  const objectName = getStringValue(payload, 'objectName');
  const inventoryNumber = getStringValue(payload, 'inventoryNumber');
  const employeeName = getStringValue(payload, 'employeeName');
  const comment = getStringValue(payload, 'comment');
  const startDate = getStringValue(payload, 'startDate');
  const endDate = getStringValue(payload, 'endDate');
  const fromStatus = getStringValue(payload, 'fromStatus');
  const toStatus = getStringValue(payload, 'toStatus');
  const year = getNumberValue(payload, 'year');
  const month = getNumberValue(payload, 'month');
  const dayOfMonth = getNumberValue(payload, 'dayOfMonth');
  const currentDayValue = getNumberValue(payload, 'currentDayValue');
  const requestedDayValue = getNumberValue(payload, 'requestedDayValue');

  if (taskTitle) {
    context.push({ label: 'Задача', value: taskTitle });
  }
  if (objectName) {
    context.push({ label: 'Объект', value: objectName });
  }
  if (inventoryNumber) {
    context.push({ label: 'Инвентарный номер', value: inventoryNumber });
  }
  if (employeeName) {
    context.push({ label: 'Сотрудник', value: employeeName });
  }

  if (startDate && endDate) {
    context.push({
      label: 'Период',
      value: formatDateOnly(startDate) + ' — ' + formatDateOnly(endDate),
    });
  }

  if (year !== null && month !== null && dayOfMonth !== null) {
    context.push({
      label: 'Дата табеля',
      value:
        String(dayOfMonth).padStart(2, '0') +
        '.' +
        String(month).padStart(2, '0') +
        '.' +
        year,
    });
  }

  if (currentDayValue !== null) {
    context.push({
      label: 'Текущее значение',
      value: String(currentDayValue),
    });
  }
  if (requestedDayValue !== null) {
    context.push({
      label: 'Предложенное значение',
      value: String(requestedDayValue),
    });
  }

  if (fromStatus && toStatus) {
    context.push({
      label: 'Изменение состояния',
      value:
        getEquipmentStatusLabel(fromStatus) +
        ' → ' +
        getEquipmentStatusLabel(toStatus),
    });
  }

  if (comment) {
    context.push({ label: 'Комментарий запроса', value: comment });
  }

  return context;
}

function getRelatedEntityLink(item: ApprovalRequestItem): React.ReactNode {
  if (item.sourceEntityType === 'task') {
    return (
      <Link href={'/tasks/' + item.sourceEntityId}>Открыть задачу</Link>
    );
  }

  if (item.sourceEntityType === 'object') {
    return (
      <Link href={'/objects/' + item.sourceEntityId}>Открыть объект</Link>
    );
  }

  if (
    item.sourceEntityType === 'inventory_movement' &&
    typeof item.payloadSnapshot.inventoryItemId === 'string'
  ) {
    return (
      <Link href={'/inventory/' + item.payloadSnapshot.inventoryItemId}>
        Открыть расходник
      </Link>
    );
  }

  if (
    item.sourceEntityType === 'equipment_movement' &&
    typeof item.payloadSnapshot.equipmentUnitId === 'string'
  ) {
    return (
      <Link href={'/equipment/' + item.payloadSnapshot.equipmentUnitId}>
        Открыть оборудование
      </Link>
    );
  }

  if (
    item.sourceEntityType === 'timesheet_exception' &&
    typeof item.payloadSnapshot.objectId === 'string' &&
    typeof item.payloadSnapshot.year === 'number' &&
    typeof item.payloadSnapshot.month === 'number'
  ) {
    const query = new URLSearchParams({
      objectId: item.payloadSnapshot.objectId,
      year: String(item.payloadSnapshot.year),
      month: String(item.payloadSnapshot.month),
    });

    return (
      <Link href={'/timesheet?' + query.toString()}>Открыть табель</Link>
    );
  }

  if (item.sourceEntityType === 'accountability_closure') {
    return <Link href="/accountability">Открыть подотчёт</Link>;
  }

  return null;
}

export default function ApprovalsPage(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const approvalType = searchParams.get('approvalType') ?? '';
  const sourceEntityType = searchParams.get('sourceEntityType') ?? '';
  const sourceEntityId = searchParams.get('sourceEntityId') ?? '';
  const search = searchParams.get('search') ?? '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const periodActive = searchParams.get('period') === '1' || Boolean(dateFrom || dateTo);
  const pageParam = searchParams.get('page');
  const parsedPage = Number(pageParam);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const { pageSize, pageSizeOptions, setPageSize } = usePageSizeParam(PAGE_LIMIT);

  const [items, setItems] = useState<ApprovalRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [searchDraft, setSearchDraft] = useState(search);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const queueFallbackRef = useRef<HTMLDivElement>(null);

  const currentPage = Math.min(page, Math.max(1, totalPages));
  const firstVisible = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, total);
  const pageItems = items;
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const hasScope = Boolean(sourceEntityId);
  const sourceFilterActive = Boolean(sourceEntityType) && !hasScope;
  const hasEditableFilters = Boolean(
    status || approvalType || periodActive || sourceFilterActive || search,
  );
  const selectedActing = Boolean(
    selectedItem && actingId === selectedItem.id,
  );
  const clearDecisionDialogs = (): void => {
    setRejectingId(null);
    setRejectComment('');
    setRejectError(null);
    setCancellingId(null);
    setCancelError(null);
  };

  const closeDetail = (): void => {
    setSelectedId(null);
    setDetailError(null);
    clearDecisionDialogs();
  };

  const updateQuery = (updates: Record<string, string>): void => {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    }

    closeDetail();

    const query = nextParams.toString();
    router.push(query ? pathname + '?' + query : pathname, { scroll: false });
  };

  const resetFilters = (): void => {
    updateQuery({
      status: '',
      approvalType: '',
      search: '',
      dateFrom: '',
      dateTo: '',
      period: '',
      sourceEntityType: hasScope ? sourceEntityType : '',
      page: '',
    });
  };

  const loadRequests = async (preserveContent = false): Promise<void> => {
    if (!preserveContent) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const response = await listApprovalRequestsPage({
        search: search || undefined,
        status: status || undefined,
        approvalType: approvalType || undefined,
        sourceEntityType: sourceEntityType || undefined,
        sourceEntityId: sourceEntityId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit: pageSize,
      });

      setItems(response.items);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setSelectedId((currentId) =>
        currentId && response.items.some((item) => item.id === currentId)
          ? currentId
          : null,
      );
    } catch (loadFailure) {
      setLoadError(
        getErrorMessage(
          loadFailure,
          'Не удалось загрузить очередь согласований.',
        ),
      );

      if (!preserveContent) {
        setItems([]);
        setTotal(0);
        setTotalPages(0);
        setSelectedId(null);
      }
    } finally {
      if (!preserveContent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [
    search,
    status,
    approvalType,
    sourceEntityType,
    sourceEntityId,
    dateFrom,
    dateTo,
    page,
    pageSize,
  ]);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    const normalizedDraft = searchDraft.trim();
    if (normalizedDraft === search) return;

    const currentQuery = searchParams.toString();
    const timeout = window.setTimeout(() => {
      const nextParams = new URLSearchParams(currentQuery);
      if (normalizedDraft) nextParams.set('search', normalizedDraft);
      else nextParams.delete('search');
      nextParams.delete('page');
      setSelectedId(null);
      setDetailError(null);
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchDraft, search, searchParams, pathname, router]);

  useEffect(() => {
    if (isLoading || page <= Math.max(1, totalPages)) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('page');
    setSelectedId(null);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [page, totalPages, isLoading, pathname, router, searchParams]);

  const approveRequest = (item: ApprovalRequestItem): void => {
    setActingId(item.id);
    setDetailError(null);

    void approveApprovalRequest(item.id)
      .then(() => loadRequests(true))
      .catch((approveError) => {
        setDetailError(
          getErrorMessage(
            approveError,
            'Не удалось подтвердить согласование.',
          ),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  const rejectRequest = (
    item: ApprovalRequestItem,
    reason: string,
  ): void => {
    setActingId(item.id);
    setRejectError(null);

    void rejectApprovalRequest(item.id, reason)
      .then(() => loadRequests(true))
      .then(() => {
        setRejectingId(null);
        setRejectComment('');
      })
      .catch((rejectFailure) => {
        setRejectError(
          getErrorMessage(
            rejectFailure,
            'Не удалось отклонить согласование.',
          ),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  const cancelRequest = (item: ApprovalRequestItem): void => {
    setActingId(item.id);
    setCancelError(null);

    void cancelApprovalRequest(item.id)
      .then(() => loadRequests(true))
      .then(() => {
        setCancellingId(null);
      })
      .catch((cancelFailure) => {
        setCancelError(
          getErrorMessage(
            cancelFailure,
            'Не удалось отменить согласование.',
          ),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  return (
    <div className={styles.page}>
      <div className={styles.filters} role="region" aria-label="Фильтры согласований">
        <RegistryToolbar
          searchValue={searchDraft}
          searchLabel="Поиск в согласованиях"
          searchPlaceholder="По названию, объекту, сотруднику или автору"
          onSearchChange={(value) => {
            setSearchDraft(value);
            setSelectedId(null);
            setDetailError(null);
          }}
          activeFilters={[
            ...(status ? [{
              id: 'status', label: 'Статус', value: status,
              options: APPROVAL_STATUS_OPTIONS.filter((option) => option.value),
              onChange: (value: string) => updateQuery({ status: value, page: '' }),
              onRemove: () => updateQuery({ status: '', page: '' }),
            }] : []),
            ...(approvalType ? [{
              id: 'type', label: 'Тип запроса', value: approvalType,
              options: APPROVAL_TYPE_OPTIONS.filter((option) => option.value),
              onChange: (value: string) => updateQuery({ approvalType: value, page: '' }),
              onRemove: () => updateQuery({ approvalType: '', page: '' }),
            }] : []),
            ...(periodActive ? [{
              id: 'period', label: 'Дата создания', value: '', options: [],
              onChange: () => undefined,
              onRemove: () => updateQuery({ dateFrom: '', dateTo: '', period: '', page: '' }),
              customControl: (
                <RegistryDateRange label="Дата создания"
                  from={dateFrom}
                  to={dateTo}
                  onFromChange={(value) => updateQuery({ dateFrom: value, page: '' })}
                  onToChange={(value) => updateQuery({ dateTo: value, page: '' })}
                />
              ),
            }] : []),
            ...(sourceFilterActive ? [{
              id: 'source', label: 'Источник', value: sourceEntityType,
              options: APPROVAL_SOURCE_OPTIONS,
              onChange: (value: string) => updateQuery({ sourceEntityType: value, page: '' }),
              onRemove: () => updateQuery({ sourceEntityType: '', page: '' }),
            }] : []),
          ]}
          availableFilters={[
            ...(!status ? [{ id: 'status', label: 'Статус', options: APPROVAL_STATUS_OPTIONS.filter((option) => option.value), onAdd: (value: string) => updateQuery({ status: value, page: '' }) }] : []),
            ...(!approvalType ? [{ id: 'type', label: 'Тип запроса', options: APPROVAL_TYPE_OPTIONS.filter((option) => option.value), onAdd: (value: string) => updateQuery({ approvalType: value, page: '' }) }] : []),
            ...(!periodActive ? [{ id: 'period', label: 'Период', options: [{ value: 'period', label: 'Дата создания' }], onAdd: () => updateQuery({ period: '1', page: '' }) }] : []),
            ...(!sourceEntityType && !hasScope ? [{ id: 'source', label: 'Источник', options: APPROVAL_SOURCE_OPTIONS, onAdd: (value: string) => updateQuery({ sourceEntityType: value, page: '' }) }] : []),
          ]}
          actions={hasEditableFilters ? (
            <Button variant="ghost" onClick={resetFilters}>Сбросить</Button>
          ) : null}
        />

        {hasScope ? (
          <div className={styles.scope}>
            <span className={styles.scopeLabel}>Контекст очереди</span>
            <strong>{getApprovalSourceLabel(sourceEntityType)}</strong>
            <span>
              Контекст задан ссылкой и сохраняется при сбросе фильтров.
            </span>
          </div>
        ) : null}
      </div>

      {loadError ? (
        <Alert
          tone="danger"
          role="alert"
          title="Не удалось обновить очередь"
          action={
            <Button
              onClick={() => {
                void loadRequests();
              }}
            >
              Обновить очередь
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : null}

      {isLoading ? (
        <Surface
          className={styles.loadingSurface}
          role="status"
          aria-busy="true"
          aria-label="Загрузка согласований"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.loadingRow} key={index}>
              <Skeleton width="62%" height={16} />
              <Skeleton width="88%" height={13} />
              <Skeleton width="48%" height={12} />
            </div>
          ))}
        </Surface>
      ) : items.length === 0 && !loadError ? (
        <EmptyState
          title="Согласований не найдено"
          description={
            hasEditableFilters
              ? 'По заданным фильтрам запросов нет.'
              : 'В доступной очереди пока нет запросов.'
          }
          action={
            hasEditableFilters ? (
              <Button onClick={resetFilters}>Сбросить фильтры</Button>
            ) : undefined
          }
        />
      ) : items.length > 0 ? (
        <Surface
          className={styles.queueSurface}
          role="region"
          aria-labelledby="approvals-queue-title"
        >
          <div className={styles.queueHeader}>
            <div>
              <h2
                className={styles.sectionTitle}
                id="approvals-queue-title"
              >
                Очередь решений
              </h2>
              <p className={styles.sectionDescription}>
                {total} {total === 1 ? 'запрос' : 'запросов'}
                {' '}в выборке
              </p>
            </div>
          </div>

          <div
            ref={queueFallbackRef}
            className={styles.queueList}
            tabIndex={-1}
          >
            {pageItems.map((item) => {
              const subtitle = getApprovalSubtitle(item);
              const title = getApprovalTitle(item);
              const typeLabel = getApprovalTypeLabel(item.approvalType);
              const isSelected = item.id === selectedId;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={styles.queueRow}
                  data-selected={isSelected || undefined}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    setDetailError(null);
                    clearDecisionDialogs();
                    setSelectedId(item.id);
                  }}
                >
                  <span className={styles.queueRowTop}>
                    <strong className={styles.queueTitle}>
                      {title}
                    </strong>
                    <ApprovalStatusBadge status={item.status} />
                  </span>
                  {subtitle ? (
                    <span className={styles.queueSubtitle}>
                      {subtitle}
                    </span>
                  ) : null}
                  {typeLabel !== title ? (
                    <span className={styles.queueType}>{typeLabel}</span>
                  ) : null}
                  <span className={styles.queueMeta}>
                    <span>{getUserDisplayName(item.createdBy)}</span>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('ru-RU')}
                    </time>
                  </span>
                </button>
              );
            })}
          </div>
          <TablePagination page={currentPage} totalPages={totalPages} pending={isLoading} label="Страницы согласований"
            summary={total > 0 ? `Показано ${firstVisible}–${lastVisible} из ${total}` : 'Запросов нет'}
            onPageChange={(page) => updateQuery({ page: String(page) })}
            pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={setPageSize} />
        </Surface>
      ) : null}

      <Drawer
        open={Boolean(selectedItem)}
        onOpenChange={(open) => {
          if (!open) {
            closeDetail();
          }
        }}
        title={
          selectedItem
            ? getApprovalTitle(selectedItem)
            : 'Согласование'
        }
        description={
          selectedItem ? getApprovalSubtitle(selectedItem) ?? undefined : undefined
        }
        busy={selectedActing}
        returnFocusRef={queueFallbackRef}
      >
        {selectedItem ? (
          <ApprovalDetail
            item={selectedItem}
            acting={selectedActing}
            actionError={detailError}
            onApprove={() => approveRequest(selectedItem)}
            onReject={() => {
              setRejectError(null);
              setRejectComment('');
              setRejectingId(selectedItem.id);
            }}
            onCancel={() => {
              setCancelError(null);
              setCancellingId(selectedItem.id);
            }}
          />
        ) : null}
      </Drawer>

      <ReasonDialog
        open={Boolean(
          selectedItem && rejectingId === selectedItem.id,
        )}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingId(null);
            setRejectComment('');
            setRejectError(null);
          }
        }}
        title="Отклонить согласование?"
        description="Укажите причину решения."
        reason={rejectComment}
        onReasonChange={setRejectComment}
        onConfirm={(reason) => {
          if (selectedItem) {
            rejectRequest(selectedItem, reason);
          }
        }}
        reasonLabel="Причина отклонения"
        confirmLabel="Отклонить"
        pending={Boolean(
          selectedItem && actingId === selectedItem.id,
        )}
        error={rejectError}
        returnFocusRef={queueFallbackRef}
      />

      <ConfirmDialog
        open={Boolean(
          selectedItem && cancellingId === selectedItem.id,
        )}
        onOpenChange={(open) => {
          if (!open) {
            setCancellingId(null);
            setCancelError(null);
          }
        }}
        title="Отменить запрос?"
        consequence="Подтвердите отмену этого запроса согласования."
        confirmLabel="Отменить запрос"
        tone="danger"
        pending={Boolean(
          selectedItem && actingId === selectedItem.id,
        )}
        error={cancelError}
        onConfirm={() => {
          if (selectedItem) {
            cancelRequest(selectedItem);
          }
        }}
        returnFocusRef={queueFallbackRef}
      />
    </div>
  );
}

interface ApprovalDetailProps {
  item: ApprovalRequestItem;
  acting: boolean;
  actionError: string | null;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}

function ApprovalDetail({
  item,
  acting,
  actionError,
  onApprove,
  onReject,
  onCancel,
}: ApprovalDetailProps): React.JSX.Element {
  const context = getBusinessContext(item);
  const resultText = getStringValue(item.payloadSnapshot, 'resultText');
  const relatedEntityLink = getRelatedEntityLink(item);

  return (
    <div className={styles.detailContent}>
      <div className={styles.detailStatusLine}>
        <ApprovalStatusBadge status={item.status} />
      </div>

      <dl className={styles.detailMeta}>
        <div>
          <dt>Тип</dt>
          <dd>{getApprovalTypeLabel(item.approvalType)}</dd>
        </div>
        <div>
          <dt>Инициатор</dt>
          <dd>{getUserDisplayName(item.createdBy)}</dd>
        </div>
        <div>
          <dt>Создано</dt>
          <dd>
            <time dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleString('ru-RU')}
            </time>
          </dd>
        </div>
      </dl>

      {context.length > 0 ? (
        <section
          className={styles.detailSection}
          aria-labelledby="approval-context-title"
        >
          <h3 id="approval-context-title">Контекст</h3>
          <dl className={styles.contextList}>
            {context.map((entry) => (
              <div key={entry.label + '-' + entry.value}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {resultText ? (
        <section
          className={styles.detailSection}
          aria-labelledby="approval-result-title"
        >
          <h3 id="approval-result-title">Результат</h3>
          <p className={styles.preWrap}>{resultText}</p>
        </section>
      ) : null}

      {item.decisionComment ? (
        <section
          className={styles.detailSection}
          aria-labelledby="approval-decision-title"
        >
          <h3 id="approval-decision-title">Комментарий решения</h3>
          <p className={styles.preWrap}>{item.decisionComment}</p>
        </section>
      ) : null}

      {relatedEntityLink ? (
        <div className={styles.relatedLink}>{relatedEntityLink}</div>
      ) : null}

      {actionError ? (
        <Alert
          tone="danger"
          role="alert"
          title="Не удалось выполнить действие"
        >
          {actionError}
        </Alert>
      ) : null}

      {item.capabilities.canApprove ||
      item.capabilities.canReject ||
      item.capabilities.canCancel ? (
        <div className={styles.detailActions}>
          {item.capabilities.canApprove ? (
            <Button
              variant="primary"
              pending={acting}
              pendingLabel="Подтверждение…"
              onClick={onApprove}
            >
              Подтвердить
            </Button>
          ) : null}

          {item.capabilities.canReject ? (
            <Button disabled={acting} onClick={onReject}>
              Отклонить
            </Button>
          ) : null}

          {item.capabilities.canCancel ? (
            <Button variant="ghost" disabled={acting} onClick={onCancel}>
              Отменить запрос
            </Button>
          ) : null}
        </div>
      ) : item.status === 'pending' ? (
        <Alert tone="info" title="Решение принимает другой участник">
          {getApprovalResolverHint(item.approvalType)}
        </Alert>
      ) : null}
    </div>
  );
}

const APPROVAL_RESOLVER_HINTS: Record<string, string> = {
  inventory_exception_confirmation:
    'Выдачу расходников на объект без фото подтверждает только директор.',
  accountability_closure_confirmation:
    'Закрытие подотчёта подтверждает сотрудник с правом согласования расходов.',
  manual_timesheet_exception_confirmation:
    'Ручную правку табеля подтверждает руководитель с правом корректировки табеля.',
  one_time_manager_availability:
    'Доступность менеджера подтверждает сотрудник с правом согласования календаря разовых заказов.',
};

function getApprovalResolverHint(approvalType: string): string {
  return (
    APPROVAL_RESOLVER_HINTS[approvalType] ??
    'У вас нет прав на решение по этому запросу. Он останется в очереди, пока его не рассмотрит ответственный.'
  );
}
