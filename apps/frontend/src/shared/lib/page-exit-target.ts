/** Returns a navigable in-app URL only when the destination actually leaves the current location. */
export function getPageExitTarget(
  destinationHref: string,
  currentHref: string,
): string | null {
  let destination: URL;
  let current: URL;
  try {
    destination = new URL(destinationHref, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }

  if (destination.origin !== current.origin) return null;
  if (
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.hash === current.hash
  ) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
