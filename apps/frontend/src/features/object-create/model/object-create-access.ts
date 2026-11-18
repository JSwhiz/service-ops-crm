import type { PositionDraft } from '@/features/object-scheduling/model/schedule-draft';
import type { CreateObjectPayload } from '@/entities/object/api/object-client';

/** Keep unauthorized keys absent, including explicit null, zero and empty arrays. */
export function createPayloadForAccess(
  base: CreateObjectPayload,
  access: { rates: boolean; materials: boolean; setup: boolean; contours: boolean; positions: boolean; counterparty: boolean },
  groups: Record<'rates' | 'materials' | 'setup' | 'contours' | 'positions' | 'counterparty', () => Partial<CreateObjectPayload>>,
): CreateObjectPayload {
  return { ...base,
    ...(access.rates ? groups.rates() : {}),
    ...(access.materials ? groups.materials() : {}),
    ...(access.setup ? groups.setup() : {}),
    ...(access.contours ? groups.contours() : {}),
    ...(access.positions ? groups.positions() : {}),
    ...(access.counterparty ? groups.counterparty() : {}),
  };
}

/** Pure, non-mutating projection. Confirmation remains the caller's job. */
export function projectCreatePositions(positions: PositionDraft[], access: {
  schedule: boolean;
  contours: boolean;
  selectPayConditions: boolean;
  employees: Record<string, boolean>;
}) {
  let omittedPositions = 0;
  let omittedAssignments = 0;
  const allowed = positions.flatMap((position) => {
    const usesContours = position.groups.some((group) => group.intervals.some((interval) => !!interval.contourId));
    if (!access.schedule || (usesContours && (!access.contours || !access.selectPayConditions))) {
      omittedPositions++;
      return [];
    }
    return [{ ...position, groups: position.groups.map((group) => {
      const assignments = group.assignments.filter((assignment) => access.employees[assignment.employeeId] === true);
      omittedAssignments += group.assignments.length - assignments.length;
      return { ...group, assignments };
    }) }];
  });
  return { positions: allowed, omittedPositions, omittedAssignments };
}
