export interface CreationRequestMetadata {
  fingerprint: string;
  id: string;
}

/** Keep the existing key after an unknown result, including draft restoration. */
export function retainCreationRequest(
  previous: CreationRequestMetadata | null,
  fingerprint: string,
  createId: () => string,
): CreationRequestMetadata {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, id: createId() };
}

export function prepareCreateSubmission<Draft extends { creationRequest?: CreationRequestMetadata | null }>(
  draft: Draft,
  payload: unknown,
  createId: () => string,
): { draft: Draft & { creationRequest: CreationRequestMetadata }; creationRequestId: string } {
  const creationRequest = retainCreationRequest(draft.creationRequest ?? null, JSON.stringify(payload), createId);
  return { draft: { ...draft, creationRequest }, creationRequestId: creationRequest.id };
}

export const ORDER_CREATE_SECTION_IDS = ['basic', 'planning', 'conditions', 'specification', 'notes'] as const;
export type OrderCreateSection = (typeof ORDER_CREATE_SECTION_IDS)[number];

export function isOrderCreateSection(id: string): id is OrderCreateSection {
  return ORDER_CREATE_SECTION_IDS.some((section) => section === id);
}
