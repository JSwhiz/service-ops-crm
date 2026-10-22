'use client';

import React from 'react';

import { OneTimeOrderCalendar } from '@/features/one-time-order-calendar/ui/one-time-order-calendar';
import { BackLink } from '@/shared/ui/foundation';
import calendarStyles from '@/features/one-time-order-calendar/ui/one-time-order-calendar.module.css';

export default function OneTimeOrderCalendarPage(): React.JSX.Element {
  return (
    <div className={`ui-page ${calendarStyles.oneTimeCalendarPage}`}>
      <BackLink href="/one-time-orders">Разовые заказы</BackLink>
      <OneTimeOrderCalendar />
    </div>
  );
}
