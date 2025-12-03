// Runtime configuration for LogWard frontend
// This allows the API URL to be configured at runtime via Docker environment variables

import { browser } from '$app/environment';

// Declare the global window config type
declare global {
  interface Window {
    __LOGWARD_CONFIG__?: {
      apiUrl: string;
    };
  }
}

/**
 * Get the API URL from runtime config or fallback to build-time default.
 *
 * Priority:
 * 1. Runtime config injected via hooks.server.ts (for Docker deployments)
 * 2. Default fallback (for development or when not configured)
 */
export function getApiUrl(): string {
  if (browser && window.__LOGWARD_CONFIG__?.apiUrl) {
    return window.__LOGWARD_CONFIG__.apiUrl;
  }

  // Fallback to default for development
  return 'http://localhost:8080';
}

/**
 * Get the full API base URL with /api/v1 suffix
 */
export function getApiBaseUrl(): string {
  return `${getApiUrl()}/api/v1`;
}
