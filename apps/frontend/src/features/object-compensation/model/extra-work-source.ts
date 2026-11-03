import type { CompensationExplanation } from '../../../entities/object/model/object-compensation.types';

/** Use the current saved credit, never the original request's amount or timestamp. */
export function findExtraWorkSource(explanation: CompensationExplanation, adjustmentId: string, operationDate: string) {
  const matches = explanation.rows.flatMap((row) => row.entries
    .filter((entry) => entry.sourceKey === `extra:${adjustmentId}` && entry.operationDate === operationDate)
    .map((entry) => ({ ...entry, employeeName: row.employeeName })));
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (!entry) return null;
  if (!Number.isInteger(entry.amount) || entry.amount < 0 || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) return null;
  return entry;
}
