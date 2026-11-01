export interface OverviewSnapshot<T> { data: T; scope: string; revision: number }

/** Retain the same-scope matrix on a read refresh; only fresh data permits another mutation. */
export function getOverviewRefreshState<T>(snapshot: OverviewSnapshot<T> | null, scope: string, revision: number, loading: boolean): { overview: T | null; mutationsBlocked: boolean } {
  if (!snapshot || snapshot.scope !== scope) return { overview: null, mutationsBlocked: true };
  return {
    overview: snapshot.data,
    mutationsBlocked: loading || snapshot.revision !== revision,
  };
}
