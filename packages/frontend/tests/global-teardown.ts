import type { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig): Promise<void> {
  console.log('=== E2E Test Global Teardown ===');
  // Cleanup can be added here if needed
  // For now, we rely on docker-compose to clean up test data
  console.log('Teardown complete.');
}

export default globalTeardown;
