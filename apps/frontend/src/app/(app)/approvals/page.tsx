'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  approveApprovalRequest,
  cancelApprovalRequest,
  listApprovalRequests,
  rejectApprovalRequest,
} from '@/entities/approval/api/approval-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import {
  APPROVAL_STATUS_OPTIONS,
  APPROVAL_TYPE_OPTIONS,
  getApprovalSourceLabel,
  getApprovalStatusLabel,
  getApprovalTypeLabel,
} from '@/shared/lib/approval-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';
import { getInventoryMovementTypeLabel } from '@/shared/lib/inventory-presentation';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Surface,
} from '@/shared/ui/foundation';

import styles from './approvals.module.css';

type ApprovalStatusTone = 'neutral' | 'danger' | 'warning' | 'success';

interface BusinessContextItem {
  label: string;
  value: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function getApprovalTitle(item: ApprovalRequestItem): string {
  const title = item.summary.title.trim();

  if (
    !title ||
    title === item.approvalType ||
    title === 'Inventory exception' ||
    UUID_PATTERN.test(title)
  ) {
    return getApprovalTypeLabel(item.approvalType);
  }

  return title;
}

function getObjectStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Активный',
    frozen: 'Приостановлен',
    archived: 'Архив',
  };

  return labels[status] ?? 'Неизвестное состояние';
}

function getApprovalSubtitle(item: ApprovalRequestItem): string | null {
  const subtitle = item.summary.subtitle?.trim();

  if (!subtitle || UUID_PATTERN.test(subtitle)) {
    return null;
  }

  if (item.approvalType === 'inventory_exception_confirmation') {
    const [movementType, ...rest] = subtitle.split(' · ');
    const movementLabel = movementType
      ? getInventoryMovementTypeLabel(movementType)
      : null;
    return movementType
      ? [movementLabel === movementType ? 'Движение расходников' : movementLabel, ...rest]
          .filter(Boolean)
          .join(' · ')
      : subtitle;
  }

  if (item.approvalType === 'object_change_confirmation') {
    const objectName = getStringValue(item.payloadSnapshot, 'objectName');
    const currentStatus = getStringValue(item.payloadSnapshot, 'currentStatus');
    const requestedStatus = getStringValue(item.payloadSnapshot, 'requestedStatus');

    if (objectName && currentStatus && requestedStatus) {
      return `${objectName} · ${getObjectStatusLabel(currentStatus)} → ${getObjectStatusLabel(requestedStatus)}`;
    }
  }

  return subtitle;
}

