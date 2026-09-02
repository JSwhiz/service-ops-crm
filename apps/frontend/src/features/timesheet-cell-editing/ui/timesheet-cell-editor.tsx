'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
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
  const editorId = useId();
  const [selected, setSelected] = useState(false);
  const [editorPoint, setEditorPoint] = useState<Point | null>(null);
  const [menuPoint, setMenuPoint] = useState<Point | null>(null);
  const [value, setValue] = useState(String(finalValue));
  const [reason, setReason] = useState(comment ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canMutate = isEditableDate && (canDirectEdit || canRequestCorrection);

  useEffect(() => {
    setValue(String(finalValue));
    setReason(comment ?? '');
  }, [comment, finalValue]);

  useEffect(() => {
    if (!editorPoint && !menuPoint) return undefined;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setEditorPoint(null);
        setMenuPoint(null);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [editorPoint, menuPoint]);

  const pointNextToTrigger = (): Point | null => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const width = 340;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 290);
    return { left: Math.max(12, left), top: Math.max(12, top) };
  };

  const openEditor = (): void => {
    if (!canMutate) return;
    setMenuPoint(null);
    setMessage(null);
    setValue(String(finalValue));
    setReason(comment ?? '');
    setEditorPoint(pointNextToTrigger());
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
      setEditorPoint(null);
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
        setEditorPoint(null);
      } else {
        if (parsed === autoValue) {
          setMessage('Возврат к авторасчёту сейчас доступен только пользователю с правом прямой корректировки.');
          return;
        }
        await onRequestCorrection({
          objectId,
          employeeId,
          dayOfMonth,
          dayValue: parsed,
          comment: normalizedReason,
        });
        setMessage('Запрос на корректировку отправлен на согласование.');
      }
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
      setEditorPoint(null);
      setMenuPoint(null);
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
        aria-describedby={editorPoint ? editorId : undefined}
        onClick={() => setSelected(true)}
        onDoubleClick={openEditor}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelected(true);
          setEditorPoint(null);
          setMenuPoint({ left: event.clientX, top: event.clientY });
        }}
      >
        <strong>{label}</strong>
      </button>

      {menuPoint && typeof document !== 'undefined'
        ? createPortal(
            <div className="timesheet-cell-menu" style={menuPoint} role="menu">
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
                <button type="button" role="menuitem" onClick={() => { setMenuPoint(null); onOpenDetails(); }}>
                  История / детализация
                </button>
              ) : null}
              {!isEditableDate ? <div className="timesheet-cell-menu__hint">Корректировка недоступна для закрытого или будущего периода.</div> : null}
            </div>,
            document.body,
          )
        : null}

      {editorPoint && typeof document !== 'undefined'
        ? createPortal(
            <div id={editorId} className="timesheet-cell-editor" style={editorPoint} role="dialog" aria-label="Корректировка выплаты">
              <div className="timesheet-cell-editor__header">
                <div>
                  <strong>{employeeName}</strong>
                  <span>{objectName} · {dayOfMonth}.{String(month).padStart(2, '0')}.{year}</span>
                </div>
                <button type="button" className="timesheet-cell-editor__close" onClick={() => setEditorPoint(null)} aria-label="Закрыть">×</button>
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
                <span>Причина {Number(value) === autoValue ? '(не требуется при возврате к авторасчёту)' : ''}</span>
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Коротко объясните изменение" />
              </label>

              {message ? <div className="timesheet-cell-editor__message">{message}</div> : null}

              <div className="timesheet-cell-editor__actions">
                {canDirectEdit && isChangedManually && finalValue !== autoValue ? (
                  <button type="button" className="button-secondary" onClick={() => void restoreAuto()} disabled={saving}>Вернуть авторасчёт</button>
                ) : <span />}
                <div>
                  <button type="button" className="button-secondary" onClick={() => setEditorPoint(null)} disabled={saving}>Отмена</button>
                  <button type="button" onClick={() => void submit()} disabled={saving}>{saving ? 'Сохраняем…' : canDirectEdit ? 'Сохранить' : 'Отправить запрос'}</button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
