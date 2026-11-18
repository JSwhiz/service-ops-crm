'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useFloatingPosition } from '@/shared/ui/overlays/use-floating-position';

import styles from './date-picker.module.css';
import { IconButton } from '@/shared/ui/foundation';
import { calendarDate, formatDateInput, parseDateInput } from './date-input';
import { CalendarIcon, CloseIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/icons/icons';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;
const MONTH_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
] as const;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const displayDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

export interface DatePickerProps {
  name?: string;
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` with `withTime`; empty string when unset. */
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  /** Default time applied when a day is picked with `withTime`. */
  defaultTime?: string;
  min?: string;
  max?: string;
  /** Domain-specific explanation, e.g. a birthday cannot be in the future. */
  maxError?: string;
  placeholder?: string;
  /** `short` shows 01.10.26 — for narrow filter controls. */
  displayFormat?: 'long' | 'short';
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
  'aria-label'?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const parseKey = calendarDate;

/**
 * Shared date (and optional time) picker. Renders the same in every browser,
 * unlike native date inputs, and works inside Field and Dialog.
 */
export function DatePicker({
  name,
  value,
  onChange,
  withTime = false,
  defaultTime = '09:00',
  min,
  max,
  maxError,
  placeholder = 'Выберите дату',
  displayFormat = 'long',
  clearable = true,
  disabled = false,
  id,
  required,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
  'aria-label': ariaLabel,
}: DatePickerProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const errorId = useId();
  const [text, setText] = useState(() => formatDateInput(value, withTime));
  const [showError, setShowError] = useState(false);
  const [editing, setEditing] = useState(false);
  const parsed = parseDateInput(text, { withTime, time: value.slice(11, 16) || defaultTime, min, max, maxError });
  const error = parsed.error || (required && !text.trim() ? 'Укажите дату.' : null);
  useEffect(() => { setText(formatDateInput(value, withTime)); }, [value, withTime]);
  useEffect(() => { inputRef.current?.setCustomValidity(error || ''); }, [error]);
  const [open, setOpen] = useState(false);

  const selectedKey = value ? value.slice(0, 10) : '';
  const selectedTime = withTime && value.length >= 16 ? value.slice(11, 16) : '';
  const selected = selectedKey ? parseKey(selectedKey) : null;
  const todayKey = toKey(new Date());
  const [view, setView] = useState(() => {
    const base = selected ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [focusKey, setFocusKey] = useState(selectedKey || todayKey);
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const popoverPosition = useFloatingPosition(open, controlRef, popoverRef);

  useEffect(() => {
    if (!open) return;
    const base = selected ?? new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setFocusKey(selectedKey || todayKey);
    setMode('days');
    // Sync the visible month only when the popover opens.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'days') return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-key="${focusKey}"]`)?.focus();
  }, [focusKey, open, view, mode]);

  const days = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const leading = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_unused, index) => new Date(view.year, view.month, 1 - leading + index));
  }, [view]);

  const minMonth = min ? min.slice(0, 7) : null;
  const maxMonth = max ? max.slice(0, 7) : null;
  const monthKey = (year: number, month: number): string =>
    `${year}-${String(month + 1).padStart(2, '0')}`;
  const isDisabledMonth = (year: number, month: number): boolean => {
    const key = monthKey(year, month);
    return Boolean((minMonth && key < minMonth) || (maxMonth && key > maxMonth));
  };
  const isDisabledYear = (year: number): boolean =>
    Boolean((min && year < Number(min.slice(0, 4))) || (max && year > Number(max.slice(0, 4))));
  const yearPageStart = Math.floor(view.year / 12) * 12;

  const shiftView = (direction: -1 | 1): void => {
    setView((current) => {
      if (mode === 'years') return { ...current, year: current.year + direction * 12 };
      if (mode === 'months') return { ...current, year: current.year + direction };
      const month = current.month + direction;
      if (month < 0) return { year: current.year - 1, month: 11 };
      if (month > 11) return { year: current.year + 1, month: 0 };
      return { ...current, month };
    });
  };
  const navLabel = mode === 'years' ? 'годы' : mode === 'months' ? 'год' : 'месяц';
  const titleLabel = mode === 'years'
    ? `${yearPageStart} – ${yearPageStart + 11}`
    : mode === 'months' ? String(view.year) : `${MONTHS[view.month]} ${view.year}`;

  const isDisabledDay = (key: string): boolean =>
    Boolean((min && key < min.slice(0, 10)) || (max && key > max.slice(0, 10)));

  const commit = (key: string, time = selectedTime || defaultTime): void => {
    const candidate = withTime ? `${key}T${time}` : key;
    const result = parseDateInput(formatDateInput(candidate, withTime), { withTime, time, min, max, maxError });
    setText(formatDateInput(candidate, withTime));
    setShowError(Boolean(result.error));
    inputRef.current?.setCustomValidity(result.error || '');
    if (result.value === null) return;
    onChange(result.value);
    if (!withTime) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const moveFocus = (deltaDays: number): void => {
    const current = parseKey(focusKey) ?? new Date();
    const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + deltaDays);
    setFocusKey(toKey(next));
    if (next.getMonth() !== view.month || next.getFullYear() !== view.year) {
      setView({ year: next.getFullYear(), month: next.getMonth() });
    }
  };

  const label = selected
    ? `${(displayFormat === 'short' ? shortDate : displayDate).format(selected).replace(' г.', '')}${selectedTime ? `, ${selectedTime}` : ''}`
    : '';

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}>
      <div ref={controlRef} className={styles.control} data-invalid={showError && error ? 'true' : undefined}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode={withTime ? 'text' : 'numeric'}
          autoComplete="off"
          placeholder={placeholder === 'Выберите дату' ? (withTime ? 'ДД.ММ.ГГГГ ЧЧ:ММ' : 'ДД.ММ.ГГГГ') : placeholder}
          className={styles.input}
          value={!editing && !error && value && text === formatDateInput(value, withTime) ? label : text}
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          aria-describedby={[ariaDescribedBy, showError && error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
          aria-invalid={showError && error ? true : ariaInvalid}
          aria-required={ariaRequired ?? required}
          onFocus={() => setEditing(true)}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const result = parseDateInput(next, { withTime, time: selectedTime || defaultTime, min, max, maxError });
            event.target.setCustomValidity(result.error || '');
            if (!next.trim()) { setShowError(false); onChange(''); }
          }}
          onBlur={() => {
            setEditing(false);
            setShowError(Boolean(error));
            if (parsed.value !== null && parsed.value !== value) onChange(parsed.value);
          }}
          onInvalid={(event) => { event.preventDefault(); setShowError(true); window.requestAnimationFrame(() => inputRef.current?.focus()); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
            if (event.key === 'Enter') {
              event.preventDefault(); setShowError(Boolean(error));
              if (parsed.value !== null && parsed.value !== value) onChange(parsed.value);
            }
          }}
        />
        <div className={styles.inputActions}>
          {clearable && (text || value) && !disabled ? (
            <IconButton aria-label="Очистить дату" onClick={() => {
              setText(''); setShowError(false); inputRef.current?.setCustomValidity(''); onChange(''); inputRef.current?.focus();
            }}><CloseIcon /></IconButton>
          ) : null}
          <IconButton ref={triggerRef} disabled={disabled} aria-label={ariaLabel ? `Открыть календарь: ${ariaLabel}` : 'Открыть календарь'}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
            onClick={() => setOpen((current) => !current)}><CalendarIcon /></IconButton>
        </div>
      </div>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      {showError && error ? <p id={errorId} role="alert" className={styles.error}>{error}</p> : null}

      {open ? (
        <div
          ref={popoverRef}
          id={dialogId}
          role="dialog"
          aria-label="Выбор даты"
          popover="manual"
          className={styles.popover}
          style={{
            left: popoverPosition?.left,
            top: popoverPosition?.top,
            maxHeight: popoverPosition?.maxHeight,
            visibility: popoverPosition ? 'visible' : 'hidden',
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <div className={styles.header}>
            <button type="button" className={styles.nav} aria-label={`Предыдущий ${navLabel === 'годы' ? 'период' : navLabel}`}
              onClick={() => shiftView(-1)}>
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className={styles.title}
              disabled={mode === 'years'}
              aria-label={mode === 'days' ? 'Выбрать месяц и год' : mode === 'months' ? 'Выбрать год' : undefined}
              onClick={() => setMode(mode === 'days' ? 'months' : 'years')}
            >
              {titleLabel}
              {mode !== 'years' ? <ChevronDownIcon /> : null}
            </button>
            <button type="button" className={styles.nav} aria-label={`Следующий ${navLabel === 'годы' ? 'период' : navLabel}`}
              onClick={() => shiftView(1)}>
              <ChevronRightIcon />
            </button>
          </div>

          {mode === 'months' ? (
            <div className={styles.pickGrid} role="listbox" aria-label={`Месяцы ${view.year}`}>
              {MONTHS.map((month, index) => {
                const current = Boolean(selected && selected.getFullYear() === view.year && selected.getMonth() === index);
                return (
                  <button
                    key={month}
                    type="button"
                    role="option"
                    aria-selected={current}
                    disabled={isDisabledMonth(view.year, index)}
                    className={[styles.pick, current && styles.selected].filter(Boolean).join(' ')}
                    onClick={() => { setView({ year: view.year, month: index }); setMode('days'); }}
                  >
                    {MONTH_SHORT[index]}
                  </button>
                );
              })}
            </div>
          ) : null}
          {mode === 'years' ? (
            <div className={styles.pickGrid} role="listbox" aria-label="Годы">
              {Array.from({ length: 12 }, (_unused, index) => yearPageStart + index).map((year) => {
                const current = selected?.getFullYear() === year;
                return (
                  <button
                    key={year}
                    type="button"
                    role="option"
                    aria-selected={current}
                    disabled={isDisabledYear(year)}
                    className={[styles.pick, current && styles.selected, year === new Date().getFullYear() && styles.today].filter(Boolean).join(' ')}
                    onClick={() => { setView((value) => ({ ...value, year })); setMode('months'); }}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          ) : null}
          {mode === 'days' ? (<>
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div
            ref={gridRef}
            className={styles.grid}
            role="grid"
            aria-label={`${MONTHS[view.month]} ${view.year}`}
            onKeyDown={(event) => {
              const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
              if (event.key in moves) { event.preventDefault(); moveFocus(moves[event.key]!); }
            }}
          >
            {Array.from({ length: 6 }, (_row, week) => (
              <div key={week} role="row" className={styles.row}>
                {days.slice(week * 7, week * 7 + 7).map((day) => {
                  const key = toKey(day);
                  const outside = day.getMonth() !== view.month;
                  const disabledDay = isDisabledDay(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="gridcell"
                      data-key={key}
                      tabIndex={key === focusKey ? 0 : -1}
                      disabled={disabledDay}
                      aria-selected={key === selectedKey}
                      aria-label={displayDate.format(day)}
                      className={[
                        styles.day,
                        outside && styles.outside,
                        key === todayKey && styles.today,
                        key === selectedKey && styles.selected,
                      ].filter(Boolean).join(' ')}
                      onClick={() => commit(key)}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          </>) : null}

          <div className={styles.footer}>
            {withTime ? (
              <label className={styles.time}>
                <span>Время</span>
                <input
                  type="time"
                  step={300}
                  value={selectedTime || defaultTime}
                  onChange={(event) => commit(selectedKey || todayKey, event.target.value || defaultTime)}
                />
              </label>
            ) : (
              <button type="button" className={styles.link} disabled={isDisabledDay(todayKey)} onClick={() => commit(todayKey)}>
                Сегодня
              </button>
            )}
            {withTime ? (
              <button type="button" className={styles.done} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>
                Готово
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