function getStringValue(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  return year && month && day ? `${day}.${month}.${year}` : value;
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

  if (taskTitle) context.push({ label: 'Задача', value: taskTitle });
  if (objectName) context.push({ label: 'Объект', value: objectName });
  if (inventoryNumber) {
    context.push({ label: 'Инвентарный номер', value: inventoryNumber });
  }
  if (employeeName) context.push({ label: 'Сотрудник', value: employeeName });

  if (startDate && endDate) {
    context.push({
      label: 'Период',
      value: `${formatDateOnly(startDate)} — ${formatDateOnly(endDate)}`,
    });
  }

  if (year !== null && month !== null && dayOfMonth !== null) {
    context.push({
      label: 'Дата табеля',
      value: `${String(dayOfMonth).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
    });
  }

  if (currentDayValue !== null) {
    context.push({ label: 'Текущее значение', value: String(currentDayValue) });
  }
  if (requestedDayValue !== null) {
    context.push({ label: 'Предложенное значение', value: String(requestedDayValue) });
  }

  if (fromStatus && toStatus) {
    context.push({
      label: 'Изменение состояния',
      value: `${getEquipmentStatusLabel(fromStatus)} → ${getEquipmentStatusLabel(toStatus)}`,
    });
  }

  if (comment) context.push({ label: 'Комментарий запроса', value: comment });

  return context;
}

function getRelatedEntityLink(item: ApprovalRequestItem): React.ReactNode {
  if (item.sourceEntityType === 'task') {
    return <Link href={`/tasks/${item.sourceEntityId}`}>Открыть задачу</Link>;
  }

  if (item.sourceEntityType === 'object') {
    return <Link href={`/objects/${item.sourceEntityId}`}>Открыть объект</Link>;
  }

  if (
    item.sourceEntityType === 'inventory_movement' &&
    typeof item.payloadSnapshot.inventoryItemId === 'string'
  ) {
    return (
      <Link href={`/inventory/${item.payloadSnapshot.inventoryItemId}`}>
        Открыть расходник
      </Link>
    );
  }

  if (
    item.sourceEntityType === 'equipment_movement' &&
    typeof item.payloadSnapshot.equipmentUnitId === 'string'
  ) {
    return (
      <Link href={`/equipment/${item.payloadSnapshot.equipmentUnitId}`}>
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
    return (
      <Link
        href={`/timesheet?objectId=${item.payloadSnapshot.objectId}&year=${item.payloadSnapshot.year}&month=${item.payloadSnapshot.month}`}
      >
        Открыть табель
      </Link>
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
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const [items, setItems] = useState<ApprovalRequestItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const hasEditableFilters = Boolean(status || approvalType || dateFrom || dateTo);
  const hasScope = Boolean(sourceEntityType || sourceEntityId);

  const updateQuery = (updates: Record<string, string>): void => {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    }

    const query = nextParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const resetFilters = (): void => {
    updateQuery({ status: '', approvalType: '', dateFrom: '', dateTo: '' });
  };

  const loadRequests = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await listApprovalRequests({
        status: status || undefined,
        approvalType: approvalType || undefined,
        sourceEntityType: sourceEntityType || undefined,
        sourceEntityId: sourceEntityId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setItems(response);
      setSelectedId((currentId) =>
        currentId && response.some((item) => item.id === currentId)
          ? currentId
          : null,
      );
    } catch (loadError) {
      setError(
        getErrorMessage(loadError, 'Не удалось загрузить очередь согласований.'),
      );
      setItems([]);
      setSelectedId(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [status, approvalType, sourceEntityType, sourceEntityId, dateFrom, dateTo]);

  const approveRequest = (item: ApprovalRequestItem): void => {
    setActingId(item.id);
    void approveApprovalRequest(item.id)
      .then(loadRequests)
      .catch((approveError) => {
        setError(
          getErrorMessage(approveError, 'Не удалось подтвердить согласование.'),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  const cancelRequest = (item: ApprovalRequestItem): void => {
    setActingId(item.id);
    void cancelApprovalRequest(item.id)
      .then(loadRequests)
      .catch((cancelError) => {
        setError(
          getErrorMessage(cancelError, 'Не удалось отменить согласование.'),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  const rejectRequest = (item: ApprovalRequestItem): void => {
    setActingId(item.id);
    void rejectApprovalRequest(item.id, rejectComment)
      .then(loadRequests)
      .then(() => {
        setRejectingId(null);
        setRejectComment('');
      })
      .catch((rejectError) => {
        setError(
          getErrorMessage(rejectError, 'Не удалось отклонить согласование.'),
        );
      })
      .finally(() => {
        setActingId(null);
      });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Согласования"
        description="Очередь запросов, ожидающих решения, и история завершённых согласований."
      />

      <Surface className={styles.filters} role="region" aria-label="Фильтры согласований">
        <div className={styles.filterHeading}>
          <div>
            <h2 className={styles.sectionTitle}>Фильтры</h2>
            <p className={styles.sectionDescription}>
              Статус и тип применяются сразу. Период ограничивает дату создания запроса.
            </p>
          </div>
          {hasEditableFilters ? (
            <Button variant="ghost" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          ) : null}
        </div>

        <div className={styles.filterGroups}>
          <div className={styles.primaryFilters}>
            <Field label="Статус">
              <select
                className={styles.control}
                value={status}
                onChange={(event) => updateQuery({ status: event.target.value })}
              >
                {APPROVAL_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Тип согласования">
              <select
                className={styles.control}
                value={approvalType}
                onChange={(event) =>
                  updateQuery({ approvalType: event.target.value })
                }
              >
                {APPROVAL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className={styles.additionalFilters}>
            <legend>Дополнительные фильтры</legend>
            <div className={styles.dateFilters}>
              <Field label="Дата от">
                <input
                  className={styles.control}
                  type="date"
                  value={dateFrom}
                  onChange={(event) =>
                    updateQuery({ dateFrom: event.target.value })
                  }
                />
              </Field>

              <Field label="Дата до">
                <input
                  className={styles.control}
                  type="date"
                  value={dateTo}
                  onChange={(event) =>
                    updateQuery({ dateTo: event.target.value })
                  }
                />
              </Field>
            </div>
          </fieldset>
        </div>

        {hasScope ? (
          <div className={styles.scope}>
            <span className={styles.scopeLabel}>Контекст очереди</span>
            <strong>{getApprovalSourceLabel(sourceEntityType)}</strong>
            <span>Контекст задан ссылкой и сохраняется при сбросе фильтров.</span>
          </div>
        ) : null}
      </Surface>

      {error ? (
        <Alert tone="danger" role="alert" title="Не удалось выполнить запрос">
          {error}
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
      ) : items.length === 0 && !error ? (
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
        <div className={styles.workspace}>
          <Surface
            className={styles.queueSurface}
            role="region"
            aria-labelledby="approvals-queue-title"
          >
            <div className={styles.queueHeader}>
              <div>
                <h2 className={styles.sectionTitle} id="approvals-queue-title">
                  Очередь решений
                </h2>
                <p className={styles.sectionDescription}>
                  {items.length} {items.length === 1 ? 'запрос' : 'запросов'} в текущей выборке
                </p>
              </div>
            </div>

            <div className={styles.queueList}>
              {items.map((item) => {
                const subtitle = getApprovalSubtitle(item);
                const isSelected = item.id === selectedId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.queueRow}
                    data-selected={isSelected || undefined}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className={styles.queueRowTop}>
                      <strong className={styles.queueTitle}>{getApprovalTitle(item)}</strong>
                      <ApprovalStatusBadge status={item.status} />
                    </span>
                    {subtitle ? <span className={styles.queueSubtitle}>{subtitle}</span> : null}
                    <span className={styles.queueType}>
                      {getApprovalTypeLabel(item.approvalType)}
                    </span>
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
          </Surface>

          {selectedItem ? (
            <ApprovalDetail
              item={selectedItem}
              acting={actingId === selectedItem.id}
              rejecting={rejectingId === selectedItem.id}
              rejectComment={rejectComment}
              onApprove={() => approveRequest(selectedItem)}
              onCancel={() => cancelRequest(selectedItem)}
              onRejectStart={() => {
                setRejectingId(selectedItem.id);
                setRejectComment('');
              }}
              onRejectCommentChange={setRejectComment}
              onReject={() => rejectRequest(selectedItem)}
              onRejectCancel={() => {
                setRejectingId(null);
                setRejectComment('');
              }}
            />
          ) : (
            <Surface className={styles.detailPlaceholder} tone="subtle">
              <EmptyState
                title="Выберите согласование"
                description="Откройте строку очереди, чтобы увидеть контекст и доступные действия."
              />
            </Surface>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface ApprovalDetailProps {
  item: ApprovalRequestItem;
  acting: boolean;
  rejecting: boolean;
  rejectComment: string;
  onApprove: () => void;
  onCancel: () => void;
  onRejectStart: () => void;
  onRejectCommentChange: (value: string) => void;
  onReject: () => void;
  onRejectCancel: () => void;
}

function ApprovalDetail({
  item,
  acting,
  rejecting,
  rejectComment,
  onApprove,
  onCancel,
  onRejectStart,
  onRejectCommentChange,
  onReject,
  onRejectCancel,
}: ApprovalDetailProps): React.JSX.Element {
  const context = getBusinessContext(item);
  const subtitle = getApprovalSubtitle(item);
  const resultText = getStringValue(item.payloadSnapshot, 'resultText');
  const relatedEntityLink = getRelatedEntityLink(item);

  return (
    <Surface
      className={styles.detailSurface}
      role="region"
      aria-labelledby="approval-detail-title"
    >
      <div className={styles.detailHeader}>
        <div className={styles.detailHeading}>
          <span className={styles.detailEyebrow}>Выбранное согласование</span>
          <h2 className={styles.detailTitle} id="approval-detail-title">
            {getApprovalTitle(item)}
          </h2>
        </div>
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

      {subtitle || context.length > 0 ? (
        <section className={styles.detailSection} aria-labelledby="approval-context-title">
          <h3 id="approval-context-title">Контекст</h3>
          {subtitle ? <p className={styles.contextSummary}>{subtitle}</p> : null}
          {context.length > 0 ? (
            <dl className={styles.contextList}>
              {context.map((entry) => (
                <div key={`${entry.label}-${entry.value}`}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}

      {resultText ? (
        <section className={styles.detailSection} aria-labelledby="approval-result-title">
          <h3 id="approval-result-title">Результат</h3>
          <p className={styles.preWrap}>{resultText}</p>
        </section>
      ) : null}

      {item.decisionComment ? (
        <section className={styles.detailSection} aria-labelledby="approval-decision-title">
          <h3 id="approval-decision-title">Комментарий решения</h3>
          <p className={styles.preWrap}>{item.decisionComment}</p>
        </section>
      ) : null}

      {relatedEntityLink ? (
        <div className={styles.relatedLink}>{relatedEntityLink}</div>
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
            <Button disabled={acting} onClick={onRejectStart}>
              Отклонить
            </Button>
          ) : null}
          {item.capabilities.canCancel ? (
            <Button variant="ghost" pending={acting} onClick={onCancel}>
              Отменить запрос
            </Button>
          ) : null}
        </div>
      ) : null}

      {rejecting ? (
        <div className={styles.rejectEditor}>
          <Field label="Причина отклонения" required>
            <textarea
              className={styles.textarea}
              rows={4}
              value={rejectComment}
              onChange={(event) => onRejectCommentChange(event.target.value)}
            />
          </Field>
          <div className={styles.rejectActions}>
            <Button
              variant="primary"
              pending={acting}
              pendingLabel="Отклонение…"
              disabled={!rejectComment.trim()}
              onClick={onReject}
            >
              Подтвердить отклонение
            </Button>
            <Button variant="ghost" disabled={acting} onClick={onRejectCancel}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </Surface>
  );
}
