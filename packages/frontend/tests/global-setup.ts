import type { FullConfig } from '@playwright/test';

const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3001';
const TEST_FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:3002';

const MAX_RETRIES = 30;
const RETRY_DELAY = 2000;

async function waitForService(url: string, name: string): Promise<void> {
  console.log(`Waiting for ${name} at ${url}...`);

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status === 401 || response.status === 404) {
        console.log(`${name} is ready!`);
        return;
      }
    } catch (error) {
      // Service not ready yet
    }

    console.log(`${name} not ready, retrying in ${RETRY_DELAY / 1000}s... (${i + 1}/${MAX_RETRIES})`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  throw new Error(`${name} failed to become ready after ${MAX_RETRIES} attempts`);
}

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('=== E2E Test Global Setup ===');
  console.log(`API URL: ${TEST_API_URL}`);
  console.log(`Frontend URL: ${TEST_FRONTEND_URL}`);

  // Wait for backend to be ready
  await waitForService(`${TEST_API_URL}/health`, 'Backend API');

  // Wait for frontend to be ready
  await waitForService(TEST_FRONTEND_URL, 'Frontend');

  console.log('=== All services ready! ===');
}

export default globalSetup;
