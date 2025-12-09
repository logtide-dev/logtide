import { test as base, type Page } from '@playwright/test';

// Test environment URLs
export const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3001';
export const TEST_FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:3002';

// Auth storage key (same as frontend)
const AUTH_STORAGE_KEY = 'logward_auth';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
  };
  token: string;
  loading: boolean;
}

/**
 * Register a new user via API
 */
export async function registerUser(
  name: string,
  email: string,
  password: string
): Promise<{ user: TestUser; token: string }> {
  const response = await fetch(`${TEST_API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(error.error || `Registration failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      token: data.session.token,
    },
    token: data.session.token,
  };
}

/**
 * Login user via API
 */
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: TestUser; token: string }> {
  const response = await fetch(`${TEST_API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || `Login failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      token: data.session.token,
    },
    token: data.session.token,
  };
}

/**
 * Set auth state in browser localStorage
 */
export async function setAuthState(page: Page, user: TestUser, token: string): Promise<void> {
  const authState: AuthState = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    token,
    loading: false,
  };

  await page.evaluate(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key: AUTH_STORAGE_KEY, state: authState }
  );
}

/**
 * Clear auth state from browser localStorage
 */
export async function clearAuthState(page: Page): Promise<void> {
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, AUTH_STORAGE_KEY);
}

/**
 * Generate unique email for test
 */
