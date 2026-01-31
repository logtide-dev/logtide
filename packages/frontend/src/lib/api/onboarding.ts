import { getApiBaseUrl } from '$lib/config';

export interface OnboardingState {
  checklistItems: Record<string, boolean>;
  checklistCollapsed: boolean;
  checklistDismissed: boolean;
  tutorialCompleted: boolean;
  tutorialStep: number;
  tutorialSkipped: boolean;
}

export interface UpdateOnboardingRequest {
  checklistItems?: Record<string, boolean>;
  checklistCollapsed?: boolean;
  checklistDismissed?: boolean;
  tutorialCompleted?: boolean;
  tutorialStep?: number;
  tutorialSkipped?: boolean;
}

export class OnboardingAPI {
  constructor(private getToken: () => string | null) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getState(): Promise<OnboardingState> {
    return this.request('/onboarding');
  }

  async updateState(updates: UpdateOnboardingRequest): Promise<OnboardingState> {
    return this.request('/onboarding', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async completeChecklistItem(itemId: string): Promise<OnboardingState> {
    return this.request('/onboarding/checklist/complete', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    });
  }

  async reset(): Promise<OnboardingState> {
    return this.request('/onboarding/reset', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}
