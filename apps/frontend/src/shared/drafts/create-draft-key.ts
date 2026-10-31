function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

/** Unambiguous in-memory identity for a user's form draft at one route/query. */
export function createDraftKey(
  userId: string,
  pathname: string,
  query: string,
  formKey: string,
): string {
  return [userId, pathname, query, formKey].map(encodePart).join('');
}
