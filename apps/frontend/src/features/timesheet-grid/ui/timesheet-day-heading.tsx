import React from 'react';
import { getDayHeading } from '../model/matrix-navigation';
import styles from '@/entities/timesheet/ui/timesheet-ui.module.css';

export function TimesheetDayHeading({ year, month, day }: { year: number; month: number; day: number }): React.JSX.Element {
  const heading = getDayHeading(year, month, day);
  return <th scope="col" data-timesheet-day={day} data-weekend={heading.weekend || undefined} aria-label={heading.label}>
    <span className={styles.timesheetDayNumber}>{day}</span>
    <span className={styles.timesheetWeekday}>{heading.weekday}</span>
  </th>;
}
