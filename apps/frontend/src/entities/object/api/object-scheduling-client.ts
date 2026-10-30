import { fetcher } from '@/shared/api/fetcher';
import type { CreatePositionInput, ExpectedShift, PayContour, PositionInput, PositionsResponse, SchedulePreview, ShiftAttendance, StaffingPosition } from '../model/object-scheduling.types';

const base = (id: string): string => `/objects/${id}/scheduling`;
export const getStaffingPositions = (id: string): Promise<PositionsResponse> => fetcher(`${base(id)}/positions`);
export const createStaffingPosition = (id: string, input: CreatePositionInput): Promise<StaffingPosition> => fetcher(`${base(id)}/positions`, { method: 'POST', body: JSON.stringify(input) });
export const saveStaffingPosition = (id: string, positionId: string, input: PositionInput & { expectedVersion: number }): Promise<StaffingPosition> => fetcher(`${base(id)}/positions/${positionId}`, { method: 'PUT', body: JSON.stringify(input) });
export const previewSchedule = (id: string, input: { from: string; to: string; positionIds?: string[]; draft?: CreatePositionInput }): Promise<SchedulePreview> => fetcher(`${base(id)}/preview`, { method: 'POST', body: JSON.stringify(input) });
export const previewNewObjectSchedule = (input: { from: string; to: string; draft: CreatePositionInput }): Promise<SchedulePreview> => fetcher('/object-scheduling/preview', { method: 'POST', body: JSON.stringify(input) });
export type PayContourInput = Pick<PayContour, 'code' | 'name' | 'dailyRate' | 'summerDailyRate' | 'winterDailyRate'>;
export const createPayContour = (id: string, input: PayContourInput): Promise<PayContour> => fetcher(`${base(id)}/contours`, { method: 'POST', body: JSON.stringify(input) });
export const savePayContour = (id: string, contourId: string, input: Partial<Omit<PayContourInput, 'code'>> & { expectedVersion: number; isActive?: boolean }): Promise<PayContour> => fetcher(`${base(id)}/contours/${contourId}`, { method: 'PATCH', body: JSON.stringify(input) });
export const getPayContours = (id: string): Promise<{ contours: PayContour[] }> => fetcher(`${base(id)}/contours`);
export const getShiftAttendance = (id: string, from: string, to: string): Promise<{ attendance: ShiftAttendance[] }> => fetcher(`${base(id)}/attendance?${new URLSearchParams({ from, to })}`);
export const cancelScheduledShift = (id: string, attendanceId: string, input: { expectedVersion: number; reason: string }): Promise<ShiftAttendance> => fetcher(`${base(id)}/attendance/${attendanceId}/cancel`, { method: 'POST', body: JSON.stringify(input) });
export const confirmScheduledShift = (id: string, shift: ExpectedShift, requestKey: string): Promise<ShiftAttendance> => fetcher(`${base(id)}/attendance/confirm`, {
  method: 'POST', body: JSON.stringify({ requestKey, positionId: shift.positionId, revisionId: shift.revisionId, groupKey: shift.groupKey, timeRangeKey: shift.timeRangeKey, employeeId: shift.employeeId, operationDate: shift.operationDate }),
});
