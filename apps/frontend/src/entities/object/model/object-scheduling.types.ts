/** Mirrors object-scheduling/SCHEDULING_API.md; money stays numeric. */
export interface ScheduleTemplate {
  kind: 'weekly' | 'cycle' | 'custom';
  anchorDate?: string | null;
  weekdays?: number[];
  sequence?: boolean[];
  exceptions?: { date: string; working: boolean }[];
}
export interface ScheduleTimeRange {
  key: string; start: string; end: string; endDayOffset: 0 | 1; contourId?: string | null;
}
export interface RotationGroup {
  key: string; name: string; offsetDays: number; timeRanges: ScheduleTimeRange[];
  assignments: { employeeId: string; from: string; to?: string | null }[];
}
export interface PositionInput {
  name: string; headcount?: number | null; requiredPerShift?: number;
  effectiveFrom: string; template: ScheduleTemplate; groups: RotationGroup[];
}
export interface CreatePositionInput extends PositionInput { clientKey: string }
export interface ScheduleRevision extends PositionInput {
  id: string; version: number; headcount: number | null; requiredPerShift: number;
  archived: boolean; createdByUserId: string; createdAt: string;
}
export interface StaffingPosition {
  id: string; objectId: string; clientKey: string; version: number; revisions: ScheduleRevision[];
}
export interface SchedulingCapabilities { managePositions: boolean; manageAssignments: boolean; selectPayConditions: boolean; manageRates: boolean; confirmAttendance: boolean }
export interface PositionsResponse { positions: StaffingPosition[]; capabilities: SchedulingCapabilities }
export interface ExpectedShift {
  positionId: string; revisionId: string; groupKey: string; timeRangeKey: string;
  employeeId: string; operationDate: string; startsAt: string; endsAt: string; contourId: string | null;
}
export interface SchedulePreview {
  from: string; to: string; shifts: ExpectedShift[];
  coverage: { positionId: string; date: string; required: number; assigned: number; uncovered: number;
    intervals: { startsAt: string; endsAt: string; required: number; assigned: number; uncovered: number }[] }[];
  warnings: { code: string; message: string; date?: string; employeeId?: string; positionId?: string }[];
  recommendedGroups: number | null;
}
export interface PayContour {
  id: string; objectId: string; code: string; name: string; dailyRate: number;
  summerDailyRate: number | null; winterDailyRate: number | null;
  isActive: boolean; version: number; effectiveFrom: string; updatedAt: string;
}
export interface ShiftAttendance extends ExpectedShift {
  id: string; objectId: string; status: 'confirmed' | 'cancelled'; version: number;
  dailyRateSnapshot: number | null; ratePolicySnapshot: unknown;
  createdByUserId: string; createdAt: string;
  cancelledByUserId: string | null; cancelledAt: string | null; cancelReason: string | null;
}
