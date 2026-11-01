/** An explicitly captured empty query is not the absence of capture. */
export function createTargetSearch(captured: { targetSearch: string } | undefined, directSearch: string): URLSearchParams {
  return new URLSearchParams(captured?.targetSearch ?? directSearch);
}
