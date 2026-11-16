// Preserve an existing demo identity; never migrate/remap legacy seed rows.
export const LEGACY_DEMO_TASK_ID = "33333333-3333-3333-3333-333333333333";
export const FRESH_DEMO_TASK_ID = "33333333-3333-4333-8333-333333333333";
export function chooseDemoTaskId(existingLegacyId?: string | null): string {
  return existingLegacyId ?? FRESH_DEMO_TASK_ID;
}
