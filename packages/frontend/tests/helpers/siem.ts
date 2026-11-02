import { expect, type Page } from '@playwright/test';
import { TEST_API_URL, TEST_FRONTEND_URL, setAuthState } from '../fixtures/auth';

/**
 * Sign the page in as an API-created user and land on the dashboard of the
 * given organization. Fails loudly if the app never renders the sidebar.
 */
export async function openAsUser(
  page: Page,
  token: string,
  organizationId: string,
  email = 'e2e@test.com'
): Promise<void> {
  await page.goto(TEST_FRONTEND_URL);
  await setAuthState(page, { id: 'test', email, name: 'E2E', token }, token);
  await page.evaluate((orgId) => {
    localStorage.setItem('currentOrganizationId', orgId);
  }, organizationId);
  await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30000 });
}

/** Sigma rule YAML that matches every log whose message contains `keyword` (logsource `any`). */
export function matchAnyLogSigmaYaml(title: string, keyword: string, level = 'high'): string {
  return [
    `title: ${title}`,
    `id: ${keyword}-${Date.now()}`,
    'status: test',
    `level: ${level}`,
    `description: Detects ${keyword}`,
    'author: E2E Test',
    'logsource:',
    '    product: any',
    'detection:',
    '    selection:',
    `        message|contains: '${keyword}'`,
    '    condition: selection',
    'falsepositives:',
    '    - Testing',
  ].join('\n');
}

export interface ApiDetection {
  id: string;
  ruleTitle: string;
  severity: string;
  logMessage: string;
  incidentId: string | null;
}

export async function listDetections(
  token: string,
  organizationId: string
): Promise<ApiDetection[]> {
  const res = await fetch(
    `${TEST_API_URL}/api/v1/siem/detections?organizationId=${organizationId}&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`GET /siem/detections failed: ${res.status}`);
  return (await res.json()).detections;
}

/**
 * Poll until the worker has stored a detection for the rule. The sigma job runs
 * in the worker container, so this is the only honest way to wait for it.
 */
export async function waitForDetection(
  token: string,
  organizationId: string,
  ruleTitle: string,
  timeout = 60_000
): Promise<ApiDetection> {
  let found: ApiDetection | undefined;
  await expect
    .poll(
      async () => {
        found = (await listDetections(token, organizationId)).find((d) => d.ruleTitle === ruleTitle);
        return found !== undefined;
      },
      { timeout, intervals: [500, 1000, 2000], message: `no detection for rule "${ruleTitle}"` }
    )
    .toBe(true);
  return found!;
}

/** Create an incident that carries the given detection events (makes it a sigma incident). */
export async function createIncidentFromDetections(
  token: string,
  params: {
    organizationId: string;
    projectId?: string;
    title: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
    detectionEventIds: string[];
  }
): Promise<{ id: string }> {
  const res = await fetch(`${TEST_API_URL}/api/v1/siem/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`POST /siem/incidents failed: ${res.status} ${await res.text()}`);
  return res.json();
}
