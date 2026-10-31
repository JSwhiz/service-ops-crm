'use client';

import React, { useRef } from 'react';
import { Button } from '@/shared/ui/foundation';
import styles from './timesheet-scroll-region.module.css';

/** Navigation only: the timesheet cells and totals remain untouched. */
export function TimesheetScrollRegion({ year, month, stickyWidth, className, children }: {
  year: number; month: number; stickyWidth: number; className: string; children: React.ReactNode;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const today = (part: Intl.DateTimeFormatPartTypes): number => Number(todayParts.find((value) => value.type === part)?.value);
  const isCurrentMonth = year === today('year') && month === today('month');
  const scrollToToday = (): void => {
    const scroll = scrollRef.current;
    const header = scroll?.querySelector<HTMLElement>(`[data-timesheet-day="${today('day')}"]`);
    if (scroll && header) scroll.scrollBy({ left: header.getBoundingClientRect().left - scroll.getBoundingClientRect().left - stickyWidth });
  };
  return <>
    <div className={styles.controls} role="group" aria-label="Прокрутка дней табеля">
      <Button size="sm" onClick={() => scrollRef.current?.scrollBy({ left: -400 })}>Раньше</Button>
      <Button size="sm" disabled={!isCurrentMonth} onClick={scrollToToday}>Сегодня</Button>
      <Button size="sm" onClick={() => scrollRef.current?.scrollBy({ left: 400 })}>Позже</Button>
      <span>Дни можно прокручивать по горизонтали</span>
    </div>
    <div ref={scrollRef} className={`${className} ${styles.region}`} role="region" aria-label="Дни табеля" tabIndex={0}>{children}</div>
  </>;
}
