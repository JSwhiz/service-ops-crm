'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, IconButton } from '@/shared/ui/foundation';
import { ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/icons/icons';
import { getCellRevealScroll, getHorizontalOverflow, getMoscowToday, getNextMatrixCell } from '../model/matrix-navigation';
import styles from './timesheet-scroll-region.module.css';

export function TimesheetScrollRegion({ year, month, stickyWidth, className, children }: {
  year: number; month: number; stickyWidth: number; className: string; children: React.ReactNode;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState({ before: false, after: false });
  const today = getMoscowToday();
  const isCurrentMonth = year === today.year && month === today.month;

  const measure = useCallback((): void => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = getHorizontalOverflow(scroll.scrollLeft, scroll.clientWidth, scroll.scrollWidth);
    setOverflow((current) => current.before === next.before && current.after === next.after ? current : next);
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    const table = scroll.querySelector('table');
    if (table) observer.observe(table);
    // Focus is managed here, rather than by each financial cell.
    const cells = scroll.querySelectorAll<HTMLButtonElement>('[data-timesheet-cell]');
    if (![...cells].some((cell) => cell.tabIndex === 0) && cells[0]) cells[0].tabIndex = 0;
    scroll.querySelectorAll<HTMLElement>('[data-timesheet-day]').forEach((cell) => {
      if (isCurrentMonth && Number(cell.dataset.timesheetDay) === today.day) cell.setAttribute('data-today', 'true');
      else cell.removeAttribute('data-today');
    });
    return () => observer.disconnect();
  }, [children, isCurrentMonth, measure, today.day]);

  const revealCell = (cell: HTMLElement): void => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const total = scroll.querySelector<HTMLElement>('thead [data-sticky-total]');
    const rightInset = total?.getBoundingClientRect().width ?? 0;
    const headerHeight = scroll.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    scroll.scrollBy(getCellRevealScroll(cellRect, {
      left: rect.left + scroll.clientLeft,
      right: rect.left + scroll.clientLeft + scroll.clientWidth,
      top: rect.top + scroll.clientTop,
      bottom: rect.top + scroll.clientTop + scroll.clientHeight,
    }, { left: stickyWidth, right: rightInset, top: headerHeight }));
  };

  const scrollToToday = (): void => {
    const scroll = scrollRef.current;
    const header = scroll?.querySelector<HTMLElement>(`thead [data-timesheet-day="${today.day}"]`);
    if (scroll && header) scroll.scrollBy({ left: header.getBoundingClientRect().left - scroll.getBoundingClientRect().left - stickyWidth });
  };

  return <>
    <div className={styles.controls} role="group" aria-label="Прокрутка дней табеля">
      <IconButton aria-label="Прокрутить дни влево" disabled={!overflow.before} onClick={() => scrollRef.current?.scrollBy({ left: -400 })}><ChevronLeftIcon /></IconButton>
      <Button size="sm" disabled={!isCurrentMonth} onClick={scrollToToday}>К сегодняшнему дню</Button>
      <IconButton aria-label="Прокрутить дни вправо" disabled={!overflow.after} onClick={() => scrollRef.current?.scrollBy({ left: 400 })}><ChevronRightIcon /></IconButton>
      {!isCurrentMonth ? <span>Сегодня — в другом месяце</span> : null}
      {overflow.before || overflow.after ? <span id={hintId}>Часть столбцов скрыта — прокрутите таблицу по горизонтали</span> : null}
    </div>
    <div ref={scrollRef} className={`${className} ${styles.region}`} role="region" aria-label="Дни табеля" aria-describedby={overflow.before || overflow.after ? hintId : undefined} tabIndex={0} onScroll={measure}
      onFocusCapture={(event) => {
        const cell = event.target.closest<HTMLButtonElement>('[data-timesheet-cell]');
        const scroll = scrollRef.current;
        if (!cell || !scroll) return;
        scroll.querySelectorAll<HTMLButtonElement>('[data-timesheet-cell]').forEach((item) => { item.tabIndex = item === cell ? 0 : -1; });
        scroll.querySelectorAll<HTMLElement>('[data-selected-row]').forEach((item) => item.removeAttribute('data-selected-row'));
        cell.closest('tr')?.setAttribute('data-selected-row', 'true');
        scroll.querySelectorAll<HTMLElement>('[data-timesheet-day]').forEach((item) => {
          if (item.dataset.timesheetDay === cell.dataset.timesheetCell) item.setAttribute('data-selected-column', 'true');
          else item.removeAttribute('data-selected-column');
        });
        revealCell(cell);
      }}
      onKeyDown={(event) => {
        if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-timesheet-cell') || event.altKey || event.shiftKey) return;
        const rows = [...(scrollRef.current?.querySelectorAll('tbody tr') ?? [])].map((row) => [...row.querySelectorAll<HTMLButtonElement>('[data-timesheet-cell]')]);
        const row = rows.findIndex((items) => items.includes(event.target as HTMLButtonElement));
        const column = rows[row]?.indexOf(event.target) ?? -1;
        const next = getNextMatrixCell(row, column, event.key, rows.length, rows[row]?.length ?? 0, event.ctrlKey || event.metaKey);
        const target = next ? rows[next.row]?.[next.column] : null;
        if (!target) return;
        event.preventDefault();
        target.focus({ preventScroll: true });
      }}
    >{children}</div>
  </>;
}
