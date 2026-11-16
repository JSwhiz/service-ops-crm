// Browser-local invalidation only. Server policy remains the authority.
let identity: string | null = null;
let generation = 0;
let sessionGeneration = 0;

function accountId(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, value.lastIndexOf(':'));
}

export function updateAccessIdentity(next: string | null): void {
  if (identity === next) return;
  if (accountId(identity) !== accountId(next)) sessionGeneration += 1;
  identity = next;
  generation += 1;
}

export function getAccessGeneration(): number {
  return generation;
}

export function isAccessGenerationCurrent(value: number): boolean {
  return value === generation;
}

export function getAccessSessionGeneration(): number {
  return sessionGeneration;
}
