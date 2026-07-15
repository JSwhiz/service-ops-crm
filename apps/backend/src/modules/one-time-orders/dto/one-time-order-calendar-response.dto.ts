export class OneTimeOrderCalendarResponseDto {
  month!: string;
  daysInMonth!: number;
  managers!: Array<{
    user: {
      id: string;
      login: string;
      fullName: string;
    };
    isActive: boolean;
    workedDays: number;
    orderCount: number;
    completedOrderCount: number;
    cancelledOrderCount: number;
    days: Array<{
      date: string;
      availability: CalendarAvailabilityDto | null;
      pendingOwnRequest: CalendarAvailabilityDto | null;
      orders: CalendarOrderDto[];
      conflictLevel:
        | 'none'
        | 'multiple_orders'
        | 'approved_availability'
        | 'multiple_orders_and_availability';
    }>;
  }>;
}

export interface CalendarAvailabilityDto {
  id: string;
  entryType: string;
  startDate: string;
  endDate: string;
  status: string;
  comment: string | null;
}

export interface CalendarOrderDto {
  type: 'existing_order';
  detailsRestricted: boolean;
  relatedOrder: {
    id: string;
    title: string;
    status: string;
    executionStartDate: string;
    executionEndDate: string;
    executionAddress: string;
    linkedObject: { id: string; name: string } | null;
    managers: Array<{ id: string; login: string; fullName: string }>;
  } | null;
}
