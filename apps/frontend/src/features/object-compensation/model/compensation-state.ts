import type { CompensationVersion } from '../../../entities/object/model/object-compensation.types';

/** Business dates are YYYY-MM-DD; a future or cancelled row never becomes current. */
export function effectiveCompensationVersion(versions: CompensationVersion[], scope: CompensationVersion['scope'], scopeId: string, date: string): CompensationVersion | undefined {
  return versions.filter((v) => v.scope === scope && v.scopeId === scopeId && !v.cancelledAt && v.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
}

/** Concurrency follows the complete lineage, including cancelled future rows. */
export function expectedCompensationVersion(versions: CompensationVersion[], scope: CompensationVersion['scope'], scopeId: string): number {
  return Math.max(0, ...versions.filter((v) => v.scope === scope && v.scopeId === scopeId).map((v) => v.version));
}
