import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type {
  SigmaLevel,
  SigmaStatus,
  PackCategory,
  SigmaLogsource,
  SigmaDetection,
  DetectionPackRule,
  DetectionPack,
  ThresholdOverride,
  ThresholdMap,
  DetectionPackWithStatus,
  EnablePackInput,
  UpdateThresholdsInput,
} from '@logtide/shared';

import type { DetectionPackWithStatus, EnablePackInput, UpdateThresholdsInput } from '@logtide/shared';

export class DetectionPacksAPI {
  private getToken: () => string | null;

  constructor(getToken: () => string | null) {
    this.getToken = getToken;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const token = this.getToken();

    const response = await fetch(`${getApiUrl()}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async listPacks(organizationId: string): Promise<{ packs: DetectionPackWithStatus[] }> {
    return this.request(`/api/v1/detection-packs?organizationId=${organizationId}`);
  }

  async getPack(packId: string, organizationId: string): Promise<{ pack: DetectionPackWithStatus }> {
    return this.request(`/api/v1/detection-packs/${packId}?organizationId=${organizationId}`);
  }

  async enablePack(packId: string, input: EnablePackInput): Promise<{ pack: DetectionPackWithStatus }> {
    return this.request(`/api/v1/detection-packs/${packId}/enable`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async disablePack(packId: string, organizationId: string): Promise<void> {
    return this.request(
      `/api/v1/detection-packs/${packId}/disable?organizationId=${organizationId}`,
      { method: 'POST' }
    );
  }

  async updateThresholds(
    packId: string,
    input: UpdateThresholdsInput
  ): Promise<{ pack: DetectionPackWithStatus }> {
    return this.request(`/api/v1/detection-packs/${packId}/thresholds`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }
}

export const detectionPacksAPI = new DetectionPacksAPI(getAuthToken);
