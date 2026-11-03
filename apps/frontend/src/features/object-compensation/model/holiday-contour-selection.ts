import type { PayContour } from '../../../entities/object/model/object-scheduling.types';

// The base (null) route remains available alongside named conditions.
export function initialHolidayContour(contours: Pick<PayContour, 'id'>[]): null | undefined {
  return contours.length === 0 ? null : undefined;
}

export function isHolidayContourSelected(contours: Pick<PayContour, 'id'>[], value: string | null | undefined): boolean {
  return value === null || typeof value === 'string' && contours.some((contour) => contour.id === value);
}
