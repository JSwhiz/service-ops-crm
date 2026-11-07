// Browser-local invalidation only. Server policy remains the authority.
let identity: string | null = null;
let generation = 0;

export function updateAccessIdentity(next: string | null): void {
  if (identity === next) return;
  identity = next;
  generation += 1;
}

export function getAccessGeneration(): number {
  return generation;
}

export function isAccessGenerationCurrent(value: number): boolean {
  return value === generation;
}
