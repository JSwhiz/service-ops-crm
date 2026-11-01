/**
 * Keeps a committed mutation successful even if its follow-up read fails.
 * The refresh promise is returned separately so callers can clear drafts and
 * release the submit state immediately after the write is confirmed.
 */
export async function commitAndStartRefresh<T>(
  commit: () => Promise<T>,
  afterCommit: (result: T) => void,
  refresh: () => Promise<unknown>,
): Promise<{ result: T; refreshResult: Promise<boolean> }> {
  const result = await commit();
  afterCommit(result);

  const refreshResult = Promise.resolve()
    .then(refresh)
    .then((result) => typeof result === 'boolean' ? result : true, () => false);

  return { result, refreshResult };
}
