export type MediaUploadFailure<T> = { file: T; stopped: true } | { file: T; stopped: false; cause: unknown };

/** Selecting another batch must not discard earlier retained files. Identity is
 * the actual File object, not its name: distinct explicit selections may share names. */
export function mergeMediaUploadFailures<T>(
  previous: readonly MediaUploadFailure<T>[],
  attempted: readonly T[],
  failures: readonly MediaUploadFailure<T>[],
): Array<MediaUploadFailure<T>> {
  const attemptedFiles = new Set(attempted);
  return [...previous.filter(row => !attemptedFiles.has(row.file)), ...failures];
}

/** Keep unattempted files available for an explicit retry. Never retry a
 * successful callback or continue a batch under a different access snapshot. */
export async function runMediaUploadBatch<T>(
  files: readonly T[],
  canContinue: () => boolean,
  onPick: (file: T) => Promise<void>,
): Promise<Array<MediaUploadFailure<T>>> {
  const failures: Array<MediaUploadFailure<T>> = [];
  for (let index = 0; index < files.length; index += 1) {
    if (!canContinue()) {
      failures.push(...files.slice(index).map(file => ({ file, stopped: true as const })));
      break;
    }
    const file = files[index]!;
    try { await onPick(file); }
    catch (cause) { failures.push({ file, stopped: false, cause }); }
  }
  return failures;
}
