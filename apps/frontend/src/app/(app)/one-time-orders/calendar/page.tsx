'use client';

import Link from 'next/link';
import React from 'react';

import { OneTimeOrderCalendar } from '@/features/one-time-order-calendar/ui/one-time-order-calendar';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Surface } from '@/shared/ui/foundation';

export default function OneTimeOrderCalendarPage(): React.JSX.Element {
  return (
    <div className="ui-page one-time-calendar-page">
      <Surface padding="md" className="ui-section-header registry-header">
        <PageTitle title="Календарь разовых заказов" />
        <Link href="/one-time-orders">К реестру</Link>
      </Surface>
      <OneTimeOrderCalendar />
    </div>
  );
}
