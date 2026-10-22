import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { errorTextOf } from '$lib/api/metrics';
import type { WebVitalName, WebVitalRating } from '@logtide/shared';

export type { WebVitalName, WebVitalRating } from '@logtide/shared';

export interface WebVitalSummary {
  name: WebVitalName;
  p75: number | null;
  rating: WebVitalRating | null;
  samples: number;
  distribution: { good: number; needsImprovement: number; poor: number };
}

export interface WebVitalRouteRow {
  route: string;
  samples: number;
  metrics: Partial<Record<WebVitalName, { p75: number; rating: WebVitalRating; samples: number }>>;
}

export interface WebVitalsSummary {
  projectId: string;
  from: string;
  to: string;
  sampleCount: number;
  skipped: number;
  truncated: boolean;
  metrics: WebVitalSummary[];
  routes: WebVitalRouteRow[];
}

export class WebVitalsAPI {
  constructor(private getToken: () => string | null) {}

  private getHeaders(): HeadersInit {
    const token = this.getToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async getSummary(params: { projectId: string; from: string; to: string }): Promise<WebVitalsSummary> {
    const qs = new URLSearchParams({
      projectId: params.projectId,
      from: params.from,
      to: params.to,
    });
    const res = await fetch(`${getApiBaseUrl()}/web-vitals/summary?${qs}`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(await errorTextOf(res, 'Failed to fetch web vitals'));
    return res.json();
  }
}

export const webVitalsAPI = new WebVitalsAPI(getAuthToken);
