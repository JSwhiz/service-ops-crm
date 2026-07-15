'use client';

import Link from 'next/link';
import React from 'react';

import { OneTimeOrderCalendar } from '@/features/one-time-order-calendar/ui/one-time-order-calendar';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function OneTimeOrderCalendarPage(): React.JSX.Element {
  return (
    <div className="page-stack">
      <div className="section-header">
        <PageTitle title="Календарь разовых заказов" />
        <Link href="/one-time-orders">К реестру</Link>
      </div>
      <OneTimeOrderCalendar />
    </div>
  );
}