export function generateTestEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${random}@e2e-test.logward.dev`;
}

/**
 * Generate unique name for test
 */
export function generateTestName(prefix = 'Test'): string {
  const timestamp = Date.now();
  return `${prefix} User ${timestamp}`;
}

// Extended test fixture with auth helpers
export interface AuthFixtures {
  authenticatedPage: Page;
  testUser: TestUser;
  apiClient: TestApiClient;
}

// Test API client for creating test data
export class TestApiClient {
  constructor(private token: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${TEST_API_URL}/api/v1${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async createOrganization(name: string, description?: string) {
    return this.request<{ organization: any }>('/organizations', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async getOrganizations() {
    return this.request<{ organizations: any[] }>('/organizations');
  }

  async createProject(organizationId: string, name: string, description?: string) {
    return this.request<{ project: any }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name, description }),
    });
  }

  async getProjects(organizationId: string) {
    return this.request<{ projects: any[] }>(`/projects?organizationId=${organizationId}`);
  }

  async createApiKey(projectId: string, name: string) {
    return this.request<{ id: string; apiKey: string; message: string }>(
      `/projects/${projectId}/api-keys`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      }
    );
  }

  async ingestLogs(apiKey: string, logs: any[]) {
    const response = await fetch(`${TEST_API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ logs }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Ingest failed' }));
      console.error('Ingest error:', JSON.stringify(errorData, null, 2));
      console.error('First log sample:', JSON.stringify(logs[0]));
      throw new Error(errorData.error || `Ingest failed: ${response.status}`);
    }

    return response.json();
  }

  async getLogs(projectId: string, params: Record<string, string> = {}) {
    const query = new URLSearchParams({ projectId, ...params }).toString();
    return this.request<{ logs: any[]; total: number }>(`/logs?${query}`);
  }

  async createAlertRule(projectId: string, rule: any) {
    // Alerts API uses /alerts endpoint with organizationId and projectId in body
    return this.request<{ alertRule: any }>(`/alerts`, {
      method: 'POST',
      body: JSON.stringify(rule),
    });
  }

  async getAlertRules(organizationId: string, projectId?: string) {
    const params = new URLSearchParams({ organizationId });
    if (projectId) params.append('projectId', projectId);
    return this.request<{ alertRules: any[] }>(`/alerts?${params}`);
  }

  async getAlertHistory(organizationId: string) {
    return this.request<{ alerts: any[]; total: number }>(
      `/alerts/history?organizationId=${organizationId}`
    );
  }

  async importSigmaRule(projectId: string, yaml: string) {
    return this.request<{ rule: any }>(`/projects/${projectId}/sigma/rules`, {
      method: 'POST',
      body: JSON.stringify({ yaml }),
    });
  }

  async getSigmaRules(projectId: string) {
    return this.request<{ rules: any[] }>(`/projects/${projectId}/sigma/rules`);
  }

  async toggleSigmaRule(projectId: string, ruleId: string, enabled: boolean) {
    return this.request<{ rule: any }>(`/projects/${projectId}/sigma/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async getSiemDashboard(organizationId: string, timeRange: '24h' | '7d' | '30d' = '24h') {
    const params = new URLSearchParams({ organizationId, timeRange });
    return this.request<{
      topThreats: any[];
      timeline: any[];
      affectedServices: any[];
      severityDistribution: any[];
      mitreHeatmap: any[];
      totalDetections: number;
      totalIncidents: number;
      openIncidents: number;
      criticalIncidents: number;
    }>(`/siem/dashboard?${params}`);
  }

  async listSiemIncidents(organizationId: string, filters?: { status?: string[]; severity?: string[] }) {
    const params = new URLSearchParams({ organizationId });
    if (filters?.status) {
      filters.status.forEach(s => params.append('status', s));
    }
    if (filters?.severity) {
      filters.severity.forEach(s => params.append('severity', s));
    }
    return this.request<{ incidents: any[] }>(`/siem/incidents?${params}`);
  }

  async getSiemIncident(incidentId: string, organizationId: string) {
    const params = new URLSearchParams({ organizationId });
    return this.request<{
      incident: any;
      detections: any[];
      comments: any[];
      history: any[];
    }>(`/siem/incidents/${incidentId}?${params}`);
  }

  async createSiemIncident(params: {
    organizationId: string;
    projectId?: string;
    title: string;
    description?: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
    status?: 'open' | 'investigating' | 'resolved' | 'false_positive';
  }) {
    return this.request<any>('/siem/incidents', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updateSiemIncident(incidentId: string, params: {
    organizationId: string;
    status?: 'open' | 'investigating' | 'resolved' | 'false_positive';
    severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
    title?: string;
    description?: string;
  }) {
    return this.request<any>(`/siem/incidents/${incidentId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  async deleteSiemIncident(incidentId: string, organizationId: string) {
    const params = new URLSearchParams({ organizationId });
    return this.request<void>(`/siem/incidents/${incidentId}?${params}`, {
      method: 'DELETE',
    });
  }

  async addSiemComment(incidentId: string, organizationId: string, comment: string) {
    return this.request<any>(`/siem/incidents/${incidentId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ comment, organizationId }),
    });
  }

  // Invitation methods
  async inviteUser(organizationId: string, email: string, role: 'admin' | 'member' = 'member') {
    return this.request<{ type: string; message: string }>(`/invitations/${organizationId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  }

  async getPendingInvitations(organizationId: string) {
    return this.request<{ invitations: any[] }>(`/invitations/${organizationId}/invitations`);
  }

  async revokeInvitation(organizationId: string, invitationId: string) {
    return this.request<void>(`/invitations/${organizationId}/invitations/${invitationId}`, {
      method: 'DELETE',
    });
  }

  async resendInvitation(organizationId: string, invitationId: string) {
    return this.request<{ success: boolean; message: string }>(`/invitations/${organizationId}/invitations/${invitationId}/resend`, {
      method: 'POST',
    });
  }

  async getInvitationByToken(token: string) {
    // This is a public endpoint, no auth required
    const response = await fetch(`${TEST_API_URL}/api/v1/invitations/token/${token}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async acceptInvitation(token: string) {
    return this.request<{ success: boolean; organizationId: string; role: string }>('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // Organization members
  async getOrganizationMembers(organizationId: string) {
    return this.request<{ members: any[] }>(`/organizations/${organizationId}/members`);
  }

  async removeMember(organizationId: string, userId: string) {
    return this.request<void>(`/organizations/${organizationId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  async updateMemberRole(organizationId: string, userId: string, role: 'admin' | 'member') {
    return this.request<{ member: any }>(`/organizations/${organizationId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }
}

// Create test with authenticated user fixture
export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    // Register a new user for each test
    const email = generateTestEmail();
    const name = generateTestName();
    const password = 'TestPassword123!';

    const { user, token } = await registerUser(name, email, password);
    await use(user);
  },

  apiClient: async ({ testUser }, use) => {
    const client = new TestApiClient(testUser.token);
    await use(client);
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    // Set auth state before navigating
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, testUser, testUser.token);
    await page.reload();
    await use(page);
  },
});

export { expect } from '@playwright/test';
