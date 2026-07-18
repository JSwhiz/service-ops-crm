export function usesIsolatedIntegrationDatabase(): boolean {
  return process.env.TEST_ISOLATED_DATABASE === 'true';
}
