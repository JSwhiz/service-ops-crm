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
import { getInventoryMovementTypeLabel } from '@/shared/lib/inventory-presentation';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { SearchField } from '@/shared/ui/search-field/search-field';
import { usePopoverPlacement } from '@/shared/ui/searchable-select/use-popover-placement';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Surface,
} from '@/shared/ui/foundation';
import {
  ConfirmDialog,
  Drawer,
  ReasonDialog,
} from '@/shared/ui/overlays';

import styles from './approvals.module.css';

type ApprovalStatusTone = 'neutral' | 'danger' | 'warning' | 'success';

const PAGE_LIMIT = 20;

interface BusinessContextItem {
  label: string;
  value: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

type ApprovalFilterOption = { value: string; label: string };

const CALENDAR_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const;
const CALENDAR_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

function DateFilterPicker({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : new Date();
  const [view, setView] = useState(() => ({ year: selected.getFullYear(), month: selected.getMonth() }));
  const viewStart = new Date(view.year, view.month, 1);
  const gridStart = new Date(view.year, view.month, 1 - ((viewStart.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date, iso };
  });
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const placement = usePopoverPlacement(open, triggerRef, popoverRef, 360);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shiftMonth = (delta: number): void => {
    const next = new Date(view.year, view.month + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  };

  return (
    <div className={styles.datePickerRoot} ref={rootRef}>
      <span className={styles.dateRangeLabel}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.datePickerTrigger}
        aria-label={`${label}: ${value ? formatDateOnly(value) : 'выбрать дату'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setView({ year: selected.getFullYear(), month: selected.getMonth() });
          setOpen((current) => !current);
        }}
      >
        {value ? formatDateOnly(value) : 'Выбрать дату'}
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className={styles.datePickerPopover}
          role="dialog"
          aria-label={`Выбор даты: ${label}`}
          data-placement={placement.placement}
          style={{ '--approval-popover-max-height': `${placement.availableHeight}px` } as React.CSSProperties}
        >
          <div className={styles.datePickerHeader}>
            <button type="button" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
              <span aria-hidden="true">‹</span>
            </button>
            <strong>{CALENDAR_MONTHS[view.month]} {view.year}</strong>
            <button type="button" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <div className={styles.datePickerGrid}>
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <span className={styles.datePickerWeekday} key={weekday}>{weekday}</span>
            ))}
            {days.map(({ date, iso }) => {
              const disabled = Boolean((min && iso < min) || (max && iso > max));
              return (
                <button
                  type="button"
                  key={iso}
                  className={styles.datePickerDay}
                  data-outside={date.getMonth() !== view.month || undefined}
                  data-selected={iso === value || undefined}
                  data-today={iso === todayIso || undefined}
                  disabled={disabled}
                  aria-label={date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  aria-pressed={iso === value}
                  onClick={() => { onChange(iso); setOpen(false); }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ApprovalFilterSelect({
  label,
  value,
  options,
  onChange,
  onRemove,
}: {
  label: string;
  value: string;
  options: readonly ApprovalFilterOption[];
  onChange: (value: string) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const placement = usePopoverPlacement(open, triggerRef, popoverRef, 360);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={styles.filterControl} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.filterTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.filterCopy}>
          <span className={styles.filterLabel}>{label}</span>
          <strong>{selectedLabel}</strong>
        </span>
        <span className={styles.filterChevron} aria-hidden="true">⌄</span>
      </button>
      <button
        type="button"
        className={styles.filterRemove}
        aria-label={`Убрать фильтр «${label}»`}
        title="Убрать фильтр"
        onClick={onRemove}
      >
        ×
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className={styles.filterDropdown}
          role="listbox"
          aria-label={label}
          data-placement={placement.placement}
          style={{ '--approval-popover-max-height': `${placement.availableHeight}px` } as React.CSSProperties}
        >
          <div className={styles.filterDropdownLabel}>{label}</div>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={styles.filterOption}
              data-selected={option.value === value ? 'true' : 'false'}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <span className={styles.filterCheck} aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddApprovalFilterMenu({
  statusActive,
  typeActive,
  periodActive,
  sourceActive,
  onStatus,
  onType,
  onPeriod,
  onSource,
}: {
  statusActive: boolean;
  typeActive: boolean;
  periodActive: boolean;
  sourceActive: boolean;
  onStatus: (value: string) => void;
  onType: (value: string) => void;
  onPeriod: () => void;
  onSource: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const placement = usePopoverPlacement(open, triggerRef, popoverRef, 420);
  const statusOptions = APPROVAL_STATUS_OPTIONS.filter((option) => option.value);
  const typeOptions = APPROVAL_TYPE_OPTIONS.filter((option) => option.value);
  const available = !statusActive || !typeActive || !periodActive || !sourceActive;

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={styles.addFilterRoot} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.addFilterButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Добавить фильтр"
        disabled={!available}
        onClick={() => setOpen((current) => !current)}
      >
        <PlusIcon />
        <span>Добавить фильтр</span>
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className={styles.addFilterMenu}
          role="menu"
          aria-label="Доступные фильтры"
          data-placement={placement.placement}
          style={{ '--approval-popover-max-height': `${placement.availableHeight}px` } as React.CSSProperties}
        >
          {!statusActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Статус</div>
              {statusOptions.map((option) => (
                <button type="button" role="menuitem" className={styles.addFilterOption} key={option.value} onClick={() => { onStatus(option.value); setOpen(false); }}>
                  <span className={styles.addFilterOptionIcon}><PlusIcon /></span><span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {!typeActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Тип запроса</div>
              {typeOptions.map((option) => (
                <button type="button" role="menuitem" className={styles.addFilterOption} key={option.value} onClick={() => { onType(option.value); setOpen(false); }}>
                  <span className={styles.addFilterOptionIcon}><PlusIcon /></span><span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {!periodActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Период</div>
              <button type="button" role="menuitem" className={styles.addFilterOption} onClick={() => { onPeriod(); setOpen(false); }}>
                <span className={styles.addFilterOptionIcon}><PlusIcon /></span><span>Дата создания</span>
              </button>
            </div>
          ) : null}
          {!sourceActive ? (
            <div className={styles.addFilterSection}>
              <div className={styles.filterDropdownLabel}>Источник</div>
              {APPROVAL_SOURCE_OPTIONS.map((option) => (
                <button type="button" role="menuitem" className={styles.addFilterOption} key={option.value} onClick={() => { onSource(option.value); setOpen(false); }}>
                  <span className={styles.addFilterOptionIcon}><PlusIcon /></span><span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
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
      ? [
          movementLabel === movementType
            ? 'Движение расходников'
            : movementLabel,
          ...rest,
        ]
          .filter(Boolean)
          .join(' · ')
      : subtitle;
  }

  if (item.approvalType === 'object_change_confirmation') {
    const objectName = getStringValue(item.payloadSnapshot, 'objectName');
    const currentStatus = getStringValue(
      item.payloadSnapshot,
      'currentStatus',
    );
    const requestedStatus = getStringValue(
      item.payloadSnapshot,
      'requestedStatus',
    );

    if (objectName && currentStatus && requestedStatus) {
      return (
        objectName +
        ' · ' +
        getObjectStatusLabel(currentStatus) +
        ' → ' +
        getObjectStatusLabel(requestedStatus)
      );
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
  const firstVisible = total === 0 ? 0 : (currentPage - 1) * PAGE_LIMIT + 1;
  const lastVisible = Math.min(currentPage * PAGE_LIMIT, total);
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
        limit: PAGE_LIMIT,
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
        <div className={styles.filterToolbar}>
          <SearchField
            value={searchDraft}
            onChange={(value) => {
              setSearchDraft(value);
              setSelectedId(null);
              setDetailError(null);
            }}
            label="Поиск в согласованиях"
            placeholder="По названию, объекту, сотруднику или автору"
            busy={isLoading}
            className={styles.approvalsSearch}
          />
          <div className={styles.activeFilters}>
            {status ? (
              <ApprovalFilterSelect
                label="Статус"
                value={status}
                options={APPROVAL_STATUS_OPTIONS.filter((option) => option.value)}
                onChange={(value) => updateQuery({ status: value, page: '' })}
                onRemove={() => updateQuery({ status: '', page: '' })}
              />
            ) : null}
            {approvalType ? (
              <ApprovalFilterSelect
                label="Тип запроса"
                value={approvalType}
                options={APPROVAL_TYPE_OPTIONS.filter((option) => option.value)}
                onChange={(value) => updateQuery({ approvalType: value, page: '' })}
                onRemove={() => updateQuery({ approvalType: '', page: '' })}
              />
            ) : null}
            {periodActive ? (
              <div className={styles.periodFilter}>
                <span className={styles.periodTitle}>Дата</span>
                <DateFilterPicker
                  label="с"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(value) => updateQuery({ dateFrom: value, page: '' })}
                />
                <span className={styles.dateRangeDash}>—</span>
                <DateFilterPicker
                  label="по"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(value) => updateQuery({ dateTo: value, page: '' })}
                />
                <button
                  type="button"
                  className={styles.filterRemove}
                  aria-label="Убрать фильтр «Дата создания»"
                  title="Убрать фильтр"
                  onClick={() => updateQuery({ dateFrom: '', dateTo: '', period: '', page: '' })}
                >
                  ×
                </button>
              </div>
            ) : null}
            {sourceFilterActive ? (
              <ApprovalFilterSelect
                label="Источник"
                value={sourceEntityType}
                options={APPROVAL_SOURCE_OPTIONS}
                onChange={(value) => updateQuery({ sourceEntityType: value, page: '' })}
                onRemove={() => updateQuery({ sourceEntityType: '', page: '' })}
              />
            ) : null}
          </div>
          <AddApprovalFilterMenu
            statusActive={Boolean(status)}
            typeActive={Boolean(approvalType)}
            periodActive={periodActive}
            sourceActive={Boolean(sourceEntityType) || hasScope}
            onStatus={(value) => updateQuery({ status: value, page: '' })}
            onType={(value) => updateQuery({ approvalType: value, page: '' })}
            onPeriod={() => updateQuery({ period: '1', page: '' })}
            onSource={(value) => updateQuery({ sourceEntityType: value, page: '' })}
          />
          {hasEditableFilters ? (
            <Button className={styles.resetFilters} variant="ghost" onClick={resetFilters}>
              Сбросить
            </Button>
          ) : null}
        </div>

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
                      {getApprovalTitle(item)}
                    </strong>
                    <ApprovalStatusBadge status={item.status} />
                  </span>
                  {subtitle ? (
                    <span className={styles.queueSubtitle}>
                      {subtitle}
                    </span>
                  ) : null}
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
          <TablePagination page={currentPage} totalPages={totalPages} pending={isLoading} label="Страницы согласований"
            summary={total > 0 ? `Показано ${firstVisible}–${lastVisible} из ${total}` : 'Запросов нет'}
            onPageChange={(page) => updateQuery({ page: String(page) })} />
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
      ) : null}
    </div>
  );
}
