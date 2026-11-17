/** One request identity for a logical draft, including uncertain manual retries. */
export function createExpenseDraftRequest(): {
  getId: () => string;
  complete: () => void;
} {
  let requestId: string | undefined;
  return {
    getId: () => (requestId ??= crypto.randomUUID()),
    complete: () => {
      requestId = undefined;
    },
  };
}
