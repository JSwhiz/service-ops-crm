/** Route completion and modal removal are both required before returning focus. */
export function canRestoreCreateFocus(targetHref: string, actualHref: string, modalOpen: boolean): boolean {
  if (modalOpen) return false;
  try {
    const actual = new URL(actualHref);
    const target = new URL(targetHref, actual.origin);
    return actual.origin === target.origin && actual.pathname === target.pathname && actual.search === target.search;
  } catch { return false; }
}

export function selectCreateReturnFocus<T>(original: T | null, replacement: T | null, globalTrigger: T | null, usable: (node: T) => boolean): T | null {
  return [original, replacement, globalTrigger].find((node): node is T => node !== null && usable(node)) ?? null;
}
