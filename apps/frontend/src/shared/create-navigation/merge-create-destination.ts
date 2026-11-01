export interface MergedCreateDestination {
  href: string;
  targetSearch: string;
}

/** Preserves source query pairs first; form-specific query values follow as additional pairs. */
export function mergeCreateDestination(
  destinationHref: string,
  sourceHref: string,
): MergedCreateDestination | null {
  let source: URL;
  try {
    source = new URL(sourceHref);
  } catch {
    return null;
  }

  let destination: URL;
  try {
    destination = new URL(destinationHref, source.origin);
  } catch {
    return null;
  }
  if (destination.origin !== source.origin || !destination.pathname.startsWith('/') || destination.pathname.startsWith('//')) {
    return null;
  }

  const targetSearch = destination.search.slice(1);
  const sourceSearch = source.search.slice(1);
  const search = [sourceSearch, targetSearch].filter(Boolean).join('&');
  return {
    href: `${destination.pathname}${search ? `?${search}` : ''}${destination.hash}`,
    targetSearch,
  };
}
