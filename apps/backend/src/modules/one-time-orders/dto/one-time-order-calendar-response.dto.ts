import type { ManagerAvailabilityCapabilities } from '../utils/one-time-manager-availability-capabilities.util';

export interface CalendarManagerCapabilities {
  canRequestOwnAvailability: boolean;
  canCreateAvailability: boolean;
  canExport: boolean;
}

export class OneTimeOrderCalendarResponseDto {
  capabilities!: { canExport: boolean; canRequestOwnAvailability: boolean };
  availabilityTargets!: Array<{
    user: { id: string; login: string; fullName: string };
    capabilities: CalendarManagerCapabilities;
  }>;
  month!: string;
  daysInMonth!: number;
  managers!: Array<{
    user: {
      id: string;
      login: string;
      fullName: string;
    };
    isActive: boolean;
    capabilities: CalendarManagerCapabilities;
    workedDays: number;
    orderCount: number;
    completedOrderCount: number;
    cancelledOrderCount: number;
    days: Array<{
      date: string;
      availability: CalendarAvailabilityDto | null;
      pendingRequests: CalendarAvailabilityDto[];
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
  capabilities: ManagerAvailabilityCapabilities;
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
