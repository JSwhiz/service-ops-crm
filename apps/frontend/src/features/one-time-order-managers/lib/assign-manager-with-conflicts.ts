type ScheduleConflict = { date: string; type: string; user: { fullName: string } };

function assignmentConflict(error: unknown): { fingerprint: string; conflicts: ScheduleConflict[] } | null {
  if (!(error instanceof Error) || error.name !== 'ApiError' ||
      (error as Error & { statusCode?: number }).statusCode !== 409) return null;
  const body = error.cause;
  if (!body || typeof body !== 'object') return null;
  const payload = 'error' in body && body.error && typeof body.error === 'object' ? body.error : body;
  if (!('hasConflicts' in payload) || payload.hasConflicts !== true ||
      !('conflictFingerprint' in payload) || typeof payload.conflictFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.conflictFingerprint) ||
      !('conflicts' in payload) || !Array.isArray(payload.conflicts) ||
      !payload.conflicts.every((item: unknown) => !!item && typeof item === 'object' &&
        'date' in item && typeof item.date === 'string' &&
        'type' in item && typeof item.type === 'string' &&
        'user' in item && !!item.user && typeof item.user === 'object' &&
        'fullName' in item.user && typeof item.user.fullName === 'string')) return null;
  return { fingerprint: payload.conflictFingerprint, conflicts: payload.conflicts as ScheduleConflict[] };
}

/** Save once in the normal path. A second request requires the user to confirm
 * the actual server-reported conflict; unrelated failures are never replayed. */
export async function assignManagerWithConflictConfirmation<T>({ save, isCurrent, confirm }: {
  save: (fingerprint?: string) => Promise<T>;
  isCurrent: () => boolean;
  confirm: (conflicts: ScheduleConflict[]) => Promise<boolean>;
}): Promise<T | null> {
  if (!isCurrent()) return null;
  try {
    return await save();
  } catch (error) {
    if (!isCurrent()) return null;
    const conflict = assignmentConflict(error);
    if (!conflict) throw error;
    if (!(await confirm(conflict.conflicts)) || !isCurrent()) return null;
    return save(conflict.fingerprint);
  }
}
