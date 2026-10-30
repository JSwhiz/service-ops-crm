import type { RotationGroupDto, TemplateDto } from './scheduling.dto';

export interface SchedulingUser {
  id: string; login: string; fullName: string; roleCode: string;
  roleCodes?: string[]; permissionCodes?: string[]; isActive: boolean;
}
export interface ScheduleRevisionView {
  id: string; version: number; effectiveFrom: string; name: string;
  headcount: number | null; requiredPerShift: number; archived: boolean; template: TemplateDto;
  groups: RotationGroupDto[]; createdByUserId: string; createdAt: string;
}
export interface PositionView {
  id: string; objectId: string; clientKey: string; version: number;
  revisions: ScheduleRevisionView[];
}
export interface ExpectedShift {
  positionId: string; revisionId: string; groupKey: string; timeRangeKey: string;
  employeeId: string; operationDate: string; startsAt: string; endsAt: string;
  contourId: string | null;
}
export interface SchedulingWarning {
  code: string; message: string; date?: string; employeeId?: string; positionId?: string;
}
export interface PreviewResponse {
  from: string; to: string; shifts: ExpectedShift[];
  coverage: {positionId: string; date: string; required: number; assigned: number; uncovered: number;
    intervals: {startsAt: string; endsAt: string; required: number; assigned: number; uncovered: number}[]}[];
  warnings: SchedulingWarning[]; recommendedGroups: number | null;
}
