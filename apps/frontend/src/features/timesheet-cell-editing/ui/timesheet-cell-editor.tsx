'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, IconButton } from '@/shared/ui/foundation';

export interface TimesheetCellMutation {
  objectId: string;
  employeeId: string;
  dayOfMonth: number;
  dayValue: number;
  comment?: string;
}

interface TimesheetCellEditorProps {
  objectId: string;
  objectName: string;
  employeeId: string;
  employeeName: string;
  year: number;
  month: number;
  dayOfMonth: number;
  finalValue: number;
  autoValue: number;
  isChangedManually: boolean;
  comment: string | null;
  canDirectEdit: boolean;
  canRequestCorrection: boolean;
  isEditableDate: boolean;
  onDirectChange: (payload: TimesheetCellMutation) => Promise<void>;
  onRequestCorrection: (payload: Required<TimesheetCellMutation>) => Promise<void>;
  onOpenDetails?: () => void;
}

interface Point {
  left: number;
  top: number;
}

const VIEWPORT_GAP = 12;
const FLOATING_GAP = 8;
const MENU_WIDTH = 232;
const MENU_ESTIMATED_HEIGHT = 176;

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
    </svg>
  );
}

export function TimesheetCellEditor({
  objectId,
  objectName,
  employeeId,
  employeeName,
  year,
  month,
  dayOfMonth,
  finalValue,
  autoValue,
  isChangedManually,
  comment,
  canDirectEdit,
  canRequestCorrection,
  isEditableDate,
  onDirectChange,
  onRequestCorrection,
  onOpenDetails,
}: TimesheetCellEditorProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editorId = useId();
  const [selected, setSelected] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPoint, setEditorPoint] = useState<Point>({ left: VIEWPORT_GAP, top: VIEWPORT_GAP });
  const [menuPoint, setMenuPoint] = useState<Point | null>(null);
  const [value, setValue] = useState(String(finalValue));
  const [reason, setReason] = useState(comment ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canMutate = isEditableDate && (canDirectEdit || canRequestCorrection);

  const closeInteraction = useCallback((): void => {
    setSelected(false);
    setEditorOpen(false);
    setMenuPoint(null);
    setMessage(null);
  }, []);

  const positionEditor = useCallback((): void => {
    const trigger = triggerRef.current;
    const editor = editorRef.current;
    if (!trigger || !editor || typeof window === 'undefined') return;

    const triggerRect = trigger.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const width = editorRect.width;
    const height = editorRect.height;

    const left = clamp(
      triggerRect.left,
      VIEWPORT_GAP,
      window.innerWidth - width - VIEWPORT_GAP,
    );

    const fitsBelow = triggerRect.bottom + FLOATING_GAP + height <= window.innerHeight - VIEWPORT_GAP;
    const fitsAbove = triggerRect.top - FLOATING_GAP - height >= VIEWPORT_GAP;

    let top: number;
    if (fitsBelow) {
      top = triggerRect.bottom + FLOATING_GAP;
    } else if (fitsAbove) {
      top = triggerRect.top - FLOATING_GAP - height;
    } else {
      top = clamp(
        triggerRect.top + triggerRect.height / 2 - height / 2,
        VIEWPORT_GAP,
        window.innerHeight - height - VIEWPORT_GAP,
      );
    }

    setEditorPoint({ left, top });
  }, []);

  useEffect(() => {
    setValue(String(finalValue));
    setReason(comment ?? '');
  }, [comment, finalValue]);

  useLayoutEffect(() => {
    if (!editorOpen) return;
    positionEditor();
  }, [editorOpen, message, positionEditor]);

  useEffect(() => {
    if (!editorOpen) return undefined;

    const reposition = (): void => positionEditor();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [editorOpen, positionEditor]);

  useEffect(() => {
    if (!selected && !editorOpen && !menuPoint) return undefined;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (editorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeInteraction();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeInteraction();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeInteraction, editorOpen, menuPoint, selected]);

  const openEditor = (): void => {
    if (!canMutate) return;
    setSelected(true);
    setMenuPoint(null);
    setMessage(null);
    setValue(String(finalValue));
    setReason(comment ?? '');
    setEditorPoint({ left: VIEWPORT_GAP, top: VIEWPORT_GAP });
    setEditorOpen(true);
  };

  const openMenu = (clientX: number, clientY: number): void => {
    setSelected(true);
    setEditorOpen(false);
    setMenuPoint({
      left: clamp(clientX, VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP),
      top: clamp(clientY, VIEWPORT_GAP, window.innerHeight - MENU_ESTIMATED_HEIGHT - VIEWPORT_GAP),
    });
  };

  const submit = async (): Promise<void> => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setMessage('Введите целую сумму не меньше 0 ₽.');
      return;
    }

    const normalizedReason = reason.trim();
    const differsFromAuto = parsed !== autoValue;
    if (differsFromAuto && !normalizedReason) {
      setMessage('Для ручной корректировки укажите причину.');
      return;
    }

    if (parsed === finalValue) {
      closeInteraction();
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (canDirectEdit) {
        await onDirectChange({
          objectId,
          employeeId,
          dayOfMonth,
          dayValue: parsed,
          comment: differsFromAuto ? normalizedReason : undefined,
        });
      } else {
        if (parsed === autoValue) {
          setMessage('Возврат к авторасчёту доступен только пользователю с правом прямой корректировки.');
          return;
        }
        await onRequestCorrection({
          objectId,
          employeeId,
          dayOfMonth,
          dayValue: parsed,
          comment: normalizedReason,
        });
      }
      closeInteraction();
    } catch (error) {
      setMessage(error instanceof Error && error.message.trim() ? error.message : 'Не удалось сохранить корректировку.');
    } finally {
      setSaving(false);
    }
  };

  const restoreAuto = async (): Promise<void> => {
    if (!canDirectEdit || !isEditableDate || finalValue === autoValue) return;
    setSaving(true);
    setMessage(null);
    try {
      await onDirectChange({
        objectId,
        employeeId,
        dayOfMonth,
        dayValue: autoValue,
      });
      closeInteraction();
    } catch (error) {
      setMessage(error instanceof Error && error.message.trim() ? error.message : 'Не удалось вернуть авторасчёт.');
    } finally {
      setSaving(false);
    }
  };

  const label = finalValue === 0 ? '—' : String(finalValue);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`timesheet-cell-trigger${selected ? ' is-selected' : ''}${isChangedManually ? ' is-manual' : ''}${!isEditableDate ? ' is-locked' : ''}`}
        aria-label={`${employeeName}, ${dayOfMonth}.${month}.${year}: ${formatMoney(finalValue)}`}
        aria-describedby={editorOpen ? editorId : undefined}
        aria-pressed={selected}
        onClick={() => {
          if (editorOpen || menuPoint) return;
          setSelected((current) => !current);
        }}
        onDoubleClick={openEditor}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
      >
        <strong>{label}</strong>
      </button>

      {menuPoint && typeof document !== 'undefined'
        ? createPortal(
            <div ref={menuRef} className="timesheet-cell-menu" style={menuPoint} role="menu">
              {canMutate ? (
                <button type="button" role="menuitem" onClick={openEditor}>
                  {canDirectEdit ? 'Изменить выплату' : 'Запросить корректировку'}
                </button>
              ) : null}
              {canDirectEdit && isEditableDate && isChangedManually ? (
                <button type="button" role="menuitem" onClick={() => void restoreAuto()} disabled={saving}>
                  Вернуть авторасчёт
                </button>
              ) : null}
              {onOpenDetails ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeInteraction();
                    onOpenDetails();
                  }}
                >
                  История / детализация
                </button>
              ) : null}
              {!isEditableDate ? (
                <div className="timesheet-cell-menu__hint">
                  Корректировка недоступна для закрытого или будущего периода.
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {editorOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={editorRef}
              id={editorId}
              className="timesheet-cell-editor"
              style={editorPoint}
              role="dialog"
              aria-modal="false"
              aria-label="Корректировка выплаты"
            >
              <div className="timesheet-cell-editor__header">
                <div>
                  <strong>{employeeName}</strong>
                  <span>{objectName} · {dayOfMonth}.{String(month).padStart(2, '0')}.{year}</span>
                </div>
                <IconButton
                  className="timesheet-cell-editor__close"
                  onClick={closeInteraction}
                  aria-label="Закрыть редактор"
                >
                  <CloseIcon />
                </IconButton>
              </div>

              <div className="timesheet-cell-editor__summary">
                <span>Текущая выплата</span>
                <strong>{formatMoney(finalValue)}</strong>
              </div>

              <label className="timesheet-cell-editor__field">
                <span>{canDirectEdit ? 'Новая выплата' : 'Запросить выплату'}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoFocus
                />
              </label>

              <label className="timesheet-cell-editor__field">
                <span>
                  Причина {Number(value) === autoValue ? '(не требуется при возврате к авторасчёту)' : ''}
                </span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Коротко объясните изменение"
                />
              </label>

              {message ? <div className="timesheet-cell-editor__message">{message}</div> : null}

              <div className="timesheet-cell-editor__actions">
                <div className="timesheet-cell-editor__actions-left">
                  {canDirectEdit && isChangedManually && finalValue !== autoValue ? (
                    <Button variant="ghost" size="sm" onClick={() => void restoreAuto()} disabled={saving}>
                      Вернуть авторасчёт
                    </Button>
                  ) : null}
                </div>
                <div className="timesheet-cell-editor__actions-right">
                  <Button size="sm" onClick={closeInteraction} disabled={saving}>
                    Отмена
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saving}>
                    {saving ? 'Сохраняем…' : canDirectEdit ? 'Сохранить' : 'Отправить запрос'}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
