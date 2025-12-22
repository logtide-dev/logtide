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
 * Get the API URL from runtime config or fallback.
 *
 * Auto-detection logic (when PUBLIC_API_URL is not explicitly set):
 *
 * 1. Standard port (80/443) → Assume reverse proxy → Use relative URLs ("/api/v1")
 *    Example: https://logward.example.com → API: /api/v1
 *
 * 2. Non-standard port (e.g., 3000) → Assume Docker direct → Use same host + port 8080
 *    Example: http://192.168.1.100:3000 → API: http://192.168.1.100:8080/api/v1
 *
 * 3. Explicit PUBLIC_API_URL → Use as-is (allows full customization)
 *
 * This allows most deployments to work without any configuration:
 * - Docker Compose: User accesses :3000 → backend auto-detected on :8080
 * - Reverse proxy: User accesses domain on 80/443 → relative URLs work
 * - Custom setup: User sets PUBLIC_API_URL explicitly
 */
export function getApiUrl(): string {
  if (browser) {
    // If PUBLIC_API_URL is explicitly configured, use it as-is
    // This includes localhost URLs (for E2E tests) and empty string (for reverse proxy)
    if (window.__LOGWARD_CONFIG__?.apiUrl !== undefined) {
      return window.__LOGWARD_CONFIG__.apiUrl;
    }

    // Auto-detect only when no explicit PUBLIC_API_URL is configured
    // This helps self-hosted users who don't set PUBLIC_API_URL
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port; // "" if 80/443, "3000" if explicit

    // Standard port (80/443) = likely behind reverse proxy = use relative URLs
    const isStandardPort = !port || port === '80' || port === '443';

    if (isStandardPort) {
      // Reverse proxy setup: frontend and backend on same origin
      // Return empty string so getApiBaseUrl() returns "/api/v1"
      return '';
    }

    // Non-standard port (e.g., 3000) = Docker direct access = backend on :8080
    return `${protocol}//${hostname}:8080`;
  }

  // SSR fallback (not used for API calls, but needed for hydration)
  return 'http://localhost:8080';
}

/**
 * Get the full API base URL with /api/v1 suffix.
 * When API URL is empty, returns just '/api/v1' for same-origin requests.
 */
export function getApiBaseUrl(): string {
  const baseUrl = getApiUrl();
  return baseUrl ? `${baseUrl}/api/v1` : '/api/v1';
}
